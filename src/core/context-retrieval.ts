import path from "node:path";
import { countTokens } from "../utils/tokens";
import { ContextDb } from "../utils/db";
import { PromptIntent, RetrievalMode } from "../types";

const RETRIEVAL_PROFILES: Record<RetrievalMode, { maxBundles: number; maxContextChars: number }> = {
  economy: {
    maxBundles: 2,
    maxContextChars: 4500
  },
  balanced: {
    maxBundles: 5,
    maxContextChars: 12000
  },
  quality: {
    maxBundles: 10,
    maxContextChars: 28000
  }
};

export interface RelevantContextOptions {
  mode?: RetrievalMode;
  maxBundles?: number;
  maxContextChars?: number;
}

export interface RelevantContextResult {
  intent: PromptIntent;
  keywords: string[];
  symbolIds: string[];
  bundles: string[];
  fullAdditionalContext: string;
  additionalContext: string;
  estimatedExplorationTokens: number;
  actualBundleTokens: number;
}

export interface FunctionBundleLookupResult {
  symbolId: string;
  qualifiedName: string;
  filePath: string;
  bundleText: string;
  matchType: "exact" | "fuzzy";
}

export interface SearchFunctionResult {
  symbolId: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  heatScore: number;
  topNeighbors: Array<{
    symbolId: string;
    qualifiedName: string;
    pmi: number;
  }>;
}

export function getRelevantContextForPrompt(
  db: ContextDb,
  prompt: string,
  options?: RelevantContextOptions
): RelevantContextResult {
  const intent = classifyIntent(prompt);
  const keywords = extractKeywords(prompt);
  const mode = options?.mode ?? "balanced";
  const profile = getRetrievalProfile(mode);
  const maxBundles = Math.max(1, options?.maxBundles ?? profile.maxBundles);
  const maxContextChars = Math.max(500, options?.maxContextChars ?? profile.maxContextChars);

  const symbolIds = selectBundleSymbolIds(db, keywords, intent, maxBundles);
  const bundles = symbolIds.map((symbolId) => db.getBundle(symbolId)).filter((bundle): bundle is string => Boolean(bundle));

  const fullAdditionalContext = assembleAdditionalContext(bundles, intent);
  const additionalContext =
    fullAdditionalContext.length <= maxContextChars
      ? fullAdditionalContext
      : `${fullAdditionalContext.slice(0, maxContextChars)}\n\n(Kısaltıldı. Tam bağlam: .context-compass/active-context.md.)`;

  return {
    intent,
    keywords,
    symbolIds,
    bundles,
    fullAdditionalContext,
    additionalContext,
    estimatedExplorationTokens: estimateExplorationTokens(db, symbolIds),
    actualBundleTokens: countTokens(additionalContext)
  };
}

export function getRetrievalProfile(mode: RetrievalMode): { maxBundles: number; maxContextChars: number } {
  return RETRIEVAL_PROFILES[mode];
}

export function lookupFunctionBundle(
  db: ContextDb,
  functionName: string,
  moduleHint?: string
): FunctionBundleLookupResult | null {
  const normalizedName = functionName.trim();
  if (!normalizedName) {
    return null;
  }

  const exactMatches = db.getSymbolsByExactName(normalizedName, 25);
  const exactPicked = pickBundleCandidate(db, exactMatches, moduleHint);
  if (exactPicked) {
    const bundleText = db.getBundle(exactPicked.symbolId);
    if (!bundleText) {
      return null;
    }
    return {
      symbolId: exactPicked.symbolId,
      qualifiedName: exactPicked.qualifiedName,
      filePath: exactPicked.filePath,
      bundleText,
      matchType: "exact"
    };
  }

  const fuzzyTerms = extractKeywords(normalizedName);
  const fallbackTerms = fuzzyTerms.length > 0 ? fuzzyTerms : [normalizedName.toLowerCase()];
  const fuzzyMatches = db.getMentionMatches(fallbackTerms, 50);
  const fuzzyPicked = pickBundleCandidate(db, fuzzyMatches, moduleHint);
  if (!fuzzyPicked) {
    return null;
  }

  const bundleText = db.getBundle(fuzzyPicked.symbolId);
  if (!bundleText) {
    return null;
  }

  return {
    symbolId: fuzzyPicked.symbolId,
    qualifiedName: fuzzyPicked.qualifiedName,
    filePath: fuzzyPicked.filePath,
    bundleText,
    matchType: "fuzzy"
  };
}

