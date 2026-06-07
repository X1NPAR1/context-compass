import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { SupportedLanguage } from "../types";

const SUPPORTED_EXTS: Record<string, SupportedLanguage> = {
  ".py": "python",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".rb": "ruby",
  ".php": "php",
  ".phtml": "php",
  ".kt": "kotlin",
  ".kts": "kotlin"
};

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  ".context-compass",
  ".claude",
  "dist",
  "build",
  "coverage"
]);

const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

export function detectLanguageByPath(filePath: string): SupportedLanguage | null {
  return SUPPORTED_EXTS[path.extname(filePath).toLowerCase()] ?? null;
}

export function isTestPath(filePath: string): boolean {
  const p = filePath.toLowerCase();
  return p.includes("/test") || p.includes("/tests") || p.includes(".test.") || p.includes("_test.") || p.includes("spec.");
}

export function listSourceFiles(projectRoot: string): string[] {
  const fromGit = listSourceFilesFromGit(projectRoot);
  if (fromGit) {
    return fromGit;
  }

  const out: string[] = [];

  function walk(dir: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) {
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const rel = path.relative(projectRoot, full).split(path.sep).join("/");
      if (detectLanguageByPath(rel)) {
        out.push(rel);
      }
    }
  }

  walk(projectRoot);
  out.sort();
  return out;
}

export function readTextFile(projectRoot: string, relPath: string): string {
  const fullPath = path.join(projectRoot, relPath);
  const stat = fs.lstatSync(fullPath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Skipping symlink: ${relPath}`);
  }
  if (stat.size > MAX_TEXT_FILE_BYTES) {
    throw new Error(`Skipping oversized file (${Math.ceil(MAX_TEXT_FILE_BYTES / 1024)}KB+): ${relPath}`);
  }

  const bytes = fs.readFileSync(fullPath);
  if (looksBinary(bytes)) {
    throw new Error(`Skipping binary-like file: ${relPath}`);
  }

  return bytes.toString("utf8");
}

export function fileMtimeMs(projectRoot: string, relPath: string): number {
  return fs.statSync(path.join(projectRoot, relPath)).mtimeMs;
}

export function contentHash(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}

export function detectLanguagesFromFiles(files: string[]): SupportedLanguage[] {
  const langs = new Set<SupportedLanguage>();
  for (const file of files) {
    const lang = detectLanguageByPath(file);
    if (lang) {
      langs.add(lang);
    }
  }
  return Array.from(langs);
}

function listSourceFilesFromGit(projectRoot: string): string[] | null {
  const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });

  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return null;
  }

  const ls = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  if (ls.status !== 0) {
    return null;
  }

  const out: string[] = [];
  for (const line of ls.stdout.split(/\r?\n/)) {
    const rel = line.trim();
    if (!rel) {
      continue;
    }

    if (!detectLanguageByPath(rel)) {
      continue;
    }

    const fullPath = path.join(projectRoot, rel);
    try {
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        continue;
      }
      out.push(rel.split(path.sep).join("/"));
    } catch {
      continue;
    }
  }

  out.sort();
  return out;
}

function looksBinary(bytes: Buffer): boolean {
  if (bytes.length === 0) {
    return false;
  }

  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return true;
    }
    if ((byte < 7 || (byte > 14 && byte < 32)) && byte !== 9 && byte !== 10 && byte !== 13) {
      suspicious += 1;
    }
  }

  return suspicious / sample.length > 0.3;
}
