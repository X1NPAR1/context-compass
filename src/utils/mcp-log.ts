import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { countTokens } from "./tokens";
import { ensureDir } from "./errors";
import { mcpLogPath } from "./paths";
import { McpLogRecord } from "../types";

const MAX_MCP_LOG_BYTES = 2 * 1024 * 1024;

export function appendMcpLog(projectRoot: string, entry: Omit<McpLogRecord, "timestamp" | "responseTokens"> & {
  responseText: string;
}): void {
  try {
    const logPath = mcpLogPath(projectRoot);
    ensureDir(path.dirname(logPath));
    rotateLogIfNeeded(logPath, MAX_MCP_LOG_BYTES);
    const line: McpLogRecord = {
      timestamp: new Date().toISOString(),
      tool: entry.tool,
      input: redactForLog(entry.input),
      latencyMs: entry.latencyMs,
      responseTokens: countTokens(entry.responseText),
      success: entry.success,
      error: entry.error
    };
    fs.appendFileSync(logPath, `${JSON.stringify(line)}\n`, "utf8");
  } catch {
    // MCP yanıtlarını hızlı ve dayanıklı tutmak için günlükleme hatalarını yut.
  }
}

function rotateLogIfNeeded(logPath: string, maxBytes: number): void {
  if (!fs.existsSync(logPath)) {
    return;
  }

  const stat = fs.statSync(logPath);
  if (stat.size < maxBytes) {
    return;
  }

  const rotated = `${logPath}.1`;
  try {
    if (fs.existsSync(rotated)) {
      fs.unlinkSync(rotated);
    }
  } catch {
    // yok say
  }
  fs.renameSync(logPath, rotated);
}

function redactForLog(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return {
      type: "string",
      length: value.length,
      sha256: shortSha(value)
    };
  }
  if (depth > 3) {
    return { type: "truncated" };
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      length: value.length,
      sample: value.slice(0, 5).map((item) => redactForLog(item, depth + 1))
    };
  }
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const keys = Object.keys(input).slice(0, 20);
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = redactForLog(input[key], depth + 1);
    }
    return {
      type: "object",
      keys,
      value: out
    };
  }

  return { type: typeof value };
}

function shortSha(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 12);
}
