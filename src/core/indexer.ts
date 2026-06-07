import { CodeParser } from "./parser";
import { GitAnalyzer } from "./git-analyzer";
import { buildCooccurrenceFromSessions, computePmiEdges } from "./pmi";
import { BundleGenerator } from "./bundle-generator";
import { IndexStats, IndexedFileChange, ImportEdge, SupportedLanguage } from "../types";
import { ContextDb } from "../utils/db";
import {
  contentHash,
  detectLanguageByPath,
  detectLanguagesFromFiles,
  listSourceFiles,
  readTextFile
} from "../utils/files";
import { logError } from "../utils/errors";

export interface IndexerOptions {
  maxCommits: number;
  maxSessionFunctions: number;
  topKNeighbors: number;
}

export interface IncrementalUpdateResult {
  changedCount: number;
  changes: IndexedFileChange[];
}

export class Indexer {
  private readonly parser: CodeParser;
  private readonly gitAnalyzer: GitAnalyzer;
  private readonly bundleGenerator: BundleGenerator;

  constructor(private readonly projectRoot: string, private readonly db: ContextDb) {
    this.parser = new CodeParser(projectRoot);
    this.gitAnalyzer = new GitAnalyzer(projectRoot, db);
    this.bundleGenerator = new BundleGenerator(db);
  }

  async fullIndex(options: IndexerOptions): Promise<IndexStats> {
    const startedAt = Date.now();
    const profile = {
      parseMs: 0,
      gitMs: 0,
      pmiMs: 0,
      bundlesMs: 0
    };

    let phaseStart = Date.now();
    const sourceFiles = listSourceFiles(this.projectRoot);
    const parsed = this.parser.parseFiles(sourceFiles);
    profile.parseMs = Date.now() - phaseStart;

    this.db.resetForFullIndex();

    const symbolsByFile = new Map<string, typeof parsed.symbols>();
    for (const symbol of parsed.symbols) {
      const list = symbolsByFile.get(symbol.filePath) ?? [];
      list.push(symbol);
      symbolsByFile.set(symbol.filePath, list);
    }

    const importsByFile = new Map<string, ImportEdge[]>();
    for (const imp of parsed.imports) {
      const list = importsByFile.get(imp.importerPath) ?? [];
      list.push(imp);
      importsByFile.set(imp.importerPath, list);
    }

    for (const file of parsed.files) {
      const fileId = this.db.upsertFile(file);
      this.db.replaceSymbolsForFile(fileId, symbolsByFile.get(file.path) ?? []);
      this.db.replaceImportsForFile(fileId, importsByFile.get(file.path) ?? []);
    }

    this.db.replaceCallsForSymbolSet([], parsed.calls);

    phaseStart = Date.now();
    const gitResult = await this.gitAnalyzer.analyze(options.maxCommits, options.maxSessionFunctions);
    profile.gitMs = Date.now() - phaseStart;

    phaseStart = Date.now();
    const sessions = gitResult.sessions;
    const cooccurrence = buildCooccurrenceFromSessions(sessions);
    const pmiEdges = computePmiEdges(sessions, cooccurrence);

    this.db.replaceGitSessions(sessions);
    this.db.replaceCooccurrence(cooccurrence);
    this.db.replacePmi(pmiEdges);
    this.db.updateHeatScoresFromSessions();
    profile.pmiMs = Date.now() - phaseStart;

    phaseStart = Date.now();
    const bundles = this.bundleGenerator.generateAll(options.topKNeighbors);
    this.db.replaceBundles(bundles);
    profile.bundlesMs = Date.now() - phaseStart;

    const languages = detectLanguagesFromFiles(sourceFiles);
    this.db.setMeta("indexed_at", String(Date.now()));
    this.db.setMeta("languages", JSON.stringify(languages));
    this.db.setMeta("head_commit", gitResult.headCommit ?? "");
    this.db.setMeta("last_source_count", String(sourceFiles.length));

    const counts = this.db.getIndexCounts();
    return {
      functions: counts.functions,
      modules: counts.modules,
      connections: counts.connections,
      languages,
      durationMs: Date.now() - startedAt,
      sessions: sessions.length,
      filesScanned: sourceFiles.length,
      profile
    };
  }

  detectChangedFiles(): IndexedFileChange[] {
    const currentFiles = listSourceFiles(this.projectRoot);
    const indexedFiles = this.db.getIndexedFiles();
    const indexedByPath = new Map(indexedFiles.map((row) => [row.path, row]));

    const changes: IndexedFileChange[] = [];
    const currentSet = new Set(currentFiles);

    for (const filePath of currentFiles) {
      const existing = indexedByPath.get(filePath);
      if (!existing) {
        changes.push({ path: filePath, kind: "added" });
        continue;
      }

      try {
        const hash = contentHash(readTextFile(this.projectRoot, filePath));
        if (hash !== existing.contentHash) {
          changes.push({ path: filePath, kind: "changed" });
        }
      } catch (error) {
        logError(this.projectRoot, error, `detect_changed:${filePath}`);
      }
    }

    for (const indexed of indexedFiles) {
      if (!currentSet.has(indexed.path)) {
        changes.push({ path: indexed.path, kind: "deleted" });
      }
    }

    return changes;
  }

