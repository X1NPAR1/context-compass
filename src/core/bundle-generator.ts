import { ContextBundle, ContextNeighbor, RelationshipType, SymbolRecord } from "../types";
import { ContextDb } from "../utils/db";
import { countTokens } from "../utils/tokens";

interface BundleCaches {
  symbolById: Map<string, SymbolRecord>;
  neighborsBySymbol: Map<string, Array<{ symbolId: string; pmi: number }>>;
  calls: Set<string>;
  callLineByEdge: Map<string, number>;
  testSymbols: Set<string>;
  coeditCountByPair: Map<string, number>;
  totalSessions: number;
}

export class BundleGenerator {
  constructor(private readonly db: ContextDb) {}

  generateAll(topK = 10): Array<{ symbolId: string; bundle: ContextBundle; tokenCount: number }> {
    const symbols = this.db.getFunctionSymbols();
    const caches = this.buildCaches(symbols, topK);
    const out: Array<{ symbolId: string; bundle: ContextBundle; tokenCount: number }> = [];

    for (const symbol of symbols) {
      const bundle = this.generateForSymbol(symbol, topK, caches);
      const tokenCount = countTokens(JSON.stringify(bundle));
      out.push({
        symbolId: symbol.id,
        bundle,
        tokenCount
      });
    }

    return out;
  }

  generateForSymbol(symbol: SymbolRecord, topK = 10, providedCaches?: BundleCaches): ContextBundle {
    const caches = providedCaches ?? this.buildCaches(this.db.getFunctionSymbols(), topK);
    const neighborRows = caches.neighborsBySymbol.get(symbol.id) ?? [];
    const neighbors: ContextNeighbor[] = [];

    for (const row of neighborRows.slice(0, topK)) {
      const neighbor = caches.symbolById.get(row.symbolId);
      if (!neighbor) {
        continue;
      }

      const relationshipType = this.getRelationshipType(symbol.id, neighbor.id, neighbor, caches);
      const relationshipDescription = this.getRelationshipDescription(symbol.id, neighbor.id, relationshipType, caches);

      neighbors.push({
        symbolId: neighbor.id,
        signature: neighbor.signature,
        relationshipType,
        relationshipDescription,
        pmiScore: row.pmi
      });
    }

    return {
      symbolId: symbol.id,
      symbolName: symbol.qualifiedName,
      filePath: symbol.filePath,
      primarySource: symbol.source.trim().length > 0 ? symbol.source : symbol.signature,
      neighbors
    };
  }

  private buildCaches(symbols: SymbolRecord[], topK: number): BundleCaches {
    const symbolById = new Map(symbols.map((symbol) => [symbol.id, symbol]));
    const pmiPairs = this.db.getAllPmiPairs();
    const neighborsBySymbol = new Map<string, Array<{ symbolId: string; pmi: number }>>();

    for (const row of pmiPairs) {
      const a = neighborsBySymbol.get(row.aSymbolId) ?? [];
      a.push({ symbolId: row.bSymbolId, pmi: row.pmi });
      neighborsBySymbol.set(row.aSymbolId, a);

      const b = neighborsBySymbol.get(row.bSymbolId) ?? [];
      b.push({ symbolId: row.aSymbolId, pmi: row.pmi });
      neighborsBySymbol.set(row.bSymbolId, b);
    }
    for (const [symbolId, list] of neighborsBySymbol.entries()) {
      list.sort((x, y) => y.pmi - x.pmi);
      neighborsBySymbol.set(symbolId, list.slice(0, topK));
    }

    const calls = new Set<string>();
    const callLineByEdge = new Map<string, number>();
    for (const edge of this.db.getAllCallEdges()) {
      const key = edgeKey(edge.callerSymbolId, edge.calleeSymbolId);
      calls.add(key);
      if (!callLineByEdge.has(key)) {
        callLineByEdge.set(key, edge.callLine);
      }
    }

    const coeditCountByPair = new Map<string, number>();
    for (const pair of this.db.getAllCooccurrencePairs()) {
      coeditCountByPair.set(pairKey(pair.aSymbolId, pair.bSymbolId), pair.pairCount);
    }

    return {
      symbolById,
      neighborsBySymbol,
      calls,
      callLineByEdge,
      testSymbols: new Set(this.db.getTestSymbolIds()),
      coeditCountByPair,
      totalSessions: this.db.getTotalSessionCount()
    };
  }

  private getRelationshipType(
    anchorId: string,
    neighborId: string,
    neighbor: SymbolRecord,
    caches: BundleCaches
  ): RelationshipType {
    if (caches.calls.has(edgeKey(anchorId, neighborId))) {
      return "CALLS";
    }
    if (caches.calls.has(edgeKey(neighborId, anchorId))) {
      return "CALLED_BY";
    }
    if (caches.testSymbols.has(neighborId)) {
      return "TEST";
    }
    if (isConfigLike(neighbor)) {
      return "CONFIG";
    }
    return "CO_EDIT";
  }

  private getRelationshipDescription(
    anchorId: string,
    neighborId: string,
    type: RelationshipType,
    caches: BundleCaches
  ): string {
    if (type === "CALLS") {
      const line = caches.callLineByEdge.get(edgeKey(anchorId, neighborId));
      return line ? `${line}. satırda çağırır` : "doğrudan çağırır";
    }
    if (type === "CALLED_BY") {
      const line = caches.callLineByEdge.get(edgeKey(neighborId, anchorId));
      return line ? `komşu tarafından ${line}. satırda çağrılır` : "komşu tarafından çağrılır";
    }
    if (type === "TEST") {
      return "co-edit davranışıyla bağlı, teste ilişkin kod yolu";
    }
    if (type === "CONFIG") {
      return "konfigürasyon/sabitler üzerinden paylaşılan davranışsal bağımlılık";
    }

    const pairCount = caches.coeditCountByPair.get(pairKey(anchorId, neighborId)) ?? 0;
    if (caches.totalSessions > 0 && pairCount > 0) {
      return `${pairCount}/${caches.totalSessions} commit'te birlikte düzenlenmiş, doğrudan yapısal bağ yok`;
    }
    return "geçmişte birlikte düzenlenmiş, doğrudan yapısal bağ yok";
  }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function edgeKey(caller: string, callee: string): string {
  return `${caller}|${callee}`;
}

function isConfigLike(symbol: SymbolRecord): boolean {
  const target = `${symbol.name} ${symbol.qualifiedName} ${symbol.filePath}`.toLowerCase();
  return (
    target.includes("config") ||
    target.includes("settings") ||
    target.includes("constant") ||
    target.includes("env") ||
    target.includes("options")
  );
}
