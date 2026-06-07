import fs from "node:fs";
import { GlobalStatsSnapshot, ProjectConfig, RetrievalMode, TokenStatsSnapshot } from "../types";
import { configPath, globalStatsPath, statsPath, userContextDir } from "./paths";
import { ensureDir } from "./errors";

const SCHEMA_VERSION = 1;

export function defaultConfig(): ProjectConfig {
  const now = Date.now();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    indexedLanguages: [],
    thresholds: {
      maxCommits: 1000,
      maxSessionFunctions: 15,
      topKNeighbors: 10
    },
    hooks: {
      registerInLocalSettings: true
    },
    retrieval: {
      mode: "balanced"
    }
  };
}

export function loadConfig(projectRoot: string): ProjectConfig {
  const cfgPath = configPath(projectRoot);
  if (!fs.existsSync(cfgPath)) {
    return defaultConfig();
  }

  const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as Partial<ProjectConfig>;
  const base = defaultConfig();
  return {
    ...base,
    ...parsed,
    thresholds: {
      ...base.thresholds,
      ...(parsed.thresholds ?? {})
    },
    hooks: {
      ...base.hooks,
      ...(parsed.hooks ?? {})
    },
    retrieval: {
      ...base.retrieval,
      ...(parsed.retrieval ?? {})
    }
  };
}

export function saveConfig(projectRoot: string, config: ProjectConfig): void {
  const cfgPath = configPath(projectRoot);
  ensureDir(projectRoot + "/.context-compass");
  fs.writeFileSync(cfgPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function getWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function getMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function defaultStatsSnapshot(): TokenStatsSnapshot {
  const now = new Date();
  return {
    today: {
      date: now.toISOString().slice(0, 10),
      prompts: 0,
      savedTokens: 0
    },
    week: {
      weekKey: getWeekKey(now),
      prompts: 0,
      savedTokens: 0
    },
    month: {
      monthKey: getMonthKey(now),
      prompts: 0,
      savedTokens: 0
    },
    lifetime: {
      prompts: 0,
      savedTokens: 0
    },
    index: {
      functions: 0,
      connections: 0,
      lastUpdatedAt: 0
    },
    topDomains: {},
    sourceCounts: {
      hook: 0,
      mcp: 0
    },
    modeCounts: {
      economy: 0,
      balanced: 0,
      quality: 0
    }
  };
}

export function loadStats(projectRoot: string): TokenStatsSnapshot {
  const sPath = statsPath(projectRoot);
  if (!fs.existsSync(sPath)) {
    return defaultStatsSnapshot();
  }
  const parsed = JSON.parse(fs.readFileSync(sPath, "utf8")) as Partial<TokenStatsSnapshot>;
  const base = defaultStatsSnapshot();
  return {
    ...base,
    ...parsed,
    today: {
      ...base.today,
      ...(parsed.today ?? {})
    },
    week: {
      ...base.week,
      ...(parsed.week ?? {})
    },
    month: {
      ...base.month,
      ...(parsed.month ?? {})
    },
    lifetime: {
      ...base.lifetime,
      ...(parsed.lifetime ?? {})
    },
    index: {
      ...base.index,
      ...(parsed.index ?? {})
    },
    topDomains: {
      ...base.topDomains,
      ...(parsed.topDomains ?? {})
    },
    sourceCounts: {
      ...base.sourceCounts,
      ...(parsed.sourceCounts ?? {})
    },
    modeCounts: {
      ...base.modeCounts,
      ...(parsed.modeCounts ?? {})
    }
  };
}

export function saveStats(projectRoot: string, stats: TokenStatsSnapshot): void {
  const sPath = statsPath(projectRoot);
  ensureDir(projectRoot + "/.context-compass");
  const tmp = `${sPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, sPath);
}

export function defaultGlobalStatsSnapshot(): GlobalStatsSnapshot {
  const now = new Date();
  return {
    today: {
      date: now.toISOString().slice(0, 10),
      prompts: 0,
      savedTokens: 0
    },
    week: {
      weekKey: getWeekKey(now),
      prompts: 0,
      savedTokens: 0
    },
    month: {
      monthKey: getMonthKey(now),
      prompts: 0,
      savedTokens: 0
    },
    lifetime: {
      prompts: 0,
      savedTokens: 0
    },
    projects: {},
    topDomains: {},
    sourceCounts: {
      hook: 0,
      mcp: 0
    },
    modeCounts: {
      economy: 0,
      balanced: 0,
      quality: 0
    }
  };
}

export function loadGlobalStats(): GlobalStatsSnapshot {
  const gPath = globalStatsPath();
  if (!fs.existsSync(gPath)) {
    return defaultGlobalStatsSnapshot();
  }

  const parsed = JSON.parse(fs.readFileSync(gPath, "utf8")) as Partial<GlobalStatsSnapshot>;
  const base = defaultGlobalStatsSnapshot();
  return {
    ...base,
    ...parsed,
    today: {
      ...base.today,
      ...(parsed.today ?? {})
    },
    week: {
      ...base.week,
      ...(parsed.week ?? {})
    },
    month: {
      ...base.month,
      ...(parsed.month ?? {})
    },
    lifetime: {
      ...base.lifetime,
      ...(parsed.lifetime ?? {})
    },
    projects: {
      ...base.projects,
      ...(parsed.projects ?? {})
    },
    topDomains: {
      ...base.topDomains,
      ...(parsed.topDomains ?? {})
    },
    sourceCounts: {
      ...base.sourceCounts,
      ...(parsed.sourceCounts ?? {})
    },
    modeCounts: {
      ...base.modeCounts,
      ...(parsed.modeCounts ?? {})
    }
  };
}

export function saveGlobalStats(stats: GlobalStatsSnapshot): void {
  const gPath = globalStatsPath();
  ensureDir(userContextDir());
  const tmp = `${gPath}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, gPath);
}

export function bumpTimeBuckets(stats: TokenStatsSnapshot, now = new Date()): TokenStatsSnapshot {
  const today = now.toISOString().slice(0, 10);
  const week = getWeekKey(now);
  const month = getMonthKey(now);

  if (stats.today.date !== today) {
    stats.today = { date: today, prompts: 0, savedTokens: 0 };
  }
  if (stats.week.weekKey !== week) {
    stats.week = { weekKey: week, prompts: 0, savedTokens: 0 };
  }
  if (stats.month.monthKey !== month) {
    stats.month = { monthKey: month, prompts: 0, savedTokens: 0 };
  }
  return stats;
}

export function bumpGlobalTimeBuckets(stats: GlobalStatsSnapshot, now = new Date()): GlobalStatsSnapshot {
  const today = now.toISOString().slice(0, 10);
  const week = getWeekKey(now);
  const month = getMonthKey(now);

  if (stats.today.date !== today) {
    stats.today = { date: today, prompts: 0, savedTokens: 0 };
  }
  if (stats.week.weekKey !== week) {
    stats.week = { weekKey: week, prompts: 0, savedTokens: 0 };
  }
  if (stats.month.monthKey !== month) {
    stats.month = { monthKey: month, prompts: 0, savedTokens: 0 };
  }
  return stats;
}

export function isRetrievalMode(value: string): value is RetrievalMode {
  return value === "economy" || value === "balanced" || value === "quality";
}
