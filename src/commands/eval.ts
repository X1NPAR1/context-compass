import fs from "node:fs";
import path from "node:path";
import { ContextDb } from "../utils/db";
import { indexDbPath } from "../utils/paths";

interface MethodMetrics {
  hits: number;
  gtTotal: number;
  tokens: number;
}

interface EvalCommandOptions {
  json?: boolean;
}

interface EvalJsonResult {
  repo: string;
  functions: number;
  connections: number;
  test_sessions: number;
  same_file_recall_at_10: number;
  context_compass_recall_at_10: number;
  same_file_tokens: number;
  context_compass_tokens: number;
  same_file_density: number;
  context_compass_density: number;
}

export async function runEvalCommand(projectRoot: string, options: EvalCommandOptions = {}): Promise<number> {
  if (!hasIndex(projectRoot)) {
    console.error("İndeks bulunamadı. Önce 'context-compass init' komutunu çalıştırın.");
    return 1;
  }

  const db = await ContextDb.open(projectRoot);
  try {
    const counts = db.getIndexCounts();
    const sessions = db.getGitSessionsOrdered();
    if (sessions.length === 0) {
      const empty = toEvalJson(path.basename(projectRoot), counts.functions, counts.connections, 0, 0, 0, 0, 0, 0, 0);
      if (options.json) {
        console.log(`${JSON.stringify(empty, null, 2)}\n`);
        return 0;
      }
      console.log(`⟡ Context Compass Değerlendirme (${path.basename(projectRoot)})`);
      console.log("");
      console.log("  İndekste kullanılabilir git oturumu yok.");
      return 0;
    }

    const testSize = Math.max(1, Math.floor(sessions.length * 0.2));
    const heldOut = sessions.slice(0, testSize).filter((session) => session.symbolIds.length >= 2);

    const searchRows = db.getFunctionSearchRows();
    const fileById = new Map(searchRows.map((row) => [row.symbolId, row.filePath]));
    const symbolsByFile = groupByFile(searchRows);

    const baselineMetrics: MethodMetrics = { hits: 0, gtTotal: 0, tokens: 0 };
    const compassMetrics: MethodMetrics = { hits: 0, gtTotal: 0, tokens: 0 };

    for (const session of heldOut) {
      const sessionSymbols = Array.from(new Set(session.symbolIds)).filter((id) => fileById.has(id));
      if (sessionSymbols.length < 2) {
        continue;
      }

      sessionSymbols.sort();
      const queryId = sessionSymbols[0];
      const groundTruth = sessionSymbols.slice(1);
      const gtSet = new Set(groundTruth);
      if (gtSet.size === 0) {
        continue;
      }

      const contextResults = db
        .getTopPmiNeighbors(queryId, 10)
        .map((row) => row.neighborSymbolId)
        .filter((id) => id !== queryId);

      const queryFile = fileById.get(queryId) ?? "";
      const sameFileCandidates = (symbolsByFile.get(queryFile) ?? []).filter((id) => id !== queryId).slice(0, 10);

      scoreMethod(compassMetrics, gtSet, contextResults, db);
      scoreMethod(baselineMetrics, gtSet, sameFileCandidates, db);

      baselineMetrics.gtTotal += gtSet.size;
      compassMetrics.gtTotal += gtSet.size;
    }

    const baselineRecall = fraction(baselineMetrics.hits, baselineMetrics.gtTotal);
    const compassRecall = fraction(compassMetrics.hits, compassMetrics.gtTotal);
    const baselineDensity = densityPerK(baselineMetrics.hits, baselineMetrics.tokens);
    const compassDensity = densityPerK(compassMetrics.hits, compassMetrics.tokens);

    const payload = toEvalJson(
      path.basename(projectRoot),
      counts.functions,
      counts.connections,
      heldOut.length,
      baselineRecall,
      compassRecall,
      baselineMetrics.tokens,
      compassMetrics.tokens,
      baselineDensity,
      compassDensity
    );
    if (options.json) {
      console.log(`${JSON.stringify(payload, null, 2)}\n`);
      return 0;
    }

    console.log(`⟡ Context Compass Değerlendirme (${path.basename(projectRoot)})`);
    console.log("");
    console.log(`  Test oturumları: ${heldOut.length} (toplam ${sessions.length} oturumdan ayrıldı)`);
    console.log("");
    console.log("  Yöntem          Recall@10    Token     Yoğunluk");
    console.log(
      `  Aynı dosya      ${padPct(baselineRecall * 100)}    ${padNum(baselineMetrics.tokens)}    ${baselineDensity.toFixed(1)}/1k`
    );
    console.log(
      `  Context Compass ${padPct(compassRecall * 100)}    ${padNum(compassMetrics.tokens)}    ${compassDensity.toFixed(1)}/1k`
    );
    console.log("");

    const recallFactor = safeFactor(compassRecall * 100, baselineRecall * 100);
    const tokenFactor = safeFactor(baselineMetrics.tokens, compassMetrics.tokens);
    console.log(`  Context Compass ${recallFactor.toFixed(1)}x daha fazla ilgili fonksiyon getiriyor`);
    console.log(`  ve dosya düzeyinde keşfe göre ${tokenFactor.toFixed(1)}x daha az token kullanıyor.`);
    return 0;
  } finally {
    db.close();
  }
}

