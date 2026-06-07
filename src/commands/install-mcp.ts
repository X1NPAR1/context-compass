import path from "node:path";
import { ensureProjectMcpConfig } from "../utils/mcp-config";
import { logError } from "../utils/errors";

export async function runInstallMcpCommand(projectRoot: string): Promise<number> {
  try {
    const result = ensureProjectMcpConfig(projectRoot);
    const relPath = path.relative(projectRoot, result.configPath) || ".mcp.json";

    if (result.created) {
      console.log(`✓ ${relPath} dosyası Context Compass MCP sunucusuyla oluşturuldu.`);
    } else if (result.updated) {
      console.log(`✓ ${relPath} dosyası Context Compass MCP sunucusuyla güncellendi.`);
    } else {
      console.log(`✓ ${relPath} zaten Context Compass MCP sunucusunu içeriyor.`);
    }
    return 0;
  } catch (error) {
    logError(projectRoot, error, "install_mcp_command");
    console.error("MCP yapılandırması kurulamadı. Ayrıntılar için .context-compass/error.log dosyasına bakın.");
    return 1;
  }
}
