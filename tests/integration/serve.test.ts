import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it } from "vitest";
import { formatMissingIndexMessage } from "../../src/commands/serve";
import { makeTempDir, removeDir } from "../helpers/repo";

const createdDirs: string[] = [];
const requireFromTest = createRequire(import.meta.url);

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      removeDir(dir);
    }
  }
});

describe("CLI integration: serve", () => {
  it("returns clear missing-index guidance text", () => {
    const message = formatMissingIndexMessage();
    expect(message).toContain("context-compass init");
    expect(message.toLowerCase()).toContain("index is not available");
  });

  it("starts serve process without crashing when index is missing", async () => {
    const projectRoot = makeTempDir("context-compass-serve-");
    createdDirs.push(projectRoot);

    const distCli = path.resolve(process.cwd(), "dist", "cli.js");
    const hasDist = fs.existsSync(distCli);

    const child = hasDist
      ? spawn(process.execPath, [distCli, "serve"], { cwd: projectRoot, stdio: ["pipe", "pipe", "pipe"] })
      : spawn(process.execPath, [requireFromTest.resolve("tsx/dist/cli.mjs"), path.resolve("src/cli.ts"), "serve"], {
          cwd: process.cwd(),
          stdio: ["pipe", "pipe", "pipe"]
        });

    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(child.exitCode).toBeNull();

    child.kill();
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      setTimeout(() => resolve(), 1500);
    });
  });
});