function hasIndex(projectRoot: string): boolean {
  return fs.existsSync(indexDbPath(projectRoot));
}

function groupByFile(rows: Array<{ symbolId: string; filePath: string; heatScore: number }>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const grouped = new Map<string, Array<{ symbolId: string; heatScore: number }>>();
  for (const row of rows) {
    const list = grouped.get(row.filePath) ?? [];
    list.push({ symbolId: row.symbolId, heatScore: Number(row.heatScore ?? 0) });
    grouped.set(row.filePath, list);
  }
  for (const [filePath, list] of grouped.entries()) {
    list.sort((a, b) => b.heatScore - a.heatScore || a.symbolId.localeCompare(b.symbolId));
    out.set(
      filePath,
      list.map((item) => item.symbolId)
    );
  }
  return out;
}

function scoreMethod(metrics: MethodMetrics, gtSet: Set<string>, resultIds: string[], db: ContextDb): void {
  const uniqueResults = Array.from(new Set(resultIds)).slice(0, 10);
  for (const symbolId of uniqueResults) {
    if (gtSet.has(symbolId)) {
      metrics.hits += 1;
    }
    metrics.tokens += Math.ceil(db.getSymbolSourceSize(symbolId) / 4);
  }
}

function fraction(num: number, den: number): number {
  if (den <= 0) {
    return 0;
  }
  return num / den;
}

function densityPerK(hits: number, tokens: number): number {
  if (tokens <= 0) {
    return 0;
  }
  return (hits / tokens) * 1000;
}

function safeFactor(a: number, b: number): number {
  if (b <= 0) {
    return 0;
  }
  return a / b;
}

function toEvalJson(
  repo: string,
  functions: number,
  connections: number,
  testSessions: number,
  sameFileRecall: number,
  contextCompassRecall: number,
  sameFileTokens: number,
  contextCompassTokens: number,
  sameFileDensity: number,
  contextCompassDensity: number
): EvalJsonResult {
  return {
    repo,
    functions,
    connections,
    test_sessions: testSessions,
    same_file_recall_at_10: roundNumber(sameFileRecall, 3),
    context_compass_recall_at_10: roundNumber(contextCompassRecall, 3),
    same_file_tokens: sameFileTokens,
    context_compass_tokens: contextCompassTokens,
    same_file_density: roundNumber(sameFileDensity, 1),
    context_compass_density: roundNumber(contextCompassDensity, 1)
  };
}

function roundNumber(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function padPct(value: number): string {
  return `${value.toFixed(1)}%`.padEnd(11, " ");
}

function padNum(value: number): string {
  return value.toLocaleString("en-US").padEnd(8, " ");
}
