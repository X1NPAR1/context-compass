import fs from "node:fs";
import path from "node:path";
import initSqlJs = require("sql.js");
import {
  CallEdge,
  CooccurrencePair,
  ContextBundle,
  FileRecord,
  GitSession,
  ImportEdge,
  PmiEdge,
  SymbolRecord
} from "../types";
import { ensureDir } from "./errors";
import { contextDir, indexDbPath } from "./paths";

export interface DbIndexCounts {
  functions: number;
  modules: number;
  connections: number;
}

export interface PmiNeighborRow {
  neighborSymbolId: string;
  pmi: number;
}

export interface MentionMatchRow {
  symbolId: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  heatScore: number;
}

export interface HotSymbolRow {
  symbolId: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  heatScore: number;
  signature: string;
}

export interface ModuleSummaryRow {
  filePath: string;
  symbolCount: number;
  totalHeat: number;
}

export interface ConnectionSummaryRow {
  aSymbolId: string;
  bSymbolId: string;
  pmi: number;
  aName: string;
  bName: string;
  aFilePath: string;
  bFilePath: string;
}

export interface FunctionRangeRow {
  symbolId: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

interface RunResult {
  lastInsertRowid: number;
  changes: number;
}

let sqlJsPromise: Promise<initSqlJs.SqlJsStatic> | null = null;

function getSqlJs(): Promise<initSqlJs.SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs().catch((error) => {
      sqlJsPromise = null;
      throw error;
    });
  }
  return sqlJsPromise;
}

function normalizeBindArgs(args: unknown[]): initSqlJs.BindParams | undefined {
  if (args.length === 0) {
    return undefined;
  }
  if (args.length === 1) {
    const first = args[0];
    if (first === null) {
      return null;
    }
    if (Array.isArray(first)) {
      return first as initSqlJs.BindParams;
    }
    if (typeof first === "object") {
      const named: Record<string, initSqlJs.SqlValue> = {};
      for (const [key, value] of Object.entries(first as Record<string, initSqlJs.SqlValue>)) {
        if (key.startsWith(":") || key.startsWith("@") || key.startsWith("$")) {
          named[key] = value;
        } else {
          named[`@${key}`] = value;
        }
      }
      return named;
    }
  }
  return args as initSqlJs.SqlValue[];
}

function scalarNumber(db: initSqlJs.Database, sql: string): number {
  const rows = db.exec(sql);
  if (rows.length === 0 || rows[0].values.length === 0) {
    return 0;
  }
  const value = rows[0].values[0]?.[0];
  return typeof value === "number" ? value : Number(value ?? 0);
}

class SqliteCompatStatement {
  constructor(
    private readonly db: initSqlJs.Database,
    private readonly sql: string
  ) {}

  run(...args: unknown[]): RunResult {
    const stmt = this.db.prepare(this.sql);
    try {
      const bindArgs = normalizeBindArgs(args);
      if (bindArgs !== undefined) {
        stmt.bind(bindArgs);
      }
      stmt.step();
      return {
        lastInsertRowid: scalarNumber(this.db, "SELECT last_insert_rowid() AS value"),
        changes: this.db.getRowsModified()
      };
    } finally {
      stmt.free();
    }
  }

  get<T>(...args: unknown[]): T | undefined {
    const stmt = this.db.prepare(this.sql);
    try {
      const bindArgs = normalizeBindArgs(args);
      if (bindArgs !== undefined) {
        stmt.bind(bindArgs);
      }
      if (!stmt.step()) {
        return undefined;
      }
      return stmt.getAsObject() as unknown as T;
    } finally {
      stmt.free();
    }
  }

  all<T>(...args: unknown[]): T[] {
    const stmt = this.db.prepare(this.sql);
    try {
      const bindArgs = normalizeBindArgs(args);
      if (bindArgs !== undefined) {
        stmt.bind(bindArgs);
      }
      const rows: T[] = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject() as unknown as T);
      }
      return rows;
    } finally {
      stmt.free();
    }
  }
}

class SqliteCompatDb {
  private txCounter = 0;

  constructor(private readonly db: initSqlJs.Database) {}

  pragma(sql: string): void {
    this.db.run(`PRAGMA ${sql};`);
  }

  exec(sql: string): void {
    this.db.run(sql);
  }

  prepare(sql: string): SqliteCompatStatement {
    return new SqliteCompatStatement(this.db, sql);
  }

