import fs from "node:fs";
import path from "node:path";
import { loadGlobalStats, loadStats } from "../utils/config";
import { ContextDb } from "../utils/db";
import { indexDbPath } from "../utils/paths";
import { estimateUsdFromTokens, formatUsd, OPUS_46_INPUT_USD_PER_MTOKENS } from "../utils/pricing";
import { timeAgo } from "../utils/time";

export async function runStatsCommand(projectRoot: string): Promise<number> {
  const projectName = path.basename(projectRoot) || projectRoot;
  const stats = loadStats(projectRoot);
  const global = loadGlobalStats();

  console.log("⟡ Context Compass Tasarruf");
  console.log("");

  console.log(`  Proje: ${projectName}`);
  printBucket("Bugün", stats.today.prompts, stats.today.savedTokens);
  printBucket("Bu Hafta", stats.week.prompts, stats.week.savedTokens);
  printBucket("Bu Ay", stats.month.prompts, stats.month.savedTokens);
  printBucket("Tüm Zamanlar", stats.lifetime.prompts, stats.lifetime.savedTokens);

  console.log(`  Kaynaklar: mcp ${formatK(stats.sourceCounts.mcp)} · hook ${formatK(stats.sourceCounts.hook)}`);
  console.log(
    `  Modlar:    economy ${formatK(stats.modeCounts.economy)} · balanced ${formatK(stats.modeCounts.balanced)} · quality ${formatK(stats.modeCounts.quality)}`
  );

  const topDomains = formatTopDomains(stats.topDomains);
  console.log(`  Alanlar:  ${topDomains}`);
  console.log("");

  console.log("  Global (tüm projeler)");
  printBucket("Bugün", global.today.prompts, global.today.savedTokens);
  printBucket("Bu Ay", global.month.prompts, global.month.savedTokens);
  printBucket("Tüm Zamanlar", global.lifetime.prompts, global.lifetime.savedTokens);

  const projectCount = Object.keys(global.projects).length;
  console.log(`  İzlenen projeler: ${formatK(projectCount)}`);
  console.log(
    `  Global kaynaklar: mcp ${formatK(global.sourceCounts.mcp)} · hook ${formatK(global.sourceCounts.hook)}`
  );
  console.log("");

  if (exists(indexDbPath(projectRoot))) {
    const db = await ContextDb.open(projectRoot);
    try {
      const counts = db.getIndexCounts();
      const age = timeAgo(stats.index.lastUpdatedAt, "compact");
      console.log(`  İndeks: ${counts.functions} fonksiyon · ${counts.connections} bağlantı · son güncelleme ${age}`);
    } finally {
      db.close();
    }
  } else {
    console.log("  İndeks: başlatılmadı");
  }

  console.log(`  Değer modeli: Opus 4.6 girdi @ ${formatUsd(OPUS_46_INPUT_USD_PER_MTOKENS)}/M token`);

  return 0;
}

function printBucket(label: string, prompts: number, savedTokens: number): void {
  const usd = estimateUsdFromTokens(savedTokens);
  const bucketLabel = label.padEnd(12, " ");
  const promptLabel = `${formatK(prompts)} istem`.padEnd(11, " ");
  const tokenLabel = `${formatK(savedTokens)} token`.padEnd(13, " ");
  console.log(`    ${bucketLabel} ${promptLabel} · ${tokenLabel} · ~${formatUsd(usd)}`);
}

function formatTopDomains(topDomains: Record<string, number>): string {
  const domains = Object.entries(topDomains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([domain, count]) => `${domain} (${formatK(count)})`);
  return domains.length > 0 ? domains.join(", ") : "yok";
}

function exists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function formatK(n: number): string {
  if (n < 1000) {
    return String(n);
  }
  if (n < 1_000_000) {
    return `${Math.round(n / 1000)}k`;
  }
  return `${(n / 1_000_000).toFixed(1)}M`;
}
