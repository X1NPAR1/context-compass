import fs from "node:fs";
import { claudeDirPath, claudeLocalSettingsPath } from "./paths";

interface HookCommand {
  type?: string;
  command?: string;
  [key: string]: unknown;
}

interface HookGroup {
  hooks?: HookCommand[];
  [key: string]: unknown;
}

interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export interface HookInstallResult {
  settingsPath: string;
  created: boolean;
  updated: boolean;
}

const SESSION_START_COMMAND = "context-compass hook-session-start";
const LEGACY_PROMPT_COMMAND = "context-compass hook-prompt";

export function ensureSessionStartHook(projectRoot: string): HookInstallResult {
  const { settingsPath, created, settings, hooks } = readSettings(projectRoot);
  const groups: HookGroup[] = Array.isArray(hooks.SessionStart) ? hooks.SessionStart : [];

  let hasCommand = false;
  for (const group of groups) {
    const handlers = Array.isArray(group.hooks) ? group.hooks : [];
    if (handlers.some((handler) => handler.command === SESSION_START_COMMAND)) {
      hasCommand = true;
      break;
    }
  }

  if (!hasCommand) {
    groups.push({
      hooks: [
        {
          type: "command",
          command: SESSION_START_COMMAND
        }
      ]
    });
  }

  hooks.SessionStart = groups;
  removeHookCommand(hooks, "UserPromptSubmit", LEGACY_PROMPT_COMMAND);
  settings.hooks = hooks;

  const updated = writeSettings(settingsPath, created, settings);

  return {
    settingsPath,
    created,
    updated
  };
}

export function ensureUserPromptSubmitHook(projectRoot: string): HookInstallResult {
  const { settingsPath, created, settings, hooks } = readSettings(projectRoot);
  const groups: HookGroup[] = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : [];

  let hasCommand = false;
  for (const group of groups) {
    const handlers = Array.isArray(group.hooks) ? group.hooks : [];
    if (handlers.some((handler) => handler.command === LEGACY_PROMPT_COMMAND)) {
      hasCommand = true;
      break;
    }
  }

  if (!hasCommand) {
    groups.push({
      hooks: [
        {
          type: "command",
          command: LEGACY_PROMPT_COMMAND
        }
      ]
    });
  }

  hooks.UserPromptSubmit = groups;
  settings.hooks = hooks;

  const updated = writeSettings(settingsPath, created, settings);

  return { settingsPath, created, updated };
}

function readSettings(projectRoot: string): {
  settingsPath: string;
  created: boolean;
  settings: ClaudeSettings;
  hooks: Record<string, HookGroup[]>;
} {
  const settingsPath = claudeLocalSettingsPath(projectRoot);
  const created = !fs.existsSync(settingsPath);
  fs.mkdirSync(claudeDirPath(projectRoot), { recursive: true });

  const existing = created ? {} : safeReadSettings(settingsPath);
  const settings: ClaudeSettings = {
    ...existing,
    hooks: {
      ...(existing.hooks ?? {})
    }
  };

  return {
    settingsPath,
    created,
    settings,
    hooks: settings.hooks ?? {}
  };
}

function writeSettings(settingsPath: string, created: boolean, settings: ClaudeSettings): boolean {
  const nextText = `${JSON.stringify(settings, null, 2)}\n`;
  const prevText = created ? "" : fs.readFileSync(settingsPath, "utf8");
  const updated = created || prevText !== nextText;

  if (updated) {
    fs.writeFileSync(settingsPath, nextText, "utf8");
  }

  return updated;
}

function removeHookCommand(
  hooks: Record<string, HookGroup[]>,
  eventName: string,
  command: string
): void {
  const groups = Array.isArray(hooks[eventName]) ? hooks[eventName] : [];
  if (groups.length === 0) {
    return;
  }

  const nextGroups: HookGroup[] = [];
  for (const group of groups) {
    const handlers = Array.isArray(group.hooks) ? group.hooks : [];
    const nextHandlers = handlers.filter((handler) => handler.command !== command);
    if (nextHandlers.length > 0) {
      nextGroups.push({ ...group, hooks: nextHandlers });
    }
  }

  if (nextGroups.length === 0) {
    delete hooks[eventName];
    return;
  }

  hooks[eventName] = nextGroups;
}

function safeReadSettings(settingsPath: string): ClaudeSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as ClaudeSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