export function buildProjectOverviewMarkdown(db: ContextDb): string {
  const counts = db.getIndexCounts();
  const hot = db.getTopHotSymbols(10);
  const moduleSummary = db.getModuleSummary(50);
  const topConnections = db
    .getTopConnections(80)
    .filter((edge) => edge.aFilePath !== edge.bFilePath)
    .filter((edge) => !db.callExists(edge.aSymbolId, edge.bSymbolId) && !db.callExists(edge.bSymbolId, edge.aSymbolId))
    .slice(0, 10);

  const moduleCounts = new Map<string, number>();
  for (const symbol of db.getFunctionSearchRows()) {
    const moduleName = topLevelModule(symbol.filePath);
    moduleCounts.set(moduleName, (moduleCounts.get(moduleName) ?? 0) + 1);
  }

  const topModules = Array.from(moduleCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20);

  const lines: string[] = [];
  lines.push("# Context Compass Proje Genel Bakışı");
  lines.push("");
  lines.push(`- Fonksiyonlar: ${counts.functions}`);
  lines.push(`- Modüller: ${counts.modules}`);
  lines.push(`- PMI bağlantıları: ${counts.connections}`);
  lines.push("");

  lines.push("## En Sık Değişen (Hot) Fonksiyonlar");
  if (hot.length === 0) {
    lines.push("- (yok)");
  } else {
    for (const item of hot) {
      lines.push(
        `- ${item.qualifiedName} (${item.filePath}) heat=${Number(item.heatScore ?? 0).toFixed(0)}`
      );
    }
  }
  lines.push("");

  lines.push("## En Güçlü CO_EDIT Modüller-Arası Bağlantılar");
  if (topConnections.length === 0) {
    lines.push("- (yok)");
  } else {
    for (const edge of topConnections) {
      lines.push(
        `- ${edge.aName} (${edge.aFilePath}) <-> ${edge.bName} (${edge.bFilePath}) pmi=${Number(edge.pmi).toFixed(3)}`
      );
    }
  }
  lines.push("");

  lines.push("## Modül Listesi (Fonksiyon Sayıları)");
  if (topModules.length === 0) {
    lines.push("- (yok)");
  } else {
    for (const [name, count] of topModules) {
      lines.push(`- ${name}: ${count}`);
    }
  }
  lines.push("");

  lines.push("## Heat'e Göre En Önemli Dosyalar");
  for (const row of moduleSummary.slice(0, 10)) {
    lines.push(
      `- ${row.filePath} symbols=${Number(row.symbolCount ?? 0)} heat=${Number(row.totalHeat ?? 0).toFixed(0)}`
    );
  }

  return lines.join("\n");
}

export function searchFunctions(db: ContextDb, query: string, limit = 10): SearchFunctionResult[] {
  const rows = db.getFunctionSearchRows();
  if (rows.length === 0) {
    return [];
  }

  const terms = extractKeywords(query);
  const normalizedTerms = terms.length > 0 ? terms : [query.toLowerCase().trim()].filter(Boolean);
  const weightedTerms = buildWeightedTerms(rows, normalizedTerms);

  const scored = rows
    .map((row) => {
      const text = `${row.name} ${row.qualifiedName} ${row.filePath}`.toLowerCase();
      let score = 0;
      for (const { term, weight } of weightedTerms) {
        if (!term) {
          continue;
        }

        if (row.name.toLowerCase() === term) {
          score += 24 * weight;
        } else if (row.name.toLowerCase().includes(term)) {
          score += 14 * weight;
        }

        if (row.qualifiedName.toLowerCase().includes(term)) {
          score += 10 * weight;
        }

        if (row.filePath.toLowerCase().includes(`/${term}`) || row.filePath.toLowerCase().includes(`${term}/`)) {
          score += 10 * weight;
        } else if (text.includes(term)) {
          score += 6 * weight;
        }
      }

      score += Math.min(8, Number(row.heatScore ?? 0) / 3);
      return {
        ...row,
        score
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.heatScore ?? 0) - Number(a.heatScore ?? 0) || a.filePath.localeCompare(b.filePath))
    .slice(0, Math.max(1, limit));

  const out: SearchFunctionResult[] = [];
  for (const row of scored) {
    const symbol = db.getSymbolById(row.symbolId);
    if (!symbol) {
      continue;
    }

    const topNeighbors = db
      .getTopPmiNeighbors(row.symbolId, 3)
      .map((neighbor) => {
        const neighborSymbol = db.getSymbolById(neighbor.neighborSymbolId);
        if (!neighborSymbol) {
          return null;
        }
        return {
          symbolId: neighbor.neighborSymbolId,
          qualifiedName: neighborSymbol.qualifiedName,
          pmi: Number(neighbor.pmi)
        };
      })
      .filter((neighbor): neighbor is { symbolId: string; qualifiedName: string; pmi: number } => Boolean(neighbor));

    out.push({
      symbolId: symbol.id,
      name: symbol.name,
      qualifiedName: symbol.qualifiedName,
      filePath: symbol.filePath,
      startLine: symbol.startLine,
      endLine: symbol.endLine,
      heatScore: Number(symbol.heatScore ?? 0),
      topNeighbors
    });
  }

  return out;
}

export function classifyIntent(prompt: string): PromptIntent {
  const lower = prompt.toLowerCase();
  if (/\b(fix|bug|error|broken|failure|issue|crash)\b/.test(lower)) {
    return "bug_fix";
  }
  if (/\b(add|create|implement|build|new)\b/.test(lower)) {
    return "feature";
  }
  if (/\b(refactor|clean|optimize|restructure|simplify)\b/.test(lower)) {
    return "refactor";
  }
  if (/\b(test|unit test|integration test|spec)\b/.test(lower)) {
    return "testing";
  }
  return "general";
}

export function extractKeywords(prompt: string): string[] {
  const words = prompt
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));

  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word)
    .slice(0, 12);
}

