import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureProjectMcpConfig } from "../../src/utils/mcp-config";
import { makeTempDir, removeDir } from "../helpers/repo";

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      removeDir(dir);
    }
  }
});

describe("mcp config", () => {
  it("recovers from malformed .mcp.json and writes valid config", () => {
    const projectRoot = makeTempDir("context-compass-mcp-config-");
    createdDirs.push(projectRoot);

    const mcpPath = path.join(projectRoot, ".mcp.json");
    fs.writeFileSync(mcpPath, "{bad json", "utf8");

    const result = ensureProjectMcpConfig(projectRoot);
    expect(result.created).toBe(false);
    expect(result.updated).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(mcpPath, "utf8")) as {
      mcpServers?: Record<string, { command?: string; args?: string[] }>;
    };

    expect(parsed.mcpServers?.["context-compass"]?.command).toBe("context-compass");
    expect(parsed.mcpServers?.["context-compass"]?.args).toEqual(["serve"]);
  });
});
