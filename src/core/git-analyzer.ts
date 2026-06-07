import { simpleGit, SimpleGit } from "simple-git";
import { GitSession } from "../types";
import { ContextDb, FunctionRangeRow } from "../utils/db";
import { logError } from "../utils/errors";

interface CommitRef {
  sha: string;
  ts: number;
  files: string[];
}

export interface GitAnalysisResult {
  sessions: GitSession[];
  headCommit: string | null;
}

const SUPPORTED_PATHS = [
  "*.py",
  "*.ts",
  "*.tsx",
  "*.js",
  "*.jsx",
  "*.mjs",
  "*.cjs",
  "*.go",
  "*.rs",
  "*.java",
  "*.cs",
  "*.rb",
  "*.php",
  "*.phtml",
  "*.kt",
  "*.kts"
];
const RECENT_HUNK_COMMIT_COUNT = 100;

export class GitAnalyzer {
  private readonly git: SimpleGit;

  constructor(private readonly projectRoot: string, private readonly db: ContextDb) {
    this.git = simpleGit(projectRoot);
  }

  async analyze(maxCommits: number, maxSessionFunctions: number): Promise<GitAnalysisResult> {
    try {
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        return { sessions: [], headCommit: null };
      }

      const headCommit = await this.tryResolveHeadCommit();
      if (!headCommit) {
        return { sessions: [], headCommit: null };
      }
      const commits = await this.loadCommitRefsWithFiles(maxCommits);
      const sessions: GitSession[] = [];

      const functionRanges = this.db.getFunctionRanges();
      const rangesByFile = indexRangesByFile(functionRanges);
      const symbolIdsByFile = indexSymbolIdsByFile(functionRanges);

      for (let commitIndex = 0; commitIndex < commits.length; commitIndex += 1) {
        const commit = commits[commitIndex];
        const relevantFiles = commit.files.filter((file) => symbolIdsByFile.has(file));
        if (relevantFiles.length === 0) {
          continue;
        }

        const symbols = new Set<string>();
        const useHunkMapping = commitIndex < RECENT_HUNK_COMMIT_COUNT;

        if (!useHunkMapping) {
          for (const filePath of relevantFiles) {
            const ids = symbolIdsByFile.get(filePath) ?? [];
            for (const id of ids) {
              symbols.add(id);
            }
          }
        } else {
          const patch = await this.git.raw(["show", "--unified=0", "--format=", "--no-color", commit.sha, "--", ...relevantFiles]);
          const changedLinesByFile = parsePatchChangedLines(patch);

          for (const filePath of relevantFiles) {
            const ranges = rangesByFile.get(filePath) ?? [];
            const lines = changedLinesByFile.get(filePath);

            if (!lines || lines.size === 0) {
              const ids = symbolIdsByFile.get(filePath) ?? [];
              for (const id of ids) {
                symbols.add(id);
              }
              continue;
            }

            const mapped = mapChangedLinesToSymbols(ranges, lines);
            if (mapped.length === 0) {
              const ids = symbolIdsByFile.get(filePath) ?? [];
              for (const id of ids) {
                symbols.add(id);
              }
            } else {
              for (const id of mapped) {
                symbols.add(id);
              }
            }
          }
        }

        if (symbols.size >= 1 && symbols.size <= maxSessionFunctions) {
          sessions.push({
            commitSha: commit.sha,
            commitTs: commit.ts,
            functionCount: symbols.size,
            symbolIds: Array.from(symbols)
          });
        }
      }

      return { sessions, headCommit };
    } catch (error) {
      logError(this.projectRoot, error, "git_analyzer");
      return { sessions: [], headCommit: null };
    }
  }

  private async tryResolveHeadCommit(): Promise<string | null> {
    try {
      const head = (await this.git.revparse(["HEAD"])).trim();
      return head || null;
    } catch {
      return null;
    }
  }

  private async loadCommitRefsWithFiles(limit: number): Promise<CommitRef[]> {
    const raw = await this.git.raw([
      "log",
      `-${limit}`,
      "--no-merges",
      "--name-only",
      "--pretty=format:__CC__%H|%ct",
      "--",
      ...SUPPORTED_PATHS
    ]);

    const commits: CommitRef[] = [];
    let current: CommitRef | null = null;

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      if (trimmed.startsWith("__CC__")) {
        if (current) {
          current.files = Array.from(new Set(current.files));
          commits.push(current);
        }
        const payload = trimmed.slice("__CC__".length);
        const [sha, ts] = payload.split("|");
        if (!sha || !ts) {
          current = null;
          continue;
        }
        current = {
          sha,
          ts: Number(ts) || 0,
          files: []
        };
        continue;
      }

      if (current) {
        current.files.push(trimmed);
      }
    }

    if (current) {
      current.files = Array.from(new Set(current.files));
      commits.push(current);
    }

    return commits;
  }
}

function parsePatchChangedLines(patch: string): Map<string, Set<number>> {
  const fileLines = new Map<string, Set<number>>();
  const lines = patch.split("\n");
  let currentFile: string | null = null;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      currentFile = match?.[2] ?? null;
      continue;
    }

    if (!currentFile) {
      continue;
    }

    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (!match) {
        continue;
      }

      const oldStart = Number(match[1]);
      const oldLen = Number(match[2] ?? "1");
      const newStart = Number(match[3]);
      const newLen = Number(match[4] ?? "1");
      const set = fileLines.get(currentFile) ?? new Set<number>();

      if (oldLen > 0) {
        for (let i = 0; i < oldLen; i += 1) {
          set.add(oldStart + i);
        }
      }
      if (newLen > 0) {
        for (let i = 0; i < newLen; i += 1) {
          set.add(newStart + i);
        }
      }
      fileLines.set(currentFile, set);
    }
  }

  return fileLines;
}

function indexRangesByFile(
  rows: FunctionRangeRow[]
): Map<string, Array<{ symbolId: string; startLine: number; endLine: number }>> {
  const byFile = new Map<string, Array<{ symbolId: string; startLine: number; endLine: number }>>();
  for (const row of rows) {
    const list = byFile.get(row.filePath) ?? [];
    list.push({
      symbolId: row.symbolId,
      startLine: row.startLine,
      endLine: row.endLine
    });
    byFile.set(row.filePath, list);
  }
  return byFile;
}

function indexSymbolIdsByFile(rows: FunctionRangeRow[]): Map<string, string[]> {
  const byFile = new Map<string, string[]>();
  for (const row of rows) {
    const list = byFile.get(row.filePath) ?? [];
    list.push(row.symbolId);
    byFile.set(row.filePath, list);
  }
  return byFile;
}

function mapChangedLinesToSymbols(
  ranges: Array<{ symbolId: string; startLine: number; endLine: number }>,
  changedLines: Set<number>
): string[] {
  const out: string[] = [];
  for (const range of ranges) {
    for (let line = range.startLine; line <= range.endLine; line += 1) {
      if (changedLines.has(line)) {
        out.push(range.symbolId);
        break;
      }
    }
  }
  return out;
}
