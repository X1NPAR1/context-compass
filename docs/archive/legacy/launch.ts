import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { defaultConfig, loadConfig } from "../utils/config";
import { ContextDb } from "../utils/db";
import { contextDir, indexDbPath, projectMapPath } from "../utils/paths";
import { logError } from "../utils/errors";
import { Indexer } from "../core/indexer";
import { FileWatcher } from "../core/file-watcher";

type JsonMap = Record<string, unknown>;

export async function runLaunchCommand(projectRoot: string): Promise<number> {
  console.log("⟡ Context Compass");

  const dbPath = indexDbPath(projectRoot);
  if (!fs.existsSync(dbPath)) {
    console.error("  Index not found. Run 'context-compass init' first.");
    return 1;
  }

  const db = await ContextDb.open(projectRoot);
  const cfg = loadConfig(projectRoot) ?? defaultConfig();
  const indexer = new Indexer(projectRoot, db);

  try {
    const counts = db.getIndexCounts();
    console.log(`  ✓ Index loaded (${counts.functions} functions, ${counts.connections} connections)`);

    const changed = indexer.detectChangedFiles();
    if (changed.length > 0) {
      console.log(`  ✓ ${changed.length} files changed — updating...`);
      await indexer.incrementalUpdate(
        {
          maxCommits: cfg.thresholds.maxCommits,
          maxSessionFunctions: cfg.thresholds.maxSessionFunctions,
          topKNeighbors: cfg.thresholds.topKNeighbors
        },
        changed
      );
    }

    let hookRegistered = false;
    try {
      ensureUserPromptHook(projectRoot);
      hookRegistered = true;
    } catch (error) {
      logError(projectRoot, error, "launch_register_hook");
      console.log("  ⚠ Hook registration failed; continuing without prompt enrichment hook setup");
      setupProjectMapFallback(projectRoot, db);
      console.log("  ⚠ Fallback enabled via .context-compass/PROJECT_MAP.md + CLAUDE.md reference");
    }

    if (!hookRegistered) {
      // keep runtime behavior explicit in logs
      logError(projectRoot, "UserPromptSubmit hook unavailable, using PROJECT_MAP fallback", "launch_hook_fallback");
    }

    if (!isInteractiveTty()) {
      console.error("  Interactive Claude Code launch requires a TTY terminal.");
      console.error("  Run `context-compass` directly in your terminal (not via a non-interactive pipe).");
      return 1;
    }

    if (!isClaudeAvailable()) {
      console.error("  Claude Code not found. Install it with: npm install -g @anthropic-ai/claude-code");
      return 1;
    }

    console.log("  → Launching Claude Code");

    const watcher = new FileWatcher({
      projectRoot,
      indexer,
      indexerOptions: {
        maxCommits: cfg.thresholds.maxCommits,
        maxSessionFunctions: cfg.thresholds.maxSessionFunctions,
        topKNeighbors: cfg.thresholds.topKNeighbors
      }
    });
    watcher.start();

    const code = await spawnClaude(projectRoot);
    await watcher.stop();
    return code;
  } catch (error) {
    logError(projectRoot, error, "launch_command");
    console.error("Launch failed. Check .context-compass/error.log for details.");
    return 1;
  } finally {
    db.close();
  }
}

