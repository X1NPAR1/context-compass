import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runEvalCommand } from "../../src/commands/eval";
import { runInitCommand } from "../../src/commands/init";
import { initGitRepo, makeTempDir, removeDir, writeFiles } from "../helpers/repo";

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      removeDir(dir);
    }
  }
});

describe("CLI integration: init + eval", () => {
  it("initializes tiny repo and writes expected integration artifacts", async () => {
    const projectRoot = makeTempDir("context-compass-init-");
    createdDirs.push(projectRoot);

    writeFiles(projectRoot, {
      "app.py": [
        "def greet(name: str) -> str:",
        "    return f'Hello {name}'",
        "",
        "def run() -> None:",
        "    print(greet('World'))",
        ""
      ].join("\n")
    });
    initGitRepo(projectRoot);

    const code = await runInitCommand(projectRoot);
    expect(code).toBe(0);

    expect(fs.existsSync(path.join(projectRoot, ".mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, ".claude", "settings.local.json"))).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".claude", "skills", "context-compass-explore", "SKILL.md"))
    ).toBe(true);
    expect(
      fs.existsSync(path.join(projectRoot, ".claude", "skills", "context-compass-review", "SKILL.md"))
    ).toBe(true);
  });

  it("returns machine-readable eval json payload", async () => {
    const projectRoot = makeTempDir("context-compass-eval-");
    createdDirs.push(projectRoot);

    writeFiles(projectRoot, {
      "main.py": [
        "def alpha() -> int:",
        "    return 1",
        "",
        "def beta() -> int:",
        "    return alpha() + 1",
        ""
      ].join("\n")
    });
    initGitRepo(projectRoot);

    expect(await runInitCommand(projectRoot)).toBe(0);

    const lines: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
      lines.push(String(msg ?? ""));
    });

    const code = await runEvalCommand(projectRoot, { json: true });
    logSpy.mockRestore();

    expect(code).toBe(0);
    const jsonText = lines.find((line) => line.trim().startsWith("{"));
    expect(jsonText).toBeTruthy();

    const payload = JSON.parse(String(jsonText));
    expect(payload).toHaveProperty("repo");
    expect(payload).toHaveProperty("functions");
    expect(payload).toHaveProperty("connections");
    expect(payload).toHaveProperty("test_sessions");
    expect(payload).toHaveProperty("same_file_recall_at_10");
    expect(payload).toHaveProperty("context_compass_recall_at_10");
    expect(payload).toHaveProperty("same_file_tokens");
    expect(payload).toHaveProperty("context_compass_tokens");
  });
});
