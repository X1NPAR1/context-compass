import { describe, expect, it } from "vitest";
import {
  bumpGlobalTimeBuckets,
  bumpTimeBuckets,
  defaultConfig,
  defaultGlobalStatsSnapshot,
  defaultStatsSnapshot
} from "../../src/utils/config";

describe("config and stats defaults", () => {
  it("sets balanced mode as default", () => {
    expect(defaultConfig().retrieval.mode).toBe("balanced");
  });

  it("provides full stats schema defaults", () => {
    const stats = defaultStatsSnapshot();
    expect(stats.today.prompts).toBe(0);
    expect(stats.month.savedTokens).toBe(0);
    expect(stats.lifetime.savedTokens).toBe(0);
    expect(stats.sourceCounts).toEqual({ hook: 0, mcp: 0 });
    expect(stats.modeCounts).toEqual({ economy: 0, balanced: 0, quality: 0 });
  });

  it("rolls project buckets when time windows change", () => {
    const stats = defaultStatsSnapshot();
    stats.today = { date: "2000-01-01", prompts: 3, savedTokens: 500 };
    stats.week = { weekKey: "2000-W01", prompts: 4, savedTokens: 600 };
    stats.month = { monthKey: "2000-01", prompts: 5, savedTokens: 700 };

    const bumped = bumpTimeBuckets(stats, new Date("2030-05-21T00:00:00Z"));
    expect(bumped.today.date).toBe("2030-05-21");
    expect(bumped.today.prompts).toBe(0);
    expect(bumped.week.prompts).toBe(0);
    expect(bumped.month.prompts).toBe(0);
  });

  it("rolls global buckets when time windows change", () => {
    const stats = defaultGlobalStatsSnapshot();
    stats.today = { date: "2000-01-01", prompts: 7, savedTokens: 800 };
    stats.week = { weekKey: "2000-W01", prompts: 8, savedTokens: 900 };
    stats.month = { monthKey: "2000-01", prompts: 9, savedTokens: 1000 };

    const bumped = bumpGlobalTimeBuckets(stats, new Date("2030-06-01T00:00:00Z"));
    expect(bumped.today.date).toBe("2030-06-01");
    expect(bumped.today.savedTokens).toBe(0);
    expect(bumped.week.savedTokens).toBe(0);
    expect(bumped.month.savedTokens).toBe(0);
  });
});
