import { isRetrievalMode, loadConfig, saveConfig } from "../utils/config";

export async function runModeCommand(projectRoot: string, modeArg?: string): Promise<number> {
  const config = loadConfig(projectRoot);

  if (!modeArg) {
    console.log(`Bağlam modu: ${config.retrieval.mode}`);
    console.log("Kullanılabilir modlar: economy, balanced, quality");
    return 0;
  }

  const next = modeArg.trim().toLowerCase();
  if (!isRetrievalMode(next)) {
    console.error(`Geçersiz mod '${modeArg}'. Kullanın: economy, balanced, quality.`);
    return 1;
  }

  config.retrieval.mode = next;
  config.updatedAt = Date.now();
  saveConfig(projectRoot, config);

  console.log(`✓ Bağlam modu '${next}' olarak ayarlandı.`);
  if (next === "economy") {
    console.log("  Daha dar bağlam paketleriyle token azaltmaya öncelik verir.");
  } else if (next === "quality") {
    console.log("  Daha geniş bağlam paketleriyle alım kalitesine öncelik verir.");
  } else {
    console.log("  Kalite ile token kullanımı arasında dengeli bir denge kurar.");
  }

  return 0;
}
