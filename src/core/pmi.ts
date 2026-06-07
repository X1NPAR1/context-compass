import { CooccurrencePair, GitSession, PmiEdge } from "../types";

export function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function buildCooccurrenceFromSessions(sessions: GitSession[]): CooccurrencePair[] {
  const counts = new Map<string, number>();

  for (const session of sessions) {
    const ids = Array.from(new Set(session.symbolIds)).sort();
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const [a, b] = canonicalPair(ids[i], ids[j]);
        const key = `${a}|${b}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  return Array.from(counts.entries()).map(([key, pairCount]) => {
    const [aSymbolId, bSymbolId] = key.split("|");
    return { aSymbolId, bSymbolId, pairCount };
  });
}

export function computePmiEdges(sessions: GitSession[], pairs: CooccurrencePair[]): PmiEdge[] {
  const totalSessions = sessions.length;
  if (totalSessions === 0) {
    return [];
  }

  const symbolCounts = new Map<string, number>();
  for (const session of sessions) {
    const unique = new Set(session.symbolIds);
    for (const symbolId of unique) {
      symbolCounts.set(symbolId, (symbolCounts.get(symbolId) ?? 0) + 1);
    }
  }

  const out: PmiEdge[] = [];
  for (const pair of pairs) {
    if (pair.pairCount <= 0) {
      continue;
    }

    const aCount = symbolCounts.get(pair.aSymbolId) ?? 0;
    const bCount = symbolCounts.get(pair.bSymbolId) ?? 0;
    if (aCount === 0 || bCount === 0) {
      continue;
    }

    const pAB = pair.pairCount / totalSessions;
    const pA = aCount / totalSessions;
    const pB = bCount / totalSessions;
    const pmi = Math.log2(pAB / (pA * pB));

    out.push({
      aSymbolId: pair.aSymbolId,
      bSymbolId: pair.bSymbolId,
      pmi,
      pA,
      pB,
      pAB
    });
  }

  out.sort((a, b) => b.pmi - a.pmi);
  return out;
}
