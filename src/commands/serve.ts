import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  getRetrievalProfile,
  buildProjectOverviewMarkdown,
  getRelevantContextForPrompt,
  lookupFunctionBundle,
  searchFunctions
} from "../core/context-retrieval";
import { ContextDb } from "../utils/db";
import { logError } from "../utils/errors";
import { appendMcpLog } from "../utils/mcp-log";
import { activeContextPath, indexDbPath } from "../utils/paths";
import { McpGetFunctionBundleInput, McpGetRelevantContextInput, McpSearchFunctionsInput } from "../types";
import { isRetrievalMode, loadConfig } from "../utils/config";
import { recordSavingsEvent } from "../utils/savings-tracker";
import { getPackageVersion } from "../utils/version";

export async function runServeCommand(projectRoot: string): Promise<number> {
  let db: ContextDb | null = null;
  installProcessGuards(projectRoot);
  const config = loadConfig(projectRoot);

  if (fs.existsSync(indexDbPath(projectRoot))) {
    try {
      db = await ContextDb.open(projectRoot);
    } catch (error) {
      db = null;
      logError(projectRoot, error, "mcp_server_open_db");
    }
  }

  const server = new McpServer(
    {
      name: "context-compass",
      version: getPackageVersion()
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.registerTool(
    "get_relevant_context",
    {
      description:
        "Herhangi bir görevin başında bunu çağırın. Önceden hesaplanmış fonksiyon paketlerini, ilişkileri ve modüller arası co-edit tünellerini döndürür; böylece Claude daha az dosya okumasıyla doğrudan gezinebilir.",
      inputSchema: {
        prompt: z.string().min(1),
        max_results: z.number().int().min(1).max(20).optional(),
        mode: z.enum(["economy", "balanced", "quality"]).optional()
      }
    },
    async ({ prompt, max_results, mode }) => {
      const input: McpGetRelevantContextInput = { prompt, max_results, mode };
      return runTool(projectRoot, "get_relevant_context", input, async () => {
        const activeDb = db;
        if (!activeDb) {
          return formatMissingIndexMessage();
        }

        const requestedMode = mode ?? "";
        const effectiveMode = isRetrievalMode(requestedMode) ? requestedMode : config.retrieval.mode;
        const profile = getRetrievalProfile(effectiveMode);

        const result = getRelevantContextForPrompt(activeDb, prompt, {
          mode: effectiveMode,
          maxBundles: max_results ?? profile.maxBundles,
          maxContextChars: profile.maxContextChars
        });

        const activePath = activeContextPath(projectRoot);
        fs.mkdirSync(path.dirname(activePath), { recursive: true });
        fs.writeFileSync(activePath, result.fullAdditionalContext, "utf8");

        if (!result.fullAdditionalContext) {
          return "Bu istem için ilgili bağlam paketi bulunamadı.";
        }

        await recordSavingsEvent({
          timestamp: Date.now(),
          projectRoot,
          intent: result.intent,
          domains: result.keywords.slice(0, 5),
          actualBundleTokens: result.actualBundleTokens,
          estimatedExplorationTokens: result.estimatedExplorationTokens,
          savedTokens: Math.max(0, result.estimatedExplorationTokens - result.actualBundleTokens),
          mode: effectiveMode,
          source: "mcp"
        });

        return result.fullAdditionalContext;
      });
    }
  );

  server.registerTool(
    "get_function_bundle",
    {
      description:
        "Belirli bir fonksiyon için tam bağlam paketini getirir (kaynak + PMI tünelleri). Uygulama sırasında tek bir fonksiyon hakkında daha derin bağlam gerektiğinde bunu kullanın.",
      inputSchema: {
        function_name: z.string().min(1),
        module: z.string().min(1).optional()
      }
    },
    async ({ function_name, module }) => {
      const input: McpGetFunctionBundleInput = { function_name, module };
      return runTool(projectRoot, "get_function_bundle", input, async () => {
        const activeDb = db;
        if (!activeDb) {
          return formatMissingIndexMessage();
        }

        const found = lookupFunctionBundle(activeDb, function_name, module);
        if (!found) {
          return `'${function_name}' fonksiyonu için paket bulunamadı.`;
        }

        return [
          `Eşleşen fonksiyon: ${found.qualifiedName}`,
          `Dosya: ${found.filePath}`,
          `Eşleşme türü: ${found.matchType}`,
          "",
          found.bundleText
        ].join("\n");
      });
    }
  );

  server.registerTool(
    "get_project_overview",
    {
      description:
        "Projenin sıkıştırılmış bir haritasını döndürür: sık değişen (hot) fonksiyonlar, en güçlü co-edit bağlantıları ve modül düzeyinde fonksiyon sayıları. Oturum başında yönlenmek için bunu kullanın.",
      inputSchema: {}
    },
    async () => {
      return runTool(projectRoot, "get_project_overview", {}, async () => {
        const activeDb = db;
        if (!activeDb) {
          return formatMissingIndexMessage();
        }
        return buildProjectOverviewMarkdown(activeDb);
      });
    }
  );

  server.registerTool(
    "search_functions",
    {
      description:
        "Fonksiyon adlarını, modül adlarını ve dosya yollarını alt dize (substring) ile heat-duyarlı sıralama kullanarak arar. Bir davranışın nerede yaşadığını ararken bunu kullanın.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ query, limit }) => {
      const input: McpSearchFunctionsInput = { query, limit };
      return runTool(projectRoot, "search_functions", input, async () => {
        const activeDb = db;
        if (!activeDb) {
          return formatMissingIndexMessage();
        }

        const results = searchFunctions(activeDb, query, limit ?? 10);
        if (results.length === 0) {
          return `'${query}' sorgusuyla eşleşen fonksiyon yok.`;
        }

        const lines: string[] = [];
        lines.push(`# Arama Sonuçları (${results.length})`);
        lines.push("");

        for (const result of results) {
          lines.push(
            `- ${result.qualifiedName} (${result.filePath}:${result.startLine}-${result.endLine}) heat=${result.heatScore.toFixed(0)}`
          );
          if (result.topNeighbors.length === 0) {
            lines.push("  komşular: yok");
            continue;
          }
          lines.push(
            `  komşular: ${result.topNeighbors
              .map((neighbor) => `${neighbor.qualifiedName} (pmi=${neighbor.pmi.toFixed(3)})`)
              .join("; ")}`
          );
        }

        return lines.join("\n");
      });
    }
  );

  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);

    const close = async () => {
      try {
        await server.close();
      } catch {
        // kapatma hatasını yok say
      }
      db?.close();
    };

    process.on("SIGINT", () => {
      void close().finally(() => process.exit(0));
    });
    process.on("SIGTERM", () => {
      void close().finally(() => process.exit(0));
    });

    return 0;
  } catch (error) {
    logError(projectRoot, error, "mcp_server_connect");
    db?.close();
    console.error("Context Compass MCP sunucusu başlatılamadı.");
    return 1;
  }
}

