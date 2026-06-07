import path from "node:path";
import { ensureUserPromptSubmitHook } from "../utils/claude-settings";
import { logError } from "../utils/errors";

export async function runEnableHookCommand(projectRoot: string): Promise<number> {
  try {
    const result = ensureUserPromptSubmitHook(projectRoot);
    const relPath = path.relative(projectRoot, result.settingsPath) || ".claude/settings.local.json";

    if (result.created) {
      console.log(`✓ ${relPath} oluşturuldu ve UserPromptSubmit yedek hook'u etkinleştirildi.`);
    } else if (result.updated) {
      console.log(`✓ ${relPath} güncellendi ve UserPromptSubmit yedek hook'u etkinleştirildi.`);
    } else {
      console.log(`✓ UserPromptSubmit yedek hook'u zaten ${relPath} içinde etkin.`);
    }

    return 0;
  } catch (error) {
    logError(projectRoot, error, "enable_hook_command");
    console.error("Yedek hook etkinleştirilemedi. Ayrıntılar için .context-compass/error.log dosyasına bakın.");
    return 1;
  }
}