function ensureUserPromptHook(projectRoot: string): void {
  const claudeDir = path.join(projectRoot, ".claude");
  const settingsPath = path.join(claudeDir, "settings.local.json");
  fs.mkdirSync(claudeDir, { recursive: true });

  const existing = fs.existsSync(settingsPath) ? safeReadJson(settingsPath) : {};
  const settings = (existing ?? {}) as JsonMap;

  const hooks = (settings.hooks as JsonMap) ?? {};
  const userPrompt = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [];

  const command = "context-compass hook-prompt";
  let hasExisting = false;
  for (const group of userPrompt) {
    const hookGroup = group as JsonMap;
    const handlers = Array.isArray(hookGroup.hooks) ? hookGroup.hooks : [];
    const containsCommand = handlers.some((handler) => (handler as JsonMap).command === command);
    if (!containsCommand) {
      continue;
    }
    hasExisting = true;
    if ("matcher" in hookGroup) {
      delete hookGroup.matcher;
    }
  }

  if (!hasExisting) {
    userPrompt.push({
      hooks: [
        {
          type: "command",
          command
        }
      ]
    });
  }

  hooks.UserPromptSubmit = userPrompt;
  settings.hooks = hooks;
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

async function spawnClaude(projectRoot: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("claude", [], {
      cwd: projectRoot,
      stdio: "inherit",
      shell: false,
      env: {
        ...process.env,
        CONTEXT_COMPASS_PROJECT_ROOT: projectRoot,
        CONTEXT_COMPASS_ENABLED: "1"
      }
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        console.error("  Claude Code not found. Install it with: npm install -g @anthropic-ai/claude-code");
      } else {
        console.error(`  Failed to launch Claude Code: ${error.message}`);
      }
      resolve(127);
    });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

function isInteractiveTty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function isClaudeAvailable(): boolean {
  const check = spawnSync("claude", ["--version"], {
    stdio: "ignore",
    shell: false,
    env: process.env
  });
  if (check.error) {
    const code = (check.error as NodeJS.ErrnoException).code;
    return code !== "ENOENT" ? false : false;
  }
  return check.status === 0;
}

function safeReadJson(filePath: string): JsonMap {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as JsonMap;
  } catch {
    return {};
  }
}

function setupProjectMapFallback(projectRoot: string, db: ContextDb): void {
  const mapPath = projectMapPath(projectRoot);
  fs.mkdirSync(contextDir(projectRoot), { recursive: true });

  const moduleSummary = db.getModuleSummary(20);
  const hotSymbols = db.getTopHotSymbols(12);
  const topConnections = db.getTopConnections(15);

  const lines: string[] = [];
  lines.push("# Context Compass Project Map");
  lines.push("");
  lines.push("This file is generated as a fallback when prompt hook registration is unavailable.");
  lines.push("Use it as a navigation head-start for common tasks.");
  lines.push("");
  lines.push("## Module Overview");
  for (const module of moduleSummary) {
    lines.push(
      `- ${module.filePath} · symbols=${module.symbolCount} · heat=${Number(module.totalHeat ?? 0).toFixed(0)}`
    );
  }
  lines.push("");
  lines.push("## Hottest Functions");
  for (const symbol of hotSymbols) {
    lines.push(`- ${symbol.qualifiedName} (${symbol.filePath}) · heat=${Number(symbol.heatScore ?? 0).toFixed(0)}`);
  }
  lines.push("");
  lines.push("## Cross-Module Connections (PMI)");
  for (const edge of topConnections) {
    const a = `${edge.aName} (${edge.aFilePath})`;
    const b = `${edge.bName} (${edge.bFilePath})`;
    lines.push(`- ${a} ↔ ${b} · pmi=${Number(edge.pmi).toFixed(3)}`);
  }
  lines.push("");
  lines.push("## Common Task Patterns");
  lines.push("- Bug fix: start with hottest symbols in the affected module, then inspect top PMI neighbors.");
  lines.push("- Feature work: inspect module overview first, then choose entrypoint functions by heat.");
  lines.push("- Testing: follow symbols in test files and symbols with TEST relationships.");
  lines.push("");

  fs.writeFileSync(mapPath, `${lines.join("\n")}\n`, "utf8");
  ensureClaudeMdProjectMapReference(projectRoot);
}

function ensureClaudeMdProjectMapReference(projectRoot: string): void {
  const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
  const reference = "@.context-compass/PROJECT_MAP.md";
  const line = `- Read ${reference} before starting tasks to accelerate code navigation.`;

  if (!fs.existsSync(claudeMdPath)) {
    fs.writeFileSync(
      claudeMdPath,
      `# CLAUDE Instructions\n\n## Context Compass\n${line}\n`,
      "utf8"
    );
    return;
  }

  const existing = fs.readFileSync(claudeMdPath, "utf8");
  if (existing.includes(reference)) {
    return;
  }
  const needsNewline = existing.length > 0 && !existing.endsWith("\n");
  const next = `${existing}${needsNewline ? "\n" : ""}\n## Context Compass\n${line}\n`;
  fs.writeFileSync(claudeMdPath, next, "utf8");
}
