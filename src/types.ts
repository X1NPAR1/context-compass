export type SupportedLanguage =
  | "python"
  | "typescript"
  | "javascript"
  | "go"
  | "rust"
  | "java"
  | "csharp"
  | "ruby"
  | "php"
  | "kotlin";

export type SymbolKind = "function" | "method" | "class";

export type RelationshipType = "CALLS" | "CALLED_BY" | "CO_EDIT" | "TEST" | "CONFIG";

export type PromptIntent = "bug_fix" | "feature" | "refactor" | "testing" | "general";
export type RetrievalMode = "economy" | "balanced" | "quality";

export interface ProjectConfig {
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
  indexedLanguages: SupportedLanguage[];
  thresholds: {
    maxCommits: number;
    maxSessionFunctions: number;
    topKNeighbors: number;
  };
  hooks: {
    registerInLocalSettings: boolean;
  };
  retrieval: {
    mode: RetrievalMode;
  };
}

export interface FileRecord {
  id?: number;
  path: string;
  language: SupportedLanguage;
  isTest: boolean;
  mtimeMs: number;
  contentHash: string;
  updatedAt: number;
}

export interface SymbolParameter {
  name: string;
  type?: string;
  defaultValue?: string;
}

export interface SymbolRecord {
  id: string;
  kind: SymbolKind;
  name: string;
  qualifiedName: string;
  fileId?: number;
  filePath: string;
  startLine: number;
  endLine: number;
  params: SymbolParameter[];
  returnType?: string;
  signature: string;
  source: string;
  heatScore?: number;
  updatedAt: number;
}

export interface CallEdge {
  callerSymbolId: string;
  calleeSymbolId: string;
  callLine: number;
}

export interface ImportEdge {
  importerFileId?: number;
  importerPath: string;
  importedModule: string;
  importedSymbol?: string;
  importKind: string;
  line: number;
}

export interface GitSession {
  id?: number;
  commitSha: string;
  commitTs: number;
  functionCount: number;
  symbolIds: string[];
}

export interface CooccurrencePair {
  aSymbolId: string;
  bSymbolId: string;
  pairCount: number;
}

export interface PmiEdge {
  aSymbolId: string;
  bSymbolId: string;
  pmi: number;
  pA: number;
  pB: number;
  pAB: number;
}

export interface ContextNeighbor {
  symbolId: string;
  signature: string;
  relationshipType: RelationshipType;
  relationshipDescription: string;
  pmiScore: number;
}

export interface ContextBundle {
  symbolId: string;
  symbolName: string;
  filePath: string;
  primarySource: string;
  neighbors: ContextNeighbor[];
}

export interface ParserResult {
  filesScanned: number;
  modules: number;
  files: FileRecord[];
  symbols: SymbolRecord[];
  calls: CallEdge[];
  imports: ImportEdge[];
}

export interface IndexStats {
  functions: number;
  modules: number;
  connections: number;
  languages: SupportedLanguage[];
  durationMs: number;
  sessions: number;
  filesScanned?: number;
  profile?: {
    parseMs: number;
    gitMs: number;
    pmiMs: number;
    bundlesMs: number;
  };
}

export interface TokenStatsSnapshot {
  today: {
    date: string;
    prompts: number;
    savedTokens: number;
  };
  week: {
    weekKey: string;
    prompts: number;
    savedTokens: number;
  };
  month: {
    monthKey: string;
    prompts: number;
    savedTokens: number;
  };
  lifetime: {
    prompts: number;
    savedTokens: number;
  };
  index: {
    functions: number;
    connections: number;
    lastUpdatedAt: number;
  };
  topDomains: Record<string, number>;
  sourceCounts: {
    hook: number;
    mcp: number;
  };
  modeCounts: Record<RetrievalMode, number>;
}

export interface GlobalStatsSnapshot {
  today: {
    date: string;
    prompts: number;
    savedTokens: number;
  };
  week: {
    weekKey: string;
    prompts: number;
    savedTokens: number;
  };
  month: {
    monthKey: string;
    prompts: number;
    savedTokens: number;
  };
  lifetime: {
    prompts: number;
    savedTokens: number;
  };
  projects: Record<
    string,
    {
      name: string;
      prompts: number;
      savedTokens: number;
      lastUpdatedAt: number;
    }
  >;
  topDomains: Record<string, number>;
  sourceCounts: {
    hook: number;
    mcp: number;
  };
  modeCounts: Record<RetrievalMode, number>;
}

export interface PromptEnrichmentResult {
  additionalContext: string;
  domainsUsed: string[];
  estimatedSavedTokens: number;
  actualBundleTokens: number;
  bundlesUsed: number;
}

export interface SavingsEvent {
  timestamp: number;
  projectRoot: string;
  intent: PromptIntent;
  domains: string[];
  actualBundleTokens: number;
  estimatedExplorationTokens: number;
  savedTokens: number;
  mode: RetrievalMode;
  source: "hook" | "mcp";
}

export interface IndexedFileChange {
  path: string;
  kind: "added" | "changed" | "deleted";
}

export interface DomainMatch {
  domain: string;
  symbolIds: string[];
}

export interface McpGetRelevantContextInput {
  prompt: string;
  max_results?: number;
  mode?: RetrievalMode;
}

export interface McpGetFunctionBundleInput {
  function_name: string;
  module?: string;
}

export interface McpSearchFunctionsInput {
  query: string;
  limit?: number;
}

export interface McpLogRecord {
  timestamp: string;
  tool: string;
  input: unknown;
  latencyMs: number;
  responseTokens: number;
  success: boolean;
  error?: string;
}
