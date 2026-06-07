import fs from "node:fs";
import { claudeMdPath } from "./paths";

export interface ClaudeMdInstallResult {
  filePath: string;
  created: boolean;
  updated: boolean;
}

const START_MARKER = "<!-- context-compass:start -->";
const END_MARKER = "<!-- context-compass:end -->";

const CLAUDE_MD_SECTION = `${START_MARKER}
## Context Compass — ZORUNLU
Herhangi bir kod görevini anlamak için dosyaları okumadan önce,
görev açıklamasıyla birlikte mcp__context-compass__get_relevant_context aracını ÇAĞIRMALISINIZ.
Bunu, keşif amacıyla Glob, Grep veya Read kullanmadan ÖNCE yapın.
Yalnızca kullanıcının doğrudan adını verdiği belirli bir dosyayı düzenliyorsanız bu adımı atlayın.
${END_MARKER}
`;

export function ensureClaudeMdInstruction(projectRoot: string): ClaudeMdInstallResult {
  const filePath = claudeMdPath(projectRoot);
  const exists = fs.existsSync(filePath);
  const previous = exists ? fs.readFileSync(filePath, "utf8") : "";

  const next = buildNextClaudeMd(previous);
  const updated = !exists || previous !== next;

  if (updated) {
    fs.writeFileSync(filePath, next, "utf8");
  }

  return {
    filePath,
    created: !exists,
    updated
  };
}

function buildNextClaudeMd(previous: string): string {
  const trimmedPrevious = previous.replace(/\s+$/u, "");
  const block = CLAUDE_MD_SECTION.trimEnd();

  const startIndex = previous.indexOf(START_MARKER);
  const endIndex = previous.indexOf(END_MARKER);

  if (startIndex >= 0 && endIndex > startIndex) {
    const afterEnd = endIndex + END_MARKER.length;
    const prefix = previous.slice(0, startIndex).replace(/\s+$/u, "");
    const suffix = previous.slice(afterEnd).replace(/^\s+/u, "");

    if (!prefix && !suffix) {
      return `${block}\n`;
    }
    if (!prefix) {
      return `${block}\n\n${suffix.replace(/\s+$/u, "")}\n`;
    }
    if (!suffix) {
      return `${prefix}\n\n${block}\n`;
    }

    return `${prefix}\n\n${block}\n\n${suffix.replace(/\s+$/u, "")}\n`;
  }

  if (!trimmedPrevious) {
    return `${block}\n`;
  }

  return `${trimmedPrevious}\n\n${block}\n`;
}
