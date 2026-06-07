import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Indexer } from "../core/indexer";
import { defaultConfig, defaultStatsSnapshot, saveConfig, saveStats } from "../utils/config";
import { ContextDb } from "../utils/db";
import { logError } from "../utils/errors";
import { contextDir } from "../utils/paths";
import { detectLanguagesFromFiles, listSourceFiles } from "../utils/files";
import { ensureProjectMcpConfig } from "../utils/mcp-config";
import { ensureSessionStartHook } from "../utils/claude-settings";
import { installContextCompassSkills } from "../utils/skills";
import { ensureClaudeMdInstruction } from "../utils/claude-md";

export async function runInitCommand(projectRoot: string): Promise<number> {
  const startedAt = Date.now();
  const srcFiles = listSourceFiles(projectRoot);
  const languages = detectLanguagesFromFiles(srcFiles);

  console.log("⟡ Context Compass başlatılıyor...");
  console.log(
    `  Proje taranıyor................ ${srcFiles.length} dosya (${languages.length > 0 ? languages.join(", ") : "yok"})`
  );

  const cfg = defaultConfig();
  cfg.indexedLanguages = languages;

  let db: ContextDb | null = null;
  try {
    db = await ContextDb.open(projectRoot);
    const indexer = new Indexer(projectRoot, db);

    const stats = await indexer.fullIndex({
      maxCommits: cfg.thresholds.maxCommits,
      maxSessionFunctions: cfg.thresholds.maxSessionFunctions,
      topKNeighbors: cfg.thresholds.topKNeighbors
    });

    console.log(`  Fonksiyonlar ayrıştırılıyor.... ${stats.functions} fonksiyon, ${stats.modules} modül`);
    console.log(`  Git geçmişi analiz ediliyor.... ${stats.sessions} odaklı oturum`);
    console.log(`  Bağlantılar hesaplanıyor....... ${stats.connections} PMI bağlantısı`);
    console.log("  Bağlam paketleri oluşturuluyor. tamam");
    if (stats.profile) {
      const parseS = (stats.profile.parseMs / 1000).toFixed(2);
      const gitS = (stats.profile.gitMs / 1000).toFixed(2);
      const pmiS = (stats.profile.pmiMs / 1000).toFixed(2);
      const bundlesS = (stats.profile.bundlesMs / 1000).toFixed(2);
      console.log(`  Profilleme..................... ayrıştırma ${parseS}s · git ${gitS}s · pmi ${pmiS}s · paketler ${bundlesS}s`);
    }
    console.log("");
    console.log(`  ✓ İndeks ${(stats.durationMs / 1000).toFixed(2)}s içinde oluşturuldu`);
    console.log("");

    cfg.createdAt = startedAt;
    cfg.updatedAt = Date.now();
    saveConfig(projectRoot, cfg);

    const snapshot = defaultStatsSnapshot();
    snapshot.index = {
      functions: stats.functions,
      connections: stats.connections,
      lastUpdatedAt: Date.now()
    };
    saveStats(projectRoot, snapshot);

    console.log("  Claude Code ile entegre ediliyor...");
    integrateWithClaudeCode(projectRoot);

    await maybeAddContextDirToGitignore(projectRoot);
    console.log("");
    console.log("  Tamamlandı. Sadece 'claude' komutunu çalıştırın — Context Compass otomatik çalışır.");
    return 0;
  } catch (error) {
    logError(projectRoot, error, "init_command");
    console.error("Başlatma başarısız. Ayrıntılar için .context-compass/error.log dosyasına bakın.");
    return 1;
  } finally {
    db?.close();
  }
}

function integrateWithClaudeCode(projectRoot: string): void {
  try {
    ensureProjectMcpConfig(projectRoot);
    console.log("  ✓ MCP sunucusu kaydedildi (.mcp.json)");
  } catch (error) {
    logError(projectRoot, error, "init_install_mcp");
    console.log("  ⚠ MCP sunucusu kaydı başarısız (.mcp.json)");
  }

  try {
    ensureSessionStartHook(projectRoot);
    console.log("  ✓ SessionStart hook kuruldu (.claude/settings.local.json)");
  } catch (error) {
    logError(projectRoot, error, "init_install_session_start_hook");
    console.log("  ⚠ SessionStart hook kurulumu başarısız (.claude/settings.local.json)");
  }

  try {
    installContextCompassSkills(projectRoot);
    console.log("  ✓ Beceriler (skills) kuruldu (explore, review)");
  } catch (error) {
    logError(projectRoot, error, "init_install_skills");
    console.log("  ⚠ Beceri (skills) kurulumu başarısız (.claude/skills)");
  }

  try {
    const result = ensureClaudeMdInstruction(projectRoot);
    if (result.created) {
      console.log("  ✓ CLAUDE.md zorunlu Context Compass talimatıyla oluşturuldu");
    } else if (result.updated) {
      console.log("  ✓ CLAUDE.md zorunlu Context Compass talimatıyla güncellendi");
    } else {
      console.log("  ✓ CLAUDE.md zaten zorunlu Context Compass talimatını içeriyor");
    }
  } catch (error) {
    logError(projectRoot, error, "init_install_claude_md");
    console.log("  ⚠ CLAUDE.md talimatı kurulumu başarısız");
  }
}

async function maybeAddContextDirToGitignore(projectRoot: string): Promise<void> {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const entry = `${path.basename(contextDir(projectRoot))}/`;

  if (fs.existsSync(gitignorePath)) {
    const existing = fs.readFileSync(gitignorePath, "utf8");
    if (existing.split(/\r?\n/).map((line) => line.trim()).includes(entry)) {
      return;
    }
  }

  const shouldAsk = process.stdin.isTTY && process.stdout.isTTY;
  if (!shouldAsk) {
    const initial = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
    const needsNewline = initial.length > 0 && !initial.endsWith("\n");
    const next = `${initial}${needsNewline ? "\n" : ""}${entry}\n`;
    fs.writeFileSync(gitignorePath, next, "utf8");
    return;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(".context-compass/ dizini .gitignore dosyasına eklensin mi? (e/H) ");
    if (!/^(e(vet)?|y(es)?)$/i.test(answer.trim())) {
      return;
    }
  } finally {
    rl.close();
  }

  const initial = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";
  const needsNewline = initial.length > 0 && !initial.endsWith("\n");
  const next = `${initial}${needsNewline ? "\n" : ""}${entry}\n`;
  fs.writeFileSync(gitignorePath, next, "utf8");
}
