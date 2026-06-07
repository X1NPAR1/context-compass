import fs from "node:fs";
import { ContextDb } from "../utils/db";
import { loadConfig, loadStats } from "../utils/config";
import { indexDbPath } from "../utils/paths";
import { getPackageVersion } from "../utils/version";
import { timeAgo } from "../utils/time";

export async function runStatusCommand(projectRoot: string): Promise<number> {
  const cfg = loadConfig(projectRoot);
  console.log(`⟡ Context Compass v${getPackageVersion()}`);
  console.log("");

  const hasIndex = fs.existsSync(indexDbPath(projectRoot));
  if (!hasIndex) {
    console.log("  Durum: başlatılmadı");
    console.log("  Son indeksleme: hiç");
  } else {
    const db = await ContextDb.open(projectRoot);
    try {
      const counts = db.getIndexCounts();
      const stats = loadStats(projectRoot);
      console.log(`  Durum: başlatıldı (${counts.functions} fonksiyon, ${counts.connections} bağlantı)`);
      console.log(`  Son indeksleme: ${timeAgo(stats.index.lastUpdatedAt, "long")}`);
    } finally {
      db.close();
    }
  }

  console.log(`  Bağlam modu: ${cfg.retrieval.mode}`);

  console.log("");
  console.log("  Komutlar:");
  console.log("    context-compass init          Proje indeksini oluşturur/yeniden oluşturur");
  console.log("    context-compass eval          Alım değerlendirmesini çalıştırır");
  console.log("    context-compass stats         Tasarruf panosunu gösterir");
  console.log("    context-compass savings       stats için takma ad");
  console.log("    context-compass install-mcp   MCP sunucusunu kaydeder");
  console.log("    context-compass mode [name]   Modu gösterir/ayarlar (economy|balanced|quality)");
  console.log("    context-compass enable-hook   Opsiyonel UserPromptSubmit yedeğini etkinleştirir");
  console.log("    context-compass serve         MCP sunucusunu başlatır (Claude Code tarafından kullanılır)");
  console.log("");
  console.log("  Kullanım: bu dizinde sadece 'claude' komutunu çalıştırın.");
  console.log("  Context Compass hook'ları ve MCP araçları otomatik olarak etkinleşir.");

  return 0;
}