  transaction<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
    return (...args: T) => {
      const savepoint = `cc_tx_${this.txCounter++}`;
      this.db.run(`SAVEPOINT ${savepoint}`);
      try {
        fn(...args);
        this.db.run(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (error) {
        this.db.run(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        this.db.run(`RELEASE SAVEPOINT ${savepoint}`);
        throw error;
      }
    };
  }

  close(): void {
    this.db.close();
  }

  get raw(): initSqlJs.Database {
    return this.db;
  }
}

export class ContextDb {
  private readonly db: SqliteCompatDb;
  private dirty: boolean;

  static async open(projectRoot: string): Promise<ContextDb> {
    ensureDir(contextDir(projectRoot));
    const SQL = await getSqlJs();
    const dbPath = indexDbPath(projectRoot);
    const bytes = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
    const isNewDb = !bytes || bytes.length === 0;
    const rawDb = isNewDb ? new SQL.Database() : new SQL.Database(new Uint8Array(bytes));
    return new ContextDb(projectRoot, rawDb, isNewDb);
  }

  private constructor(
    private readonly projectRoot: string,
    rawDb: initSqlJs.Database,
    isNewDb: boolean
  ) {
    this.db = new SqliteCompatDb(rawDb);
    this.dirty = isNewDb;
    this.db.pragma("foreign_keys = OFF");
    this.initSchema();
  }

  close(): void {
    this.flushIfDirty();
    this.db.close();
  }

  get raw(): initSqlJs.Database {
    return this.db.raw;
  }

  private markDirty(): void {
    this.dirty = true;
  }

  private flushIfDirty(): void {
    if (!this.dirty) {
      return;
    }
    const dbPath = indexDbPath(this.projectRoot);
    fs.writeFileSync(dbPath, Buffer.from(this.raw.export()));
    this.dirty = false;
  }

  private initSchema(): void {
    this.db.exec(
      `
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY,
        path TEXT UNIQUE,
        language TEXT,
        is_test INTEGER,
        mtime_ms INTEGER,
        content_hash TEXT,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id TEXT PRIMARY KEY,
        kind TEXT,
        name TEXT,
        qualified_name TEXT,
        file_id INTEGER,
        start_line INTEGER,
        end_line INTEGER,
        params_json TEXT,
        return_type TEXT,
        signature TEXT,
        source TEXT,
        heat_score REAL DEFAULT 0,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS calls (
        caller_symbol_id TEXT,
        callee_symbol_id TEXT,
        call_line INTEGER,
        PRIMARY KEY (caller_symbol_id, callee_symbol_id, call_line)
      );

      CREATE TABLE IF NOT EXISTS imports (
        importer_file_id INTEGER,
        imported_module TEXT,
        imported_symbol TEXT,
        import_kind TEXT,
        line INTEGER
      );

      CREATE TABLE IF NOT EXISTS git_sessions (
        id INTEGER PRIMARY KEY,
        commit_sha TEXT UNIQUE,
        commit_ts INTEGER,
        function_count INTEGER
      );

      CREATE TABLE IF NOT EXISTS session_symbols (
        session_id INTEGER,
        symbol_id TEXT,
        PRIMARY KEY (session_id, symbol_id)
      );

      CREATE TABLE IF NOT EXISTS cooccurrence (
        a_symbol_id TEXT,
        b_symbol_id TEXT,
        pair_count INTEGER,
        PRIMARY KEY (a_symbol_id, b_symbol_id)
      );

      CREATE TABLE IF NOT EXISTS pmi (
        a_symbol_id TEXT,
        b_symbol_id TEXT,
        pmi REAL,
        p_a REAL,
        p_b REAL,
        p_ab REAL,
        PRIMARY KEY (a_symbol_id, b_symbol_id)
      );

      CREATE TABLE IF NOT EXISTS bundles (
        symbol_id TEXT PRIMARY KEY,
        bundle_text TEXT,
        bundle_json TEXT,
        token_count INTEGER,
        updated_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
      CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
      CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
      CREATE INDEX IF NOT EXISTS idx_symbols_qualified_name ON symbols(qualified_name);
      CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller_symbol_id);
      CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee_symbol_id);
      CREATE INDEX IF NOT EXISTS idx_imports_file ON imports(importer_file_id);
      CREATE INDEX IF NOT EXISTS idx_session_symbols_symbol ON session_symbols(symbol_id);
      CREATE INDEX IF NOT EXISTS idx_pmi_a ON pmi(a_symbol_id, pmi DESC);
      CREATE INDEX IF NOT EXISTS idx_pmi_b ON pmi(b_symbol_id, pmi DESC);
      CREATE INDEX IF NOT EXISTS idx_bundles_symbol ON bundles(symbol_id);
      `
    );
  }

  resetForFullIndex(): void {
    this.db.exec(
      `
      DELETE FROM files;
      DELETE FROM symbols;
      DELETE FROM calls;
      DELETE FROM imports;
      DELETE FROM git_sessions;
      DELETE FROM session_symbols;
      DELETE FROM cooccurrence;
      DELETE FROM pmi;
      DELETE FROM bundles;
      `
    );
    this.markDirty();
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `
        INSERT INTO meta (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
      )
      .run(key, value);
    this.markDirty();
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  upsertFile(file: FileRecord): number {
    this.db
      .prepare(
        `
        INSERT INTO files(path, language, is_test, mtime_ms, content_hash, updated_at)
        VALUES (@path, @language, @isTest, @mtimeMs, @contentHash, @updatedAt)
        ON CONFLICT(path) DO UPDATE SET
          language = excluded.language,
          is_test = excluded.is_test,
          mtime_ms = excluded.mtime_ms,
          content_hash = excluded.content_hash,
          updated_at = excluded.updated_at
        `
      )
      .run({
        path: file.path,
        language: file.language,
        isTest: file.isTest ? 1 : 0,
        mtimeMs: file.mtimeMs,
        contentHash: file.contentHash,
        updatedAt: file.updatedAt
      });

    const row = this.db.prepare("SELECT id FROM files WHERE path = ?").get(file.path) as { id: number };
    this.markDirty();
    return row.id;
  }

  deleteFileAndRelatedData(filePath: string): void {
    const fileRow = this.db.prepare("SELECT id FROM files WHERE path = ?").get(filePath) as { id: number } | undefined;
    if (!fileRow) {
      return;
    }

    const symbolRows = this.db.prepare("SELECT id FROM symbols WHERE file_id = ?").all(fileRow.id) as Array<{
      id: string;
    }>;
    const symbolIds = symbolRows.map((row) => row.id);
    if (symbolIds.length > 0) {
      this.deleteSymbols(symbolIds);
    }

    this.db.prepare("DELETE FROM imports WHERE importer_file_id = ?").run(fileRow.id);
    this.db.prepare("DELETE FROM files WHERE id = ?").run(fileRow.id);
    this.markDirty();
  }

  getIndexedFiles(): Array<{ id: number; path: string; mtimeMs: number; contentHash: string }> {
    return this.db
      .prepare("SELECT id, path, mtime_ms as mtimeMs, content_hash as contentHash FROM files")
      .all() as Array<{ id: number; path: string; mtimeMs: number; contentHash: string }>;
  }

  replaceSymbolsForFile(fileId: number, symbols: SymbolRecord[]): void {
    const oldRows = this.db.prepare("SELECT id FROM symbols WHERE file_id = ?").all(fileId) as Array<{ id: string }>;
    const oldIds = oldRows.map((row) => row.id);
    if (oldIds.length > 0) {
      this.deleteSymbols(oldIds);
    }

    const stmt = this.db.prepare(
      `
      INSERT INTO symbols (
        id, kind, name, qualified_name, file_id, start_line, end_line,
        params_json, return_type, signature, source, heat_score, updated_at
      ) VALUES (
        @id, @kind, @name, @qualifiedName, @fileId, @startLine, @endLine,
        @paramsJson, @returnType, @signature, @source, @heatScore, @updatedAt
      )
      `
    );

    const tx = this.db.transaction((rows: SymbolRecord[]) => {
      for (const symbol of rows) {
        stmt.run({
          id: symbol.id,
          kind: symbol.kind,
          name: symbol.name,
          qualifiedName: symbol.qualifiedName,
          fileId,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          paramsJson: JSON.stringify(symbol.params),
          returnType: symbol.returnType ?? null,
          signature: symbol.signature,
          source: symbol.source,
          heatScore: symbol.heatScore ?? 0,
          updatedAt: symbol.updatedAt
        });
      }
    });

    tx(symbols);
    this.markDirty();
  }

  private deleteSymbols(symbolIds: string[]): void {
    const delSym = this.db.prepare("DELETE FROM symbols WHERE id = ?");
    const delCaller = this.db.prepare("DELETE FROM calls WHERE caller_symbol_id = ?");
    const delCallee = this.db.prepare("DELETE FROM calls WHERE callee_symbol_id = ?");
    const delSess = this.db.prepare("DELETE FROM session_symbols WHERE symbol_id = ?");
    const delBundle = this.db.prepare("DELETE FROM bundles WHERE symbol_id = ?");

    const tx = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        delCaller.run(id);
        delCallee.run(id);
        delSess.run(id);
        delBundle.run(id);
        delSym.run(id);
      }
    });

    tx(symbolIds);
    this.markDirty();
  }

  replaceCallsForSymbolSet(symbolIds: string[], calls: CallEdge[]): void {
    if (symbolIds.length > 0) {
      const delCaller = this.db.prepare("DELETE FROM calls WHERE caller_symbol_id = ?");
      const delCallee = this.db.prepare("DELETE FROM calls WHERE callee_symbol_id = ?");
      const tx = this.db.transaction((ids: string[]) => {
        for (const id of ids) {
          delCaller.run(id);
          delCallee.run(id);
        }
      });
      tx(symbolIds);
    }

    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO calls(caller_symbol_id, callee_symbol_id, call_line) VALUES(?, ?, ?)"
    );
    const txInsert = this.db.transaction((edges: CallEdge[]) => {
      for (const edge of edges) {
        insert.run(edge.callerSymbolId, edge.calleeSymbolId, edge.callLine);
      }
    });
    txInsert(calls);
    this.markDirty();
  }

  replaceImportsForFile(fileId: number, imports: ImportEdge[]): void {
    this.db.prepare("DELETE FROM imports WHERE importer_file_id = ?").run(fileId);
    const insert = this.db.prepare(
      "INSERT INTO imports(importer_file_id, imported_module, imported_symbol, import_kind, line) VALUES(?, ?, ?, ?, ?)"
    );
    const tx = this.db.transaction((rows: ImportEdge[]) => {
      for (const imp of rows) {
        insert.run(fileId, imp.importedModule, imp.importedSymbol ?? null, imp.importKind, imp.line);
      }
    });
    tx(imports);
    this.markDirty();
  }

  replaceGitSessions(sessions: GitSession[]): void {
    this.db.exec("DELETE FROM git_sessions; DELETE FROM session_symbols;");

    const insertSession = this.db.prepare(
      "INSERT INTO git_sessions(commit_sha, commit_ts, function_count) VALUES(?, ?, ?)"
    );
    const insertSessSym = this.db.prepare("INSERT INTO session_symbols(session_id, symbol_id) VALUES(?, ?)");

    const tx = this.db.transaction((rows: GitSession[]) => {
      for (const session of rows) {
        const result = insertSession.run(session.commitSha, session.commitTs, session.functionCount);
        const sessionId = Number(result.lastInsertRowid);
        for (const symbolId of session.symbolIds) {
          insertSessSym.run(sessionId, symbolId);
        }
      }
    });

    tx(sessions);
    this.markDirty();
  }

  replaceCooccurrence(pairs: CooccurrencePair[]): void {
    this.db.exec("DELETE FROM cooccurrence;");
    const insert = this.db.prepare("INSERT INTO cooccurrence(a_symbol_id, b_symbol_id, pair_count) VALUES(?, ?, ?)");
    const tx = this.db.transaction((rows: CooccurrencePair[]) => {
      for (const row of rows) {
        insert.run(row.aSymbolId, row.bSymbolId, row.pairCount);
      }
    });
    tx(pairs);
    this.markDirty();
  }

  replacePmi(edges: PmiEdge[]): void {
    this.db.exec("DELETE FROM pmi;");
    const insert = this.db.prepare(
      "INSERT INTO pmi(a_symbol_id, b_symbol_id, pmi, p_a, p_b, p_ab) VALUES(?, ?, ?, ?, ?, ?)"
    );
    const tx = this.db.transaction((rows: PmiEdge[]) => {
      for (const row of rows) {
        insert.run(row.aSymbolId, row.bSymbolId, row.pmi, row.pA, row.pB, row.pAB);
      }
    });
    tx(edges);
    this.markDirty();
  }

  replaceBundles(bundles: Array<{ symbolId: string; bundle: ContextBundle; tokenCount: number }>): void {
    const insert = this.db.prepare(
      `
      INSERT INTO bundles(symbol_id, bundle_text, bundle_json, token_count, updated_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(symbol_id) DO UPDATE SET
        bundle_text = excluded.bundle_text,
        bundle_json = excluded.bundle_json,
        token_count = excluded.token_count,
        updated_at = excluded.updated_at
      `
    );

    const now = Date.now();
    const tx = this.db.transaction((rows: Array<{ symbolId: string; bundle: ContextBundle; tokenCount: number }>) => {
      for (const row of rows) {
        insert.run(row.symbolId, renderBundleText(row.bundle), JSON.stringify(row.bundle), row.tokenCount, now);
      }
    });

    tx(bundles);
    this.markDirty();
  }

  getFunctionSymbols(): SymbolRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT s.id, s.kind, s.name, s.qualified_name as qualifiedName, f.path as filePath,
               s.start_line as startLine, s.end_line as endLine, s.params_json as paramsJson,
               s.return_type as returnType, s.signature, s.source, s.heat_score as heatScore,
               s.updated_at as updatedAt
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.kind IN ('function', 'method')
        `
      )
      .all() as Array<{
      id: string;
      kind: string;
      name: string;
      qualifiedName: string;
      filePath: string;
      startLine: number;
      endLine: number;
      paramsJson: string;
      returnType: string | null;
      signature: string;
      source: string;
      heatScore: number;
      updatedAt: number;
    }>;

    return rows.map((row) => mapSymbolRow(row));
  }

  getSymbolById(symbolId: string): SymbolRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT s.id, s.kind, s.name, s.qualified_name as qualifiedName, f.path as filePath,
               s.start_line as startLine, s.end_line as endLine, s.params_json as paramsJson,
               s.return_type as returnType, s.signature, s.source, s.heat_score as heatScore,
               s.updated_at as updatedAt
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.id = ?
        `
      )
      .get(symbolId) as
      | {
          id: string;
          kind: string;
          name: string;
          qualifiedName: string;
          filePath: string;
          startLine: number;
          endLine: number;
          paramsJson: string;
          returnType: string | null;
          signature: string;
          source: string;
          heatScore: number;
          updatedAt: number;
        }
      | undefined;

    return row ? mapSymbolRow(row) : null;
  }

  getSymbolsByFilePath(pathPattern: string): SymbolRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT s.id, s.kind, s.name, s.qualified_name as qualifiedName, f.path as filePath,
               s.start_line as startLine, s.end_line as endLine, s.params_json as paramsJson,
               s.return_type as returnType, s.signature, s.source, s.heat_score as heatScore,
               s.updated_at as updatedAt
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE f.path LIKE ?
        `
      )
      .all(`%${pathPattern}%`) as Array<{
      id: string;
      kind: string;
      name: string;
      qualifiedName: string;
      filePath: string;
      startLine: number;
      endLine: number;
      paramsJson: string;
      returnType: string | null;
      signature: string;
      source: string;
      heatScore: number;
      updatedAt: number;
    }>;

    return rows.map((row) => mapSymbolRow(row));
  }