  async incrementalUpdate(options: IndexerOptions, explicitChanges?: IndexedFileChange[]): Promise<IncrementalUpdateResult> {
    const changes = explicitChanges ?? this.detectChangedFiles();
    if (changes.length === 0) {
      return { changedCount: 0, changes: [] };
    }

    const touchedSymbolIds = new Set<string>();
    const newCalls = [];

    for (const change of changes) {
      if (change.kind === "deleted") {
        const oldIds = this.db.getSymbolIdsForFile(change.path);
        for (const symbolId of oldIds) {
          touchedSymbolIds.add(symbolId);
        }
        this.db.deleteFileAndRelatedData(change.path);
        continue;
      }

      const lang = detectLanguageByPath(change.path);
      if (!lang) {
        continue;
      }

      try {
        const parsedFile = this.parser.parseSingleFile(change.path, lang as SupportedLanguage);
        if (!parsedFile) {
          continue;
        }
        const fileId = this.db.upsertFile(parsedFile.fileRecord);
        this.db.replaceSymbolsForFile(fileId, parsedFile.symbols);
        this.db.replaceImportsForFile(fileId, parsedFile.imports);

        for (const symbol of parsedFile.symbols) {
          touchedSymbolIds.add(symbol.id);
        }

        const resolved = this.resolveUnresolvedCalls(parsedFile.unresolvedCalls, parsedFile.symbols);
        newCalls.push(...resolved);
      } catch (error) {
        logError(this.projectRoot, error, `incremental_update:${change.path}`);
      }
    }

    this.db.replaceCallsForSymbolSet(Array.from(touchedSymbolIds), newCalls);

    const currentHead = await this.gitAnalyzer.analyze(1, options.maxSessionFunctions);
    const storedHead = this.db.getMeta("head_commit");
    if ((currentHead.headCommit ?? "") !== (storedHead ?? "")) {
      const gitResult = await this.gitAnalyzer.analyze(options.maxCommits, options.maxSessionFunctions);
      const cooccurrence = buildCooccurrenceFromSessions(gitResult.sessions);
      const pmi = computePmiEdges(gitResult.sessions, cooccurrence);
      this.db.replaceGitSessions(gitResult.sessions);
      this.db.replaceCooccurrence(cooccurrence);
      this.db.replacePmi(pmi);
      this.db.updateHeatScoresFromSessions();
      this.db.setMeta("head_commit", gitResult.headCommit ?? "");
    }

    const bundles = this.bundleGenerator.generateAll(options.topKNeighbors);
    this.db.replaceBundles(bundles);
    this.db.setMeta("indexed_at", String(Date.now()));

    return {
      changedCount: changes.length,
      changes
    };
  }

  private resolveUnresolvedCalls(
    unresolvedCalls: Array<{ callerId: string; callerFilePath: string; calleeName: string; line: number }>,
    localSymbols: Array<{ id: string; name: string; filePath: string }>
  ) {
    const localByKey = new Map<string, Array<{ id: string; name: string; filePath: string }>>();
    const localByName = new Map<string, Array<{ id: string; name: string; filePath: string }>>();

    for (const symbol of localSymbols) {
      const key = `${symbol.filePath}::${symbol.name}`;
      const list = localByKey.get(key) ?? [];
      list.push(symbol);
      localByKey.set(key, list);

      const byName = localByName.get(symbol.name) ?? [];
      byName.push(symbol);
      localByName.set(symbol.name, byName);
    }

    const calls: Array<{ callerSymbolId: string; calleeSymbolId: string; callLine: number }> = [];
    const dedupe = new Set<string>();

    for (const unresolved of unresolvedCalls) {
      const local = localByKey.get(`${unresolved.callerFilePath}::${unresolved.calleeName}`) ?? [];
      const fallback = localByName.get(unresolved.calleeName) ?? [];
      const dbFallback = this.db.getSymbolsByExactName(unresolved.calleeName, 20).map((row) => ({
        id: row.symbolId
      }));
      const candidates = local.length > 0 ? local : fallback.length > 0 ? fallback : dbFallback;

      for (const candidate of candidates) {
        const calleeId = candidate.id;
        if (!calleeId || calleeId === unresolved.callerId) {
          continue;
        }
        const key = `${unresolved.callerId}|${calleeId}|${unresolved.line}`;
        if (dedupe.has(key)) {
          continue;
        }
        dedupe.add(key);
        calls.push({
          callerSymbolId: unresolved.callerId,
          calleeSymbolId: calleeId,
          callLine: unresolved.line
        });
      }
    }

    return calls;
  }
}
