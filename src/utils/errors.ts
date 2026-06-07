import fs from "node:fs";
import path from "node:path";
import { errorLogPath } from "./paths";

const MAX_ERROR_LOG_BYTES = 2 * 1024 * 1024;

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function logError(projectRoot: string, error: unknown, context?: string): void {
  try {
    const logPath = errorLogPath(projectRoot);
    ensureDir(path.dirname(logPath));
    rotateLogIfNeeded(logPath, MAX_ERROR_LOG_BYTES);

    const time = new Date().toISOString();
    const message = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
    const line = `[${time}]${context ? ` [${context}]` : ""} ${message}\n`;
    fs.appendFileSync(logPath, line, "utf8");
  } catch {
    // Zincirleme hataları önlemek için tüm günlükleyici hatalarını yut.
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
