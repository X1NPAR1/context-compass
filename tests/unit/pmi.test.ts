import { describe, expect, it } from "vitest";
import { buildCooccurrenceFromSessions, canonicalPair, computePmiEdges } from "../../src/core/pmi";
import { GitSession } from "../../src/types";

describe("PMI helpers", () => {
  it("normalizes pair ordering", () => {
    expect(canonicalPair("b", "a")).toEqual(["a", "b"]);
    expect(canonicalPair("a", "c")).toEqual(["a", "c"]);
  });

  it("builds cooccurrence counts from focused sessions", () => {
    const sessions: GitSession[] = [
      { commitSha: "s1", commitTs: 1, functionCount: 3, symbolIds: ["a", "b", "c"] },
      { commitSha: "s2", commitTs: 2, functionCount: 2, symbolIds: ["a", "b"] },
      { commitSha: "s3", commitTs: 3, functionCount: 2, symbolIds: ["b", "c"] }
    ];

    const pairs = buildCooccurrenceFromSessions(sessions);
    const map = new Map(pairs.map((pair) => [`${pair.aSymbolId}|${pair.bSymbolId}`, pair.pairCount]));

    expect(map.get("a|b")).toBe(2);
    expect(map.get("a|c")).toBe(1);
    expect(map.get("b|c")).toBe(2);
  });

  it("computes deterministic pmi metrics for observed pairs", () => {
    const sessions: GitSession[] = [
      { commitSha: "s1", commitTs: 1, functionCount: 3, symbolIds: ["a", "b", "c"] },
      { commitSha: "s2", commitTs: 2, functionCount: 2, symbolIds: ["a", "b"] },
      { commitSha: "s3", commitTs: 3, functionCount: 2, symbolIds: ["b", "c"] }
    ];
    const pairs = buildCooccurrenceFromSessions(sessions);
    const edges = computePmiEdges(sessions, pairs);

    expect(edges).toHaveLength(3);

    const aB = edges.find((edge) => edge.aSymbolId === "a" && edge.bSymbolId === "b");
    const aC = edges.find((edge) => edge.aSymbolId === "a" && edge.bSymbolId === "c");

    expect(aB?.pmi).toBeCloseTo(0, 5);
    expect(aB?.pAB).toBeCloseTo(2 / 3, 5);

    expect(aC?.pmi).toBeCloseTo(-0.415037, 5);
    expect(aC?.pAB).toBeCloseTo(1 / 3, 5);
  });
});
