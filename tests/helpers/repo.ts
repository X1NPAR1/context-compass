import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(root, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
}

export function initGitRepo(root: string): void {
  run("git", ["init"], root);
  run("git", ["add", "."], root);
  run("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-m", "init"], root);
}

export function removeDir(root: string): void {
  fs.rmSync(root, { recursive: true, force: true });
}

export function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
}
