import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeTempDir, removeDir } from "../helpers/repo";
import { loadGlobalStats, loadStats } from "../../src/utils/config";
import { recordSavingsEvent } from "../../src/utils/savings-tracker";

let homeDir = "";
let projectRoot = "";
let previousHome = "";

describe("savings tracker", () => {
  beforeEach(() => {
    homeDir = makeTempDir("context-compass-home-");
    projectRoot = makeTempDir("context-compass-project-");
    previousHome = process.env.CONTEXT_COMPASS_HOME || "";
    process.env.CONTEXT_COMPASS_HOME = homeDir;
  });

  afterEach(() => {
    if (previousHome) {
      process.env.CONTEXT_COMPASS_HOME = previousHome;
    } else {
      delete process.env.CONTEXT_COMPASS_HOME;
    }
    removeDir(homeDir);
    removeDir(projectRoot);
  });

  it("writes project and global savings with sanitized domains", async () => {
    await recordSavingsEvent({
      timestamp: Date.parse("2026-04-08T12:00:00Z"),
      projectRoot,
      intent: "bug_fix",
      domains: ["Auth", "auth", "payment", "now"],
      actualBundleTokens: 200,
      estimatedExplorationTokens: 1000,
      savedTokens: 800,
      mode: "balanced",
      source: "mcp"
    });

    const projectStats = loadStats(projectRoot);
    const globalStats = loadGlobalStats();

    expect(projectStats.today.prompts).toBe(1);
    expect(projectStats.today.savedTokens).toBe(800);
    expect(projectStats.sourceCounts.mcp).toBe(1);
    expect(projectStats.modeCounts.balanced).toBe(1);
    expect(projectStats.topDomains.auth).toBe(1);
    expect(projectStats.topDomains.payment).toBe(1);
    expect(projectStats.topDomains.now).toBeUndefined();

    expect(globalStats.today.prompts).toBe(1);
    expect(globalStats.today.savedTokens).toBe(800);
    expect(globalStats.sourceCounts.mcp).toBe(1);
    expect(globalStats.modeCounts.balanced).toBe(1);
    const projectKeys = Object.keys(globalStats.projects);
    expect(projectKeys).toHaveLength(1);
    expect(projectKeys[0].startsWith("project_")).toBe(true);
    expect(projectKeys).not.toContain(path.resolve(projectRoot));

    const globalStatsPath = path.join(homeDir, "global-stats.json");
    expect(fs.existsSync(globalStatsPath)).toBe(true);
  });
});