async function runTool(
  projectRoot: string,
  tool: string,
  input: unknown,
  handler: () => Promise<string>
): Promise<CallToolResult> {
  const started = Date.now();
  try {
    const text = await handler();
    appendMcpLog(projectRoot, {
      tool,
      input,
      latencyMs: Date.now() - started,
      responseText: text,
      success: true
    });
    return {
      content: [{ type: "text", text }]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(projectRoot, error, `mcp_tool:${tool}`);
    const fallback = `Context Compass MCP aracı '${tool}' başarısız oldu: ${message}`;
    appendMcpLog(projectRoot, {
      tool,
      input,
      latencyMs: Date.now() - started,
      responseText: fallback,
      success: false,
      error: message
    });

    return {
      isError: true,
      content: [{ type: "text", text: fallback }]
    };
  }
}

export function formatMissingIndexMessage(): string {
  return "Context Compass index is not available (indeks mevcut değil). Proje indeksini oluşturmak için önce `context-compass init` komutunu çalıştırın.";
}

function installProcessGuards(projectRoot: string): void {
  process.on("unhandledRejection", (error) => {
    logError(projectRoot, error, "mcp_unhandled_rejection");
  });
  process.on("uncaughtException", (error) => {
    logError(projectRoot, error, "mcp_uncaught_exception");
  });
}
