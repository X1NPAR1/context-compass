import fs from "node:fs";
import path from "node:path";

const FALLBACK_VERSION = "0.1.0";
let cachedVersion: string | null = null;

export function getPackageVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  const candidates = [
    path.resolve(__dirname, "..", "..", "package.json"),
    path.resolve(__dirname, "..", "package.json"),
    path.resolve(process.cwd(), "package.json")
  ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) {
        continue;
      }
      const parsed = JSON.parse(fs.readFileSync(candidate, "utf8")) as { version?: unknown };
      if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
        cachedVersion = parsed.version.trim();
        return cachedVersion;
      }
    } catch {
      // yok say ve sonraki adaya geç
    }
  }

  cachedVersion = FALLBACK_VERSION;
  return cachedVersion;
}
