import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendMcpLog } from "../../src/utils/mcp-log";
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

describe("mcp log", () => {
  it("redacts raw prompt-like input values", () => {
    const projectRoot = makeTempDir("context-compass-mcp-log-");
    createdDirs.push(projectRoot);

    appendMcpLog(projectRoot, {
      tool: "get_relevant_context",
      input: { prompt: "find security issue in payments module", max_results: 5 },
      latencyMs: 12,
      responseText: "bundle text",
      success: true
    });

    const logPath = path.join(projectRoot, ".context-compass", "mcp-log.json");
    expect(fs.existsSync(logPath)).toBe(true);

    const line = fs.readFileSync(logPath, "utf8").trim();
    expect(line).toBeTruthy();
    expect(line).not.toContain("find security issue in payments module");

    const parsed = JSON.parse(line) as {
      input: {
        type: string;
        value: {
          prompt: { type: string; length: number };
        };
      };
    };

    expect(parsed.input.type).toBe("object");
    expect(parsed.input.value.prompt.type).toBe("string");
    expect(parsed.input.value.prompt.length).toBeGreaterThan(0);
  });
});
