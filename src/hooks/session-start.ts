import fs from "node:fs";
import { indexDbPath } from "../utils/paths";
import { logError } from "../utils/errors";

const READY_CONTEXT = [
  "Bu proje, fonksiyon ilişkilerini git geçmişinden önceden hesaplayan bir kod tabanı zekâ sistemi olan Context Compass'ı kullanır; bu ilişkilere statik analizle görülemeyen modüller arası bağımlılıklar da dâhildir.",
  "",
  "Kod tabanını anlamak için dosyaları OKUMADAN ÖNCE, görev açıklamanızla birlikte get_relevant_context MCP aracını çağırın. Bu araç, dosya keşfine göre daha hızlı ve daha eksiksiz olan önceden hesaplanmış bağlam paketlerini döndürür.",
  "",
  "Kullanılabilir MCP araçları:",
  "- get_relevant_context: herhangi bir görev için buradan başlayın.",
  "- get_function_bundle: tek bir fonksiyon için ayrıntılı bağlam.",
  "- search_functions: fonksiyonları ada veya anahtar kelimeye göre bulun.",
  "- get_project_overview: proje haritası ve önemli bağlantılar.",
  "",
  "Bu araçlar, dosya okumanın keşfedemeyeceği davranışsal co-edit (birlikte değişme) örüntülerini git geçmişinden ortaya çıkarır.",
  "",
  "Devam etmeden önce ŞİMDİ mevcut görevin açıklamasıyla mcp__context-compass__get_relevant_context aracını ÇAĞIRMALISINIZ."
].join("\n");

const MISSING_INDEX_CONTEXT = [
  "Context Compass yapılandırılmış ancak bu projenin indeksi eksik.",
  "Önce 'context-compass init' komutunu çalıştırın, ardından dosyaları okumadan önce get_relevant_context ile başlayın.",
  "Gerekirse kod tabanının hızlı bir haritası için get_project_overview aracını çağırın."
].join(" ");

export async function runSessionStartHook(): Promise<number> {
  const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  try {
    const hasIndex = fs.existsSync(indexDbPath(projectRoot));
    const additionalContext = hasIndex ? READY_CONTEXT : MISSING_INDEX_CONTEXT;

    process.stdout.write(
      `${JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext
        }
      })}\n`
    );

    return 0;
  } catch (error) {
    logError(projectRoot, error, "hook_session_start");
    process.stdout.write(`${JSON.stringify({ continue: true })}\n`);
    return 0;
  }
}
