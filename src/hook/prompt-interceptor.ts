import fs from "node:fs";
import path from "node:path";
import { ContextDb } from "../utils/db";
import { activeContextPath } from "../utils/paths";
import { logError } from "../utils/errors";
import { getRelevantContextForPrompt, getRetrievalProfile } from "../core/context-retrieval";
import { loadConfig } from "../utils/config";
import { recordSavingsEvent } from "../utils/savings-tracker";

export async function runPromptInterceptor(): Promise<number> {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let db: ContextDb | null = null;

  try {
    const payload = await readJsonStdin();
    const rawPrompt = extractPrompt(payload);
    if (!rawPrompt) {
      writeHookResponse("");
      return 0;
    }

    db = await ContextDb.open(projectRoot);
    const cfg = loadConfig(projectRoot);
    const profile = getRetrievalProfile(cfg.retrieval.mode);
    const activeDb = db;
    const selected = getRelevantContextForPrompt(activeDb, rawPrompt, {
      mode: cfg.retrieval.mode,
      maxBundles: profile.maxBundles,
      maxContextChars: profile.maxContextChars
    });
    const additionalContext = selected.fullAdditionalContext;
    const activePath = activeContextPath(projectRoot);
    fs.mkdirSync(path.dirname(activePath), { recursive: true });
    fs.writeFileSync(activePath, additionalContext, "utf8");

    await recordSavingsEvent({
      timestamp: Date.now(),
      projectRoot,
      intent: selected.intent,
      domains: selected.keywords.slice(0, 5),
      actualBundleTokens: selected.actualBundleTokens,
      estimatedExplorationTokens: selected.estimatedExplorationTokens,
      savedTokens: Math.max(0, selected.estimatedExplorationTokens - selected.actualBundleTokens),
      mode: cfg.retrieval.mode,
      source: "hook"
    });

    writeHookResponse(selected.additionalContext);
    return 0;
  } catch (error) {
    logError(projectRoot, error, "prompt_interceptor");
    writeHookResponse("");
    return 0;
  } finally {
    db?.close();
  }
}

function extractPrompt(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const data = payload as {
    prompt?: unknown;
    userPrompt?: unknown;
    input?: {
      prompt?: unknown;
    };
    message?: unknown;
  };

  if (typeof data.prompt === "string") {
    return data.prompt;
  }
  if (typeof data.userPrompt === "string") {
    return data.userPrompt;
  }
  if (typeof data.input?.prompt === "string") {
    return data.input.prompt;
  }
  if (typeof data.message === "string") {
    return data.message;
  }
  return "";
}

async function readJsonStdin(): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

function writeHookResponse(additionalContext: string): void {
  const response = additionalContext
    ? {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext
        }
      }
    : { continue: true };

  process.stdout.write(`${JSON.stringify(response)}\n`);
}
