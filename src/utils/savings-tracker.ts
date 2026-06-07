import path from "node:path";
import crypto from "node:crypto";
import {
  bumpGlobalTimeBuckets,
  bumpTimeBuckets,
  loadGlobalStats,
  loadStats,
  saveGlobalStats,
  saveStats
} from "./config";
import { SavingsEvent } from "../types";

const DOMAIN_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "like",
  "now",
  "of",
  "on",
  "one",
  "or",
  "real",
  "the",
  "this",
  "to",
  "we",
  "with",
  "you"
]);

export async function recordSavingsEvent(event: SavingsEvent): Promise<void> {
  try {
    const now = new Date(event.timestamp);
    const saved = Math.max(0, event.savedTokens);
    const normalizedProjectRoot = normalizeProjectRoot(event.projectRoot);
    const projectName = path.basename(normalizedProjectRoot) || normalizedProjectRoot;
    const domains = sanitizeDomains(event.domains);

    const projectStats = bumpTimeBuckets(loadStats(normalizedProjectRoot), now);
    projectStats.today.prompts += 1;
    projectStats.today.savedTokens += saved;
    projectStats.week.prompts += 1;
    projectStats.week.savedTokens += saved;
    projectStats.month.prompts += 1;
    projectStats.month.savedTokens += saved;
    projectStats.lifetime.prompts += 1;
    projectStats.lifetime.savedTokens += saved;
    projectStats.sourceCounts[event.source] += 1;
    projectStats.modeCounts[event.mode] += 1;
    projectStats.index.lastUpdatedAt = event.timestamp;

    for (const domain of domains) {
      projectStats.topDomains[domain] = (projectStats.topDomains[domain] ?? 0) + 1;
    }

    saveStats(normalizedProjectRoot, projectStats);

    if (isGlobalStatsEnabled()) {
      const globalStats = bumpGlobalTimeBuckets(loadGlobalStats(), now);
      globalStats.today.prompts += 1;
      globalStats.today.savedTokens += saved;
      globalStats.week.prompts += 1;
      globalStats.week.savedTokens += saved;
      globalStats.month.prompts += 1;
      globalStats.month.savedTokens += saved;
      globalStats.lifetime.prompts += 1;
      globalStats.lifetime.savedTokens += saved;
      globalStats.sourceCounts[event.source] += 1;
      globalStats.modeCounts[event.mode] += 1;

      const projectKey = globalProjectKey(normalizedProjectRoot);
      const currentProject = globalStats.projects[projectKey] ?? {
        name: projectName,
        prompts: 0,
        savedTokens: 0,
        lastUpdatedAt: 0
      };
      currentProject.name = projectName;
      currentProject.prompts += 1;
      currentProject.savedTokens += saved;
      currentProject.lastUpdatedAt = event.timestamp;
      globalStats.projects[projectKey] = currentProject;

      if (isGlobalDomainTrackingEnabled()) {
        for (const domain of domains) {
          globalStats.topDomains[domain] = (globalStats.topDomains[domain] ?? 0) + 1;
        }
      }

      saveGlobalStats(globalStats);
    }
  } catch {
    // Telemetri kalıcılık hataları yüzünden hook/MCP akışını asla bozma.
  }
}

function sanitizeDomains(domains: string[]): string[] {
  const clean: string[] = [];
  const dedupe = new Set<string>();

  for (const raw of domains) {
    const term = raw.trim().toLowerCase();
    if (!term) {
      continue;
    }
    if (term.length < 3 || DOMAIN_STOPWORDS.has(term)) {
      continue;
    }
    if (dedupe.has(term)) {
      continue;
    }
    dedupe.add(term);
    clean.push(term);
  }

  return clean;
}

function normalizeProjectRoot(projectRoot: string): string {
  try {
    return path.resolve(projectRoot);
  } catch {
    return projectRoot;
  }
}

function globalProjectKey(projectRoot: string): string {
  const digest = crypto.createHash("sha256").update(projectRoot).digest("hex").slice(0, 16);
  return `project_${digest}`;
}

function isGlobalStatsEnabled(): boolean {
  const raw = process.env.CONTEXT_COMPASS_DISABLE_GLOBAL_STATS?.trim().toLowerCase();
  return raw !== "1" && raw !== "true" && raw !== "yes";
}

function isGlobalDomainTrackingEnabled(): boolean {
  const raw = process.env.CONTEXT_COMPASS_ENABLE_GLOBAL_DOMAINS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}
