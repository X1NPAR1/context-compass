import fs from "node:fs";
import { projectMcpConfigPath } from "./paths";

interface McpConfigFile {
  mcpServers?: Record<string, {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
  [key: string]: unknown;
}

export interface McpInstallResult {
  configPath: string;
  created: boolean;
  updated: boolean;
}

const SERVER_NAME = "context-compass";
const EXPECTED_SERVER = {
  command: "context-compass",
  args: ["serve"],
  env: {}
};

export function ensureProjectMcpConfig(projectRoot: string): McpInstallResult {
  const configPath = projectMcpConfigPath(projectRoot);
  const created = !fs.existsSync(configPath);

  const existing = created ? {} : safeReadConfig(configPath);
  const next: McpConfigFile = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      [SERVER_NAME]: EXPECTED_SERVER
    }
  };

  const prevText = created ? "" : fs.readFileSync(configPath, "utf8");
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  const updated = created || prevText !== nextText;

  if (updated) {
    fs.writeFileSync(configPath, nextText, "utf8");
  }

  return {
    configPath,
    created,
    updated
  };
}

function safeReadConfig(configPath: string): McpConfigFile {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw) as McpConfigFile;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
}
