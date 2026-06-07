import path from "node:path";
import os from "node:os";

export const CONTEXT_DIR_NAME = ".context-compass";

export function contextDir(projectRoot: string): string {
  return path.join(projectRoot, CONTEXT_DIR_NAME);
}

export function indexDbPath(projectRoot: string): string {
  return path.join(contextDir(projectRoot), "index.db");
}

export function configPath(projectRoot: string): string {
  return path.join(contextDir(projectRoot), "config.json");
}

export function statsPath(projectRoot: string): string {
  return path.join(contextDir(projectRoot), "stats.json");
}

export function userContextDir(): string {
  const fromEnv = process.env.CONTEXT_COMPASS_HOME?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return path.join(os.homedir(), CONTEXT_DIR_NAME);
}

export function globalStatsPath(): string {
  return path.join(userContextDir(), "global-stats.json");
}

export function errorLogPath(projectRoot: string): string {
  return path.join(contextDir(projectRoot), "error.log");
}

export function currentContextPath(projectRoot: string): string {
  return path.join(contextDir(projectRoot), "current-context.md");
}

export function activeContextPath(projectRoot: string): string {
  return path.join(contextDir(projectRoot), "active-context.md");
}

export function projectMapPath(projectRoot: string): string {
  return path.join(contextDir(projectRoot), "PROJECT_MAP.md");
}

export function mcpLogPath(projectRoot: string): string {
  return path.join(contextDir(projectRoot), "mcp-log.json");
}

export function projectMcpConfigPath(projectRoot: string): string {
  return path.join(projectRoot, ".mcp.json");
}

export function claudeDirPath(projectRoot: string): string {
  return path.join(projectRoot, ".claude");
}

export function claudeLocalSettingsPath(projectRoot: string): string {
  return path.join(claudeDirPath(projectRoot), "settings.local.json");
}

export function claudeSkillsPath(projectRoot: string): string {
  return path.join(claudeDirPath(projectRoot), "skills");
}

export function claudeMdPath(projectRoot: string): string {
  return path.join(projectRoot, "CLAUDE.md");
}