function selectBundleSymbolIds(db: ContextDb, keywords: string[], intent: PromptIntent, maxBundles: number): string[] {
  const rows = db.getFunctionSearchRows();
  if (rows.length === 0) {
    return [];
  }

  const weightedTerms = buildWeightedTerms(rows, keywords);

  const scored = rows.map((row) => {
    const lowerName = row.name.toLowerCase();
    const lowerQualified = row.qualifiedName.toLowerCase();
    const lowerPath = row.filePath.toLowerCase();
    let score = 0;

    for (const { term, weight } of weightedTerms) {
      if (lowerName === term) {
        score += 20 * weight;
      } else if (lowerName.includes(term)) {
        score += 12 * weight;
      }

      if (lowerQualified.includes(term)) {
        score += 8 * weight;
      }

      if (lowerPath.includes(`/${term}`) || lowerPath.includes(`${term}/`)) {
        score += 12 * weight;
      } else if (lowerPath.includes(term)) {
        score += 8 * weight;
      }
    }

    score += Math.min(8, Number(row.heatScore ?? 0) / 3);
    if (intent === "bug_fix") {
      score += Math.min(10, Number(row.heatScore ?? 0) / 2);
    }

    return {
      symbolId: row.symbolId,
      filePath: row.filePath,
      heatScore: Number(row.heatScore ?? 0),
      score
    };
  });

  const candidatePool = scored
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.heatScore - a.heatScore || a.filePath.localeCompare(b.filePath))
    .slice(0, 50);

  if (intent === "testing" && candidatePool.length > 0) {
    for (const candidate of candidatePool) {
      if (hasTestTunnel(db, candidate.symbolId)) {
        candidate.score += 12;
      }
    }
  }

  const ranked = candidatePool
    .sort((a, b) => b.score - a.score || b.heatScore - a.heatScore || a.filePath.localeCompare(b.filePath))
    .map((row) => row.symbolId);

  const withBundles = ranked.filter((symbolId) => Boolean(db.getBundle(symbolId))).slice(0, maxBundles);
  if (withBundles.length > 0) {
    return unique(withBundles);
  }

  const hotFallback = db
    .getTopHotSymbols(maxBundles)
    .map((row) => row.symbolId)
    .filter((symbolId) => Boolean(db.getBundle(symbolId)));
  if (hotFallback.length > 0) {
    return unique(hotFallback).slice(0, maxBundles);
  }

  return db.getOverviewSymbolIds(maxBundles);
}

function assembleAdditionalContext(bundles: string[], intent: PromptIntent): string {
  if (bundles.length === 0) {
    return "";
  }

  return [
    "---",
    "Proje indeksinden bağlam (Context Compass):",
    "",
    `Algılanan niyet: ${intent}`,
    "",
    ...bundles.map((bundle, index) => `Paket ${index + 1}\n${bundle}`),
    "",
    "Not: Yukarıdaki bağlam, projenin yapısından ve git geçmişinden önceden hesaplanmıştır.",
    "Dosyaları keşfetmek yerine doğrudan ilgili koda gitmek için bunu kullanın.",
    "---"
  ].join("\n");
}