  getTopPmiNeighbors(symbolId: string, limit: number): PmiNeighborRow[] {
    return this.db
      .prepare(
        `
        SELECT CASE WHEN a_symbol_id = ? THEN b_symbol_id ELSE a_symbol_id END as neighborSymbolId,
               pmi
        FROM pmi
        WHERE a_symbol_id = ? OR b_symbol_id = ?
        ORDER BY pmi DESC
        LIMIT ?
        `
      )
      .all(symbolId, symbolId, symbolId, limit) as PmiNeighborRow[];
  }

  getBundle(symbolId: string): string | null {
    const row = this.db.prepare("SELECT bundle_text as bundleText FROM bundles WHERE symbol_id = ?").get(symbolId) as
      | { bundleText: string }
      | undefined;
    return row?.bundleText ?? null;
  }

  getBundleJson(symbolId: string): ContextBundle | null {
    const row = this.db.prepare("SELECT bundle_json as bundleJson FROM bundles WHERE symbol_id = ?").get(symbolId) as
      | { bundleJson: string }
      | undefined;
    if (!row) {
      return null;
    }
    return safeJsonParse(row.bundleJson) as ContextBundle;
  }

  getMentionMatches(terms: string[], limit = 10): MentionMatchRow[] {
    if (terms.length === 0) {
      return [];
    }

    const clauses = terms.map(() => "(s.name LIKE ? OR s.qualified_name LIKE ? OR f.path LIKE ?)").join(" OR ");
    const params: string[] = [];
    for (const term of terms) {
      const like = `%${term}%`;
      params.push(like, like, like);
    }

    const sql = `
      SELECT s.id as symbolId, s.name, s.qualified_name as qualifiedName, f.path as filePath, s.heat_score as heatScore
      FROM symbols s
      JOIN files f ON f.id = s.file_id
      WHERE ${clauses}
      ORDER BY s.heat_score DESC, s.name ASC
      LIMIT ?
    `;

    return this.db.prepare(sql).all(...params, limit) as MentionMatchRow[];
  }

