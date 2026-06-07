#!/usr/bin/env node
import { Command } from "commander";
import { runInitCommand } from "./commands/init";
import { runStatsCommand } from "./commands/stats";
import { runEvalCommand } from "./commands/eval";
import { runServeCommand } from "./commands/serve";
import { runInstallMcpCommand } from "./commands/install-mcp";
import { runEnableHookCommand } from "./commands/enable-hook";
import { runModeCommand } from "./commands/mode";
import { runPromptInterceptor } from "./hook/prompt-interceptor";
import { runSessionStartHook } from "./hooks/session-start";
import { runStatusCommand } from "./commands/status";
import { getPackageVersion } from "./utils/version";

async function main(): Promise<void> {
  const program = new Command();
  program
    .name("context-compass")
    .description("Claude Code için bağlam paketlerini önceden hesaplar")
    .version(getPackageVersion());

  program.command("init").description("Proje indeksini oluşturur").action(async () => {
    process.exitCode = await runInitCommand(process.cwd());
  });

  program.command("stats").description("Proje/global token ve USD tasarrufunu gösterir").action(async () => {
    process.exitCode = await runStatsCommand(process.cwd());
  });

  program.command("savings").description("Token ve tahmini USD tasarrufunu gösterir").action(async () => {
    process.exitCode = await runStatsCommand(process.cwd());
  });

  program
    .command("eval")
    .description("Tutulan (held-out) git oturumlarında alım kalitesini değerlendirir")
    .option("--json", "Makine tarafından okunabilir değerlendirme sonuçları üretir")
    .action(async (opts: { json?: boolean }) => {
      process.exitCode = await runEvalCommand(process.cwd(), { json: Boolean(opts.json) });
    });

  program.command("serve").description("Context Compass MCP sunucusunu stdio üzerinden çalıştırır").action(async () => {
    process.exitCode = await runServeCommand(process.cwd());
  });

  program.command("install-mcp").description("Proje .mcp.json dosyasını oluşturur veya günceller").action(async () => {
    process.exitCode = await runInstallMcpCommand(process.cwd());
  });

  program.command("enable-hook").description("Opsiyonel UserPromptSubmit yedek hook'unu etkinleştirir").action(async () => {
    process.exitCode = await runEnableHookCommand(process.cwd());
  });

  program.command("mode").description("Bağlam modunu gösterir veya ayarlar").argument("[name]").action(async (name?: string) => {
    process.exitCode = await runModeCommand(process.cwd(), name);
  });

  program
    .command("hook-session-start")
    .description("Dahili Claude SessionStart hook işleyicisi")
    .action(async () => {
      process.exitCode = await runSessionStartHook();
    });

  program
    .command("hook-prompt")
    .description("Dahili Claude hook işleyicisi")
    .action(async () => {
      process.exitCode = await runPromptInterceptor();
    });

  if (process.argv.length <= 2) {
    process.exitCode = await runStatusCommand(process.cwd());
    return;
  }

  await program.parseAsync(process.argv);
}

void main();