function estimateExplorationTokens(db: ContextDb, symbolIds: string[]): number {
  let chars = 0;
  const seen = new Set<string>();

  for (const symbolId of symbolIds) {
    if (!seen.has(symbolId)) {
      chars += db.getSymbolSourceSize(symbolId);
      seen.add(symbolId);
    }

    const bundle = db.getBundleJson(symbolId);
    if (!bundle) {
      continue;
    }

    for (const neighbor of bundle.neighbors) {
      if (seen.has(neighbor.symbolId)) {
        continue;
      }
      chars += db.getSymbolSourceSize(neighbor.symbolId);
      seen.add(neighbor.symbolId);
    }
  }

  return Math.ceil(chars / 4);
}

function hasTestTunnel(db: ContextDb, symbolId: string): boolean {
  const bundle = db.getBundleJson(symbolId);
  if (!bundle) {
    return false;
  }
  return bundle.neighbors.some((neighbor) => neighbor.relationshipType === "TEST");
}

function buildWeightedTerms(
  rows: Array<{ name: string; qualifiedName: string; filePath: string }>,
  rawKeywords: string[]
): Array<{ term: string; weight: number }> {
  if (rawKeywords.length === 0) {
    return [];
  }

  const total = rows.length;
  const out: Array<{ term: string; weight: number }> = [];

  for (const keyword of rawKeywords) {
    let df = 0;
    for (const row of rows) {
      const target = `${row.name} ${row.qualifiedName} ${row.filePath}`.toLowerCase();
      if (target.includes(keyword)) {
        df += 1;
      }
    }

    const idf = Math.log((total + 1) / (df + 1)) + 1;
    const variants = expandKeyword(keyword);
    for (const term of variants) {
      out.push({ term, weight: idf });
    }
  }

  return out;
}

function pickBundleCandidate(
  db: ContextDb,
  candidates: Array<{ symbolId: string; qualifiedName: string; filePath: string; heatScore: number }>,
  moduleHint?: string
): { symbolId: string; qualifiedName: string; filePath: string } | null {
  if (candidates.length === 0) {
    return null;
  }

  const normalizedHint = moduleHint?.trim().toLowerCase();
  const ranked = candidates
    .filter((candidate) => Boolean(db.getBundle(candidate.symbolId)))
    .map((candidate) => {
      let boost = Number(candidate.heatScore ?? 0);
      if (normalizedHint) {
        if (candidate.filePath.toLowerCase().includes(normalizedHint)) {
          boost += 100;
        }
        if (candidate.qualifiedName.toLowerCase().includes(normalizedHint)) {
          boost += 30;
        }
      }
      return {
        symbolId: candidate.symbolId,
        qualifiedName: candidate.qualifiedName,
        filePath: candidate.filePath,
        boost
      };
    })
    .sort((a, b) => b.boost - a.boost || a.filePath.localeCompare(b.filePath));

  return ranked[0] ?? null;
}

function expandKeyword(term: string): string[] {
  const variants = new Set<string>([term]);
  if (term.endsWith("ing") && term.length > 5) {
    const base = term.slice(0, -3);
    variants.add(base);
    variants.add(`${base}e`);
  }
  if (term.endsWith("ed") && term.length > 4) {
    variants.add(term.slice(0, -2));
  }
  if (term.endsWith("s") && term.length > 4) {
    variants.add(term.slice(0, -1));
  }
  return Array.from(variants).filter((value) => value.length >= 3);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function topLevelModule(filePath: string): string {
  const normalized = filePath.split(path.sep).join("/");
  const parts = normalized.split("/").filter(Boolean);
  return parts[0] ?? normalized;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "please",
  "should",
  "could",
  "would",
  "into",
  "about",
  "where",
  "when",
  "what",
  "does",
  "is",
  "why",
  "system",
  "works",
  "work",
  "which",
  "need",
  "want",
  "make",
  "also",
  "just",
  "then",
  "than",
  "have",
  "has",
  "had",
  "all",
  "any",
  "our",
  "your",
  "their",
  "there",
  "here",
  "code",
  "file",
  "files",
  "function",
  "functions"
]);