  getSymbolsByExactName(name: string, limit = 25): MentionMatchRow[] {
    return this.db
      .prepare(
        `
        SELECT s.id as symbolId, s.name, s.qualified_name as qualifiedName, f.path as filePath, s.heat_score as heatScore
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.name = ?
        ORDER BY s.heat_score DESC, s.updated_at DESC
        LIMIT ?
        `
      )
      .all(name, limit) as MentionMatchRow[];
  }

  getDomainMatches(domain: string, limit = 5): MentionMatchRow[] {
    const like = `%${domain}%`;
    return this.db
      .prepare(
        `
        SELECT s.id as symbolId, s.name, s.qualified_name as qualifiedName, f.path as filePath, s.heat_score as heatScore
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.name LIKE ? OR s.qualified_name LIKE ? OR f.path LIKE ?
        ORDER BY s.heat_score DESC, s.updated_at DESC
        LIMIT ?
        `
      )
      .all(like, like, like, limit) as MentionMatchRow[];
  }

  getOverviewSymbolIds(limit = 3): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT s.id
        FROM symbols s
        WHERE s.kind IN ('function', 'method')
        ORDER BY s.heat_score DESC, s.updated_at DESC
        LIMIT ?
        `
      )
      .all(limit) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  getTopHotSymbols(limit = 5): HotSymbolRow[] {
    return this.db
      .prepare(
        `
        SELECT s.id as symbolId, s.name, s.qualified_name as qualifiedName, f.path as filePath,
               s.heat_score as heatScore, s.signature as signature
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.kind IN ('function', 'method')
        ORDER BY s.heat_score DESC, s.updated_at DESC
        LIMIT ?
        `
      )
      .all(limit) as HotSymbolRow[];
  }

  getModuleSummary(limit = 10): ModuleSummaryRow[] {
    return this.db
      .prepare(
        `
        SELECT f.path as filePath, COUNT(s.id) as symbolCount, COALESCE(SUM(s.heat_score), 0) as totalHeat
        FROM files f
        LEFT JOIN symbols s ON s.file_id = f.id
        GROUP BY f.id, f.path
        ORDER BY totalHeat DESC, symbolCount DESC, f.path ASC
        LIMIT ?
        `
      )
      .all(limit) as ModuleSummaryRow[];
  }

  getTopConnections(limit = 10): ConnectionSummaryRow[] {
    return this.db
      .prepare(
        `
        SELECT p.a_symbol_id as aSymbolId, p.b_symbol_id as bSymbolId, p.pmi as pmi,
               sa.qualified_name as aName, sb.qualified_name as bName,
               fa.path as aFilePath, fb.path as bFilePath
        FROM pmi p
        JOIN symbols sa ON sa.id = p.a_symbol_id
        JOIN symbols sb ON sb.id = p.b_symbol_id
        JOIN files fa ON fa.id = sa.file_id
        JOIN files fb ON fb.id = sb.file_id
        ORDER BY p.pmi DESC
        LIMIT ?
        `
      )
      .all(limit) as ConnectionSummaryRow[];
  }

  getAllPmiPairs(): Array<{ aSymbolId: string; bSymbolId: string; pmi: number }> {
    return this.db
      .prepare(
        `
        SELECT a_symbol_id as aSymbolId, b_symbol_id as bSymbolId, pmi
        FROM pmi
        `
      )
      .all() as Array<{ aSymbolId: string; bSymbolId: string; pmi: number }>;
  }

  getAllCallEdges(): CallEdge[] {
    return this.db
      .prepare(
        `
        SELECT caller_symbol_id as callerSymbolId, callee_symbol_id as calleeSymbolId, call_line as callLine
        FROM calls
        `
      )
      .all() as CallEdge[];
  }

  getTestSymbolIds(): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT s.id as id
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE f.is_test = 1
        `
      )
      .all() as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  getAllCooccurrencePairs(): CooccurrencePair[] {
    return this.db
      .prepare(
        `
        SELECT a_symbol_id as aSymbolId, b_symbol_id as bSymbolId, pair_count as pairCount
        FROM cooccurrence
        `
      )
      .all() as CooccurrencePair[];
  }

  getTotalSessionCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM git_sessions").get() as { count: number };
    return row.count;
  }

  getIndexCounts(): DbIndexCounts {
    const fnRow = this.db.prepare("SELECT COUNT(*) as count FROM symbols WHERE kind IN ('function', 'method')").get() as {
      count: number;
    };
    const modRow = this.db.prepare("SELECT COUNT(*) as count FROM files").get() as { count: number };
    const connRow = this.db.prepare("SELECT COUNT(*) as count FROM pmi").get() as { count: number };
    return {
      functions: fnRow.count,
      modules: modRow.count,
      connections: connRow.count
    };
  }

  callExists(callerSymbolId: string, calleeSymbolId: string): boolean {
    const row = this.db
      .prepare("SELECT 1 as ok FROM calls WHERE caller_symbol_id = ? AND callee_symbol_id = ? LIMIT 1")
      .get(callerSymbolId, calleeSymbolId) as { ok: number } | undefined;
    return Boolean(row?.ok);
  }

  getCallLine(callerSymbolId: string, calleeSymbolId: string): number | null {
    const row = this.db
      .prepare(
        "SELECT call_line as callLine FROM calls WHERE caller_symbol_id = ? AND callee_symbol_id = ? ORDER BY call_line ASC LIMIT 1"
      )
      .get(callerSymbolId, calleeSymbolId) as { callLine: number } | undefined;
    return row?.callLine ?? null;
  }

  isTestSymbol(symbolId: string): boolean {
    const row = this.db
      .prepare(
        `
        SELECT f.is_test as isTest
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.id = ?
        `
      )
      .get(symbolId) as { isTest: number } | undefined;

    return row?.isTest === 1;
  }

  getSymbolSourceSize(symbolId: string): number {
    const row = this.db.prepare("SELECT LENGTH(source) as len FROM symbols WHERE id = ?").get(symbolId) as
      | { len: number }
      | undefined;
    return row?.len ?? 0;
  }

  getCoeditStats(aSymbolId: string, bSymbolId: string): { pairCount: number; totalSessions: number } {
    const [a, b] = aSymbolId < bSymbolId ? [aSymbolId, bSymbolId] : [bSymbolId, aSymbolId];
    const pairRow = this.db
      .prepare("SELECT pair_count as pairCount FROM cooccurrence WHERE a_symbol_id = ? AND b_symbol_id = ?")
      .get(a, b) as { pairCount: number } | undefined;
    const totalRow = this.db.prepare("SELECT COUNT(*) as count FROM git_sessions").get() as { count: number };
    return { pairCount: pairRow?.pairCount ?? 0, totalSessions: totalRow.count };
  }

  getSymbolsForChangedLines(filePath: string, lines: number[]): string[] {
    if (lines.length === 0) {
      return [];
    }
    const fileRow = this.db.prepare("SELECT id FROM files WHERE path = ?").get(filePath) as { id: number } | undefined;
    if (!fileRow) {
      return [];
    }

    const symbols = this.db
      .prepare("SELECT id, start_line as startLine, end_line as endLine FROM symbols WHERE file_id = ?")
      .all(fileRow.id) as Array<{ id: string; startLine: number; endLine: number }>;

    const changed = new Set<number>(lines);
    const out: string[] = [];
    for (const symbol of symbols) {
      for (let line = symbol.startLine; line <= symbol.endLine; line += 1) {
        if (changed.has(line)) {
          out.push(symbol.id);
          break;
        }
      }
    }
    return out;
  }

  getSymbolIdsForFile(filePath: string): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT s.id
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE f.path = ?
        `
      )
      .all(filePath) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  getFunctionIdsForFile(filePath: string): string[] {
    const rows = this.db
      .prepare(
        `
        SELECT s.id
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE f.path = ? AND s.kind IN ('function', 'method')
        `
      )
      .all(filePath) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  }

  getFunctionRanges(): FunctionRangeRow[] {
    return this.db
      .prepare(
        `
        SELECT s.id as symbolId, f.path as filePath, s.start_line as startLine, s.end_line as endLine
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.kind IN ('function', 'method')
        `
      )
      .all() as FunctionRangeRow[];
  }

  getFunctionSearchRows(): HotSymbolRow[] {
    return this.db
      .prepare(
        `
        SELECT s.id as symbolId, s.name, s.qualified_name as qualifiedName, f.path as filePath,
               s.heat_score as heatScore, s.signature as signature
        FROM symbols s
        JOIN files f ON f.id = s.file_id
        WHERE s.kind IN ('function', 'method')
        `
      )
      .all() as HotSymbolRow[];
  }

  getGitSessionsOrdered(): GitSession[] {
    const sessions = this.db
      .prepare(
        `
        SELECT id, commit_sha as commitSha, commit_ts as commitTs, function_count as functionCount
        FROM git_sessions
        ORDER BY commit_ts DESC, id DESC
        `
      )
      .all() as Array<{ id: number; commitSha: string; commitTs: number; functionCount: number }>;

    const symbolRows = this.db
      .prepare(
        `
        SELECT session_id as sessionId, symbol_id as symbolId
        FROM session_symbols
        `
      )
      .all() as Array<{ sessionId: number; symbolId: string }>;

    const bySession = new Map<number, string[]>();
    for (const row of symbolRows) {
      const list = bySession.get(row.sessionId) ?? [];
      list.push(row.symbolId);
      bySession.set(row.sessionId, list);
    }

    return sessions.map((session) => ({
      id: session.id,
      commitSha: session.commitSha,
      commitTs: session.commitTs,
      functionCount: session.functionCount,
      symbolIds: bySession.get(session.id) ?? []
    }));
  }

  updateHeatScoresFromSessions(): void {
    this.db.exec("UPDATE symbols SET heat_score = 0;");
    this.db.exec(
      `
      UPDATE symbols
      SET heat_score = (
        SELECT COUNT(*) FROM session_symbols ss WHERE ss.symbol_id = symbols.id
      )
      `
    );
    this.markDirty();
  }
}

function safeJsonParse(jsonText: string): any {
  try {
    return JSON.parse(jsonText);
  } catch {
    return [];
  }
}

function mapSymbolRow(row: {
  id: string;
  kind: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  paramsJson: string;
  returnType: string | null;
  signature: string;
  source: string;
  heatScore: number;
  updatedAt: number;
}): SymbolRecord {
  return {
    id: row.id,
    kind: row.kind as SymbolRecord["kind"],
    name: row.name,
    qualifiedName: row.qualifiedName,
    filePath: row.filePath,
    startLine: row.startLine,
    endLine: row.endLine,
    params: safeJsonParse(row.paramsJson),
    returnType: row.returnType ?? undefined,
    signature: row.signature,
    source: row.source,
    heatScore: row.heatScore,
    updatedAt: row.updatedAt
  };
}

function renderBundleText(bundle: ContextBundle): string {
  const lines: string[] = [];
  lines.push(`Fonksiyon: ${bundle.symbolName}`);
  lines.push(`Dosya: ${bundle.filePath}`);
  lines.push("");
  lines.push("Birincil kaynak:");
  lines.push("```");
  lines.push(bundle.primarySource);
  lines.push("```");
  lines.push("");
  lines.push("Tüneller:");

  if (bundle.neighbors.length === 0) {
    lines.push("- (yok)");
  } else {
    for (const neighbor of bundle.neighbors) {
      lines.push(`- ${neighbor.signature}`);
      lines.push(`  ilişki=${neighbor.relationshipType} pmi=${neighbor.pmiScore.toFixed(3)}`);
      lines.push(`  ${neighbor.relationshipDescription}`);
    }
  }

  return lines.join("\n");
}

export function normalizeRelPath(projectRoot: string, filePath: string): string {
  const rel = path.relative(projectRoot, filePath);
  return rel.split(path.sep).join("/");
}
