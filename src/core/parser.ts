import crypto from "node:crypto";
import Parser from "tree-sitter";
import Python from "tree-sitter-python";
import JavaScript from "tree-sitter-javascript";
import TypeScript from "tree-sitter-typescript";
import Go from "tree-sitter-go";
import Rust from "tree-sitter-rust";
import Java from "tree-sitter-java";
import CSharp from "tree-sitter-c-sharp";
import Ruby from "tree-sitter-ruby";
import Php from "tree-sitter-php";
import Kotlin from "tree-sitter-kotlin";
import {
  CallEdge,
  FileRecord,
  ImportEdge,
  ParserResult,
  SupportedLanguage,
  SymbolParameter,
  SymbolRecord
} from "../types";
import { contentHash, detectLanguageByPath, fileMtimeMs, isTestPath, readTextFile } from "../utils/files";
import { logError } from "../utils/errors";

interface UnresolvedCall {
  callerId: string;
  callerFilePath: string;
  calleeName: string;
  line: number;
}

interface ParsedFileData {
  fileRecord: FileRecord;
  symbols: SymbolRecord[];
  unresolvedCalls: UnresolvedCall[];
  imports: ImportEdge[];
}

type FuncKind = "function" | "method";
const MAX_FILE_LINES = 10000;

export class CodeParser {
  private readonly parsers = new Map<SupportedLanguage, Parser>();

  constructor(private readonly projectRoot: string) {
    this.parsers.set("python", this.makeParser(Python as any));
    this.parsers.set("javascript", this.makeParser(JavaScript as any));
    this.parsers.set("typescript", this.makeParser((TypeScript as { typescript: any }).typescript));
    this.parsers.set("go", this.makeParser(Go as any));
    this.parsers.set("rust", this.makeParser(Rust as any));
    this.parsers.set("java", this.makeParser(Java as any));
    this.parsers.set("csharp", this.makeParser(CSharp as any));
    this.parsers.set("ruby", this.makeParser(Ruby as any));
    this.parsers.set("php", this.makeParser((Php as { php: any }).php));
    this.parsers.set("kotlin", this.makeParser(Kotlin as any));
  }

  parseFiles(relPaths: string[]): ParserResult {
    const files: FileRecord[] = [];
    const symbols: SymbolRecord[] = [];
    const imports: ImportEdge[] = [];
    const unresolvedCalls: UnresolvedCall[] = [];

    for (const relPath of relPaths) {
      const language = detectLanguageByPath(relPath);
      if (!language) {
        continue;
      }

      try {
        const parsed = this.parseSingleFile(relPath, language);
        if (!parsed) {
          continue;
        }
        files.push(parsed.fileRecord);
        symbols.push(...parsed.symbols);
        imports.push(...parsed.imports);
        unresolvedCalls.push(...parsed.unresolvedCalls);
      } catch (error) {
        logError(this.projectRoot, error, `parse_file:${relPath}`);
      }
    }

    const calls = this.resolveCalls(unresolvedCalls, symbols);

    return {
      filesScanned: files.length,
      modules: files.length,
      files,
      symbols,
      calls,
      imports
    };
  }

  parseSingleFile(relPath: string, language: SupportedLanguage): ParsedFileData | null {
    const content = readTextFile(this.projectRoot, relPath);
    if (lineCount(content) > MAX_FILE_LINES) {
      logError(this.projectRoot, `Skipping large file (${MAX_FILE_LINES}+ lines): ${relPath}`, "parse_warning");
      return null;
    }

    const parser = this.parsers.get(language);
    if (!parser) {
      throw new Error(`Unsupported parser language: ${language}`);
    }

    const tree = parser.parse(content);
    if (hasSyntaxErrors(tree.rootNode)) {
      logError(this.projectRoot, `Skipping syntax-error file: ${relPath}`, "parse_warning");
      return null;
    }

    const symbols: SymbolRecord[] = [];
    const unresolvedCalls: UnresolvedCall[] = [];
    const imports: ImportEdge[] = [];

    this.extractImports(tree.rootNode, content, relPath, language, imports);
    this.extractSymbols(tree.rootNode, content, relPath, language, [], symbols, unresolvedCalls);

    const now = Date.now();
    const fileRecord: FileRecord = {
      path: relPath,
      language,
      isTest: isTestPath(relPath),
      mtimeMs: fileMtimeMs(this.projectRoot, relPath),
      contentHash: contentHash(content),
      updatedAt: now
    };

    return {
      fileRecord,
      symbols,
      unresolvedCalls,
      imports
    };
  }

  private makeParser(language: any): Parser {
    const parser = new Parser();
    parser.setLanguage(language);
    return parser;
  }

  private extractSymbols(
    node: Parser.SyntaxNode,
    content: string,
    relPath: string,
    language: SupportedLanguage,
    classStack: string[],
    symbols: SymbolRecord[],
    unresolvedCalls: UnresolvedCall[]
  ): void {
    if (this.isClassNode(node, language)) {
      const className = this.getClassName(node, content);
      if (className) {
        const qualifiedName = [...classStack, className].join(".");
        const classSource = this.nodeText(node, content);
        const primaryClassSource = classSource.trim().length > 0 ? classSource : `class ${qualifiedName}`;
        symbols.push({
          id: this.makeSymbolId(relPath, qualifiedName, node.startPosition.row + 1, node.endPosition.row + 1),
          kind: "class",
          name: className,
          qualifiedName,
          filePath: relPath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          params: [],
          signature: `class ${qualifiedName}`,
          source: primaryClassSource,
          updatedAt: Date.now()
        });

        const nextStack = [...classStack, className];
        for (const child of node.namedChildren) {
          this.extractSymbols(child, content, relPath, language, nextStack, symbols, unresolvedCalls);
        }
        return;
      }
    }

    if (this.isFunctionNode(node, language)) {
      const functionMeta = this.getFunctionMeta(node, content, language, classStack);
      if (functionMeta?.name) {
        const lineStart = node.startPosition.row + 1;
        const lineEnd = node.endPosition.row + 1;
        const scopeParts = functionMeta.ownerName
          ? [...classStack, functionMeta.ownerName]
          : classStack;
        const qualifiedName = scopeParts.length > 0 ? `${scopeParts.join(".")}.${functionMeta.name}` : functionMeta.name;
        const symbolId = this.makeSymbolId(relPath, qualifiedName, lineStart, lineEnd);
        const signature = this.makeSignature(qualifiedName, functionMeta.params, functionMeta.returnType);
        const functionSource = this.nodeText(node, content);
        const primaryFunctionSource = functionSource.trim().length > 0 ? functionSource : signature;

        symbols.push({
          id: symbolId,
          kind: functionMeta.kind,
          name: functionMeta.name,
          qualifiedName,
          filePath: relPath,
          startLine: lineStart,
          endLine: lineEnd,
          params: functionMeta.params,
          returnType: functionMeta.returnType,
          signature,
          source: primaryFunctionSource,
          updatedAt: Date.now()
        });

        const calls = this.collectCalls(node, content, language);
        for (const call of calls) {
          unresolvedCalls.push({
            callerId: symbolId,
            callerFilePath: relPath,
            calleeName: call.name,
            line: call.line
          });
        }
      }
    }

    for (const child of node.namedChildren) {
      this.extractSymbols(child, content, relPath, language, classStack, symbols, unresolvedCalls);
    }
  }

  private extractImports(
    node: Parser.SyntaxNode,
    content: string,
    relPath: string,
    language: SupportedLanguage,
    imports: ImportEdge[]
  ): void {
    if (language === "python") {
      if (node.type === "import_statement") {
        const txt = this.nodeText(node, content).replace(/^import\s+/, "").trim();
        const names = txt.split(",").map((s) => s.trim()).filter(Boolean);
        for (const name of names) {
          imports.push({
            importerPath: relPath,
            importedModule: name,
            importKind: "import",
            line: node.startPosition.row + 1
          });
        }
      }

      if (node.type === "import_from_statement") {
        const txt = this.nodeText(node, content);
        const fromMatch = txt.match(/^from\s+([^\s]+)\s+import\s+(.+)$/s);
        if (fromMatch) {
          const moduleName = fromMatch[1].trim();
          const symbols = fromMatch[2]
            .replace(/[()]/g, "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          for (const imported of symbols) {
            imports.push({
              importerPath: relPath,
              importedModule: moduleName,
              importedSymbol: imported,
              importKind: "from_import",
              line: node.startPosition.row + 1
            });
          }
        }
      }
    } else if (language === "go") {
      if (node.type === "import_spec") {
        const pathNode = node.childForFieldName("path");
        const moduleName = pathNode ? this.nodeText(pathNode, content).replace(/["']/g, "").trim() : "";
        if (moduleName) {
          const aliasNode = node.childForFieldName("name");
          imports.push({
            importerPath: relPath,
            importedModule: moduleName,
            importedSymbol: aliasNode ? this.nodeText(aliasNode, content).trim() : undefined,
            importKind: "import",
            line: node.startPosition.row + 1
          });
        }
      }
    } else if (language === "rust") {
      if (node.type === "use_declaration") {
        const txt = this.nodeText(node, content).trim().replace(/^use\s+/, "").replace(/;$/, "").trim();
        if (txt) {
          imports.push({
            importerPath: relPath,
            importedModule: txt,
            importKind: "use",
            line: node.startPosition.row + 1
          });
        }
      }
    } else if (language === "java") {
      if (node.type === "import_declaration") {
        const txt = this.nodeText(node, content).trim().replace(/^import\s+/, "").replace(/;$/, "").trim();
        const normalized = txt.replace(/^static\s+/, "");
        if (normalized) {
          imports.push({
            importerPath: relPath,
            importedModule: normalized,
            importKind: txt.startsWith("static ") ? "static_import" : "import",
            line: node.startPosition.row + 1
          });
        }
      }
    } else if (language === "csharp") {
      if (node.type === "using_directive") {
        const txt = this.nodeText(node, content).trim().replace(/^using\s+/, "").replace(/;$/, "").trim();
        if (txt) {
          imports.push({
            importerPath: relPath,
            importedModule: txt,
            importKind: "using",
            line: node.startPosition.row + 1
          });
        }
      }
    } else if (language === "ruby") {
      if (node.type === "call") {
        const methodNode = node.childForFieldName("method");
        const methodName = methodNode ? this.nodeText(methodNode, content).trim() : "";
        if (methodName === "require" || methodName === "require_relative" || methodName === "load") {
          const text = this.nodeText(node, content);
          const importPath = this.extractFirstQuotedLiteral(text);
          if (importPath) {
            imports.push({
              importerPath: relPath,
              importedModule: importPath,
              importKind: methodName,
              line: node.startPosition.row + 1
            });
          }
        }
      }
    } else if (language === "php") {
      if (node.type === "namespace_use_declaration") {
        const txt = this.nodeText(node, content).trim().replace(/^use\s+/, "").replace(/;$/, "").trim();
        if (txt) {
          imports.push({
            importerPath: relPath,
            importedModule: txt,
            importKind: "use",
            line: node.startPosition.row + 1
          });
        }
      } else if (
        node.type === "require_expression" ||
        node.type === "include_expression" ||
        node.type === "require_once_expression" ||
        node.type === "include_once_expression"
      ) {
        const txt = this.nodeText(node, content);
        const importPath = this.extractFirstQuotedLiteral(txt);
        if (importPath) {
          imports.push({
            importerPath: relPath,
            importedModule: importPath,
            importKind: node.type.replace(/_expression$/, ""),
            line: node.startPosition.row + 1
          });
        }
      }
    } else if (language === "kotlin") {
      if (node.type === "import_header") {
        const txt = this.nodeText(node, content).trim().replace(/^import\s+/, "").trim();
        if (txt) {
          imports.push({
            importerPath: relPath,
            importedModule: txt,
            importKind: "import",
            line: node.startPosition.row + 1
          });
        }
      }
    } else {
      if (node.type === "import_statement") {
        const sourceNode = node.childForFieldName("source");
        const source = sourceNode ? this.nodeText(sourceNode, content).replace(/["']/g, "") : "unknown";
        imports.push({
          importerPath: relPath,
          importedModule: source,
          importKind: "import",
          line: node.startPosition.row + 1
        });
      }

      if (node.type === "export_statement") {
        const txt = this.nodeText(node, content);
        const fromMatch = txt.match(/from\s+["']([^"']+)["']/);
        if (fromMatch) {
          imports.push({
            importerPath: relPath,
            importedModule: fromMatch[1],
            importKind: "export_from",
            line: node.startPosition.row + 1
          });
        }
      }
    }

    for (const child of node.namedChildren) {
      this.extractImports(child, content, relPath, language, imports);
    }
  }

  private collectCalls(
    node: Parser.SyntaxNode,
    content: string,
    language: SupportedLanguage
  ): Array<{ name: string; line: number }> {
    const out: Array<{ name: string; line: number }> = [];

    const walk = (current: Parser.SyntaxNode): void => {
      if (this.isCallNode(current)) {
        const targetNode =
          current.childForFieldName("function") ??
          current.childForFieldName("name") ??
          current.childForFieldName("method") ??
          current.namedChildren[0];
        if (targetNode) {
          const raw = this.nodeText(targetNode, content).trim();
          const name = this.simplifyCallTarget(raw, language);
          if (name) {
            out.push({
              name,
              line: current.startPosition.row + 1
            });
          }
        }
      } else if (current.type === "macro_invocation") {
        const macroNode = current.childForFieldName("macro");
        if (macroNode) {
          const raw = this.nodeText(macroNode, content).trim();
          const name = this.simplifyCallTarget(raw, language);
          if (name) {
            out.push({
              name,
              line: current.startPosition.row + 1
            });
          }
        }
      }
      for (const child of current.namedChildren) {
        walk(child);
      }
    };

    walk(node);
    return out;
  }

  private resolveCalls(unresolvedCalls: UnresolvedCall[], symbols: SymbolRecord[]): CallEdge[] {
    const bySimpleName = new Map<string, SymbolRecord[]>();
    const byFileAndName = new Map<string, SymbolRecord[]>();

    for (const symbol of symbols) {
      if (symbol.kind === "class") {
        continue;
      }
      const list = bySimpleName.get(symbol.name) ?? [];
      list.push(symbol);
      bySimpleName.set(symbol.name, list);

      const fileKey = `${symbol.filePath}::${symbol.name}`;
      const list2 = byFileAndName.get(fileKey) ?? [];
      list2.push(symbol);
      byFileAndName.set(fileKey, list2);
    }

    const out: CallEdge[] = [];
    const dedupe = new Set<string>();

    for (const call of unresolvedCalls) {
      const localKey = `${call.callerFilePath}::${call.calleeName}`;
      const localMatches = byFileAndName.get(localKey) ?? [];
      const candidates = localMatches.length > 0 ? localMatches : bySimpleName.get(call.calleeName) ?? [];

      for (const candidate of candidates) {
        const key = `${call.callerId}|${candidate.id}|${call.line}`;
        if (candidate.id === call.callerId || dedupe.has(key)) {
          continue;
        }
        dedupe.add(key);
        out.push({
          callerSymbolId: call.callerId,
          calleeSymbolId: candidate.id,
          callLine: call.line
        });
      }
    }

    return out;
  }

  private isCallNode(node: Parser.SyntaxNode): boolean {
    return (
      node.type === "call" ||
      node.type === "call_expression" ||
      node.type === "method_call_expression" ||
      node.type === "member_call_expression" ||
      node.type === "function_call_expression" ||
      node.type === "scoped_call_expression" ||
      node.type === "method_invocation" ||
      node.type === "invocation_expression"
    );
  }

  private simplifyCallTarget(raw: string, language: SupportedLanguage): string | null {
    if (!raw) {
      return null;
    }

    let cleaned = raw;
    if (language === "python") {
      cleaned = cleaned.replace(/^self\./, "");
    }
    if (language === "rust" || language === "php") {
      cleaned = cleaned.replace(/::/g, ".");
    }
    cleaned = cleaned.replace(/->/g, ".").replace(/\?\./g, ".");

    const bits = cleaned.split(/[.\[\(<]/).map((v) => v.trim()).filter(Boolean);
    const last = (bits[bits.length - 1] ?? cleaned).replace(/!$/, "");
    return /^(?:[$_\p{L}])[$\p{L}\p{N}_]*$/u.test(last) ? last : null;
  }

  private isClassNode(node: Parser.SyntaxNode, language: SupportedLanguage): boolean {
    if (language === "python") {
      return node.type === "class_definition";
    }
    if (language === "go") {
      return node.type === "type_spec";
    }
    if (language === "rust") {
      return node.type === "struct_item" || node.type === "enum_item" || node.type === "trait_item" || node.type === "impl_item";
    }
    if (language === "java") {
      return (
        node.type === "class_declaration" ||
        node.type === "interface_declaration" ||
        node.type === "enum_declaration" ||
        node.type === "record_declaration"
      );
    }
    if (language === "csharp") {
      return (
        node.type === "class_declaration" ||
        node.type === "struct_declaration" ||
        node.type === "interface_declaration" ||
        node.type === "enum_declaration" ||
        node.type === "record_declaration"
      );
    }
    if (language === "ruby") {
      return node.type === "class" || node.type === "module";
    }
    if (language === "php") {
      return (
        node.type === "class_declaration" ||
        node.type === "interface_declaration" ||
        node.type === "trait_declaration" ||
        node.type === "enum_declaration"
      );
    }
    if (language === "kotlin") {
      return node.type === "class_declaration" || node.type === "object_declaration";
    }
    return node.type === "class_declaration";
  }

  private isFunctionNode(node: Parser.SyntaxNode, language: SupportedLanguage): boolean {
    if (language === "python") {
      return node.type === "function_definition";
    }
    if (language === "go") {
      return node.type === "function_declaration" || node.type === "method_declaration";
    }
    if (language === "rust") {
      return node.type === "function_item";
    }
    if (language === "java" || language === "csharp") {
      return node.type === "method_declaration" || node.type === "constructor_declaration";
    }
    if (language === "ruby") {
      return node.type === "method" || node.type === "singleton_method";
    }
    if (language === "php") {
      return node.type === "function_definition" || node.type === "method_declaration";
    }
    if (language === "kotlin") {
      return node.type === "function_declaration" || node.type === "secondary_constructor";
    }
    return (
      node.type === "function_declaration" ||
      node.type === "method_definition" ||
      node.type === "function_expression" ||
      node.type === "arrow_function"
    );
  }

  private getClassName(node: Parser.SyntaxNode, content: string): string | null {
    if (node.type === "type_spec") {
      const typeNode = node.childForFieldName("type");
      if (typeNode && typeNode.type !== "struct_type" && typeNode.type !== "interface_type") {
        return null;
      }
    }

    if (node.type === "impl_item") {
      const typeNode = node.childForFieldName("type");
      const raw = typeNode ? this.nodeText(typeNode, content).trim() : "";
      if (!raw) {
        return "impl";
      }
      const simplified = raw.split(/[<\s]/)[0]?.trim();
      return simplified || "impl";
    }

    const nameNode = node.childForFieldName("name");
    if (nameNode) {
      return this.nodeText(nameNode, content).trim();
    }

    if (node.type === "class_declaration" || node.type === "object_declaration") {
      const identifierNode = this.findFirstNamedChild(node, ["type_identifier", "simple_identifier", "identifier"]);
      if (identifierNode) {
        return this.nodeText(identifierNode, content).trim();
      }
    }

    if (node.type === "class" || node.type === "module") {
      const rubyName = this.findFirstNamedChild(node, ["constant", "scope_resolution"]);
      if (rubyName) {
        return this.nodeText(rubyName, content).trim();
      }
    }

    return null;
  }

  private getFunctionMeta(
    node: Parser.SyntaxNode,
    content: string,
    language: SupportedLanguage,
    classStack: string[]
  ): { name: string; params: SymbolParameter[]; returnType?: string; kind: FuncKind; ownerName?: string } | null {
    const explicitName = node.childForFieldName("name");
    let name = explicitName ? this.nodeText(explicitName, content).trim() : "";

    if (!name) {
      if (language === "kotlin" && node.type === "function_declaration") {
        const kotlinName = this.findFirstNamedChild(node, ["simple_identifier", "identifier"]);
        if (kotlinName) {
          name = this.nodeText(kotlinName, content).trim();
        }
      } else if (language === "ruby" && (node.type === "method" || node.type === "singleton_method")) {
        const rubyName = this.findFirstNamedChild(node, ["identifier", "constant"]);
        if (rubyName) {
          name = this.nodeText(rubyName, content).trim();
        }
      }
    }

    if (!name && (node.type === "function_expression" || node.type === "arrow_function")) {
      const parent = node.parent;
      if (parent?.type === "variable_declarator") {
        const declName = parent.childForFieldName("name");
        if (declName) {
          name = this.nodeText(declName, content).trim();
        }
      }
      if (!name && parent?.type === "pair") {
        const keyNode = parent.childForFieldName("key") ?? parent.namedChildren[0];
        if (keyNode) {
          name = this.nodeText(keyNode, content).replace(/["']/g, "").trim();
        }
      }
    }

    if (!name) {
      return null;
    }

    const paramsNode =
      node.childForFieldName("parameters") ??
      node.childForFieldName("parameter") ??
      node.childForFieldName("arguments") ??
      node.childForFieldName("value_parameters") ??
      this.findFirstNamedChild(node, ["formal_parameters", "parameter_list", "method_parameters", "function_value_parameters"]);

    const returnTypeNode =
      node.childForFieldName("return_type") ??
      node.childForFieldName("type") ??
      node.childForFieldName("result") ??
      (language === "kotlin" ? this.findFirstNamedChild(node, ["user_type", "nullable_type", "type_identifier"]) : null);
    const params = this.parseParams(paramsNode ? this.nodeText(paramsNode, content) : "");
    const returnType = returnTypeNode ? this.nodeText(returnTypeNode, content).replace(/^[:\-\s>]+/, "").trim() : undefined;
    const kind: FuncKind =
      node.type === "method_definition" ||
      node.type === "method_declaration" ||
      node.type === "constructor_declaration" ||
      node.type === "method" ||
      node.type === "singleton_method" ||
      ((language === "rust" || language === "kotlin" || language === "ruby" || language === "java" || language === "csharp" || language === "php") &&
        classStack.length > 0)
        ? "method"
        : "function";

    let ownerName: string | undefined;
    if (language === "go" && node.type === "method_declaration") {
      const receiverNode = node.childForFieldName("receiver");
      const receiverText = receiverNode ? this.nodeText(receiverNode, content) : "";
      const match = receiverText.match(/\*?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)?$/);
      ownerName = match?.[1];
    }

    return { name, params, returnType: returnType || undefined, kind, ownerName };
  }

  private parseParams(rawParams: string): SymbolParameter[] {
    if (!rawParams) {
      return [];
    }

    let txt = rawParams.trim();
    txt = txt.replace(/^\(/, "").replace(/\)$/, "");

    if (!txt) {
      return [];
    }

    return txt
      .split(",")
      .map((param) => param.trim())
      .filter(Boolean)
      .map((param) => {
        const [left, defaultValue] = param.split("=").map((v) => v.trim());
        let name = left;
        let type: string | undefined;

        if (left.includes(":")) {
          const parts = left.split(":").map((v) => v.trim());
          name = parts[0] || left;
          type = parts[1] || undefined;
        } else {
          const tokens = left
            .replace(/^\.\.\./, "")
            .split(/\s+/)
            .map((v) => v.trim())
            .filter(Boolean);
          if (tokens.length >= 2) {
            name = tokens[tokens.length - 1]?.replace(/[,&]+$/g, "") || left;
            type = tokens.slice(0, -1).join(" ");
          }
        }

        return {
          name: name || left,
          type: type || undefined,
          defaultValue: defaultValue || undefined
        };
      });
  }

  private makeSignature(qualifiedName: string, params: SymbolParameter[], returnType?: string): string {
    const paramText = params.map((p) => (p.type ? `${p.name}: ${p.type}` : p.name)).join(", ");
    return returnType ? `${qualifiedName}(${paramText}) -> ${returnType}` : `${qualifiedName}(${paramText})`;
  }

  private makeSymbolId(filePath: string, qualifiedName: string, startLine: number, endLine: number): string {
    const base = `${filePath}:${qualifiedName}:${startLine}-${endLine}`;
    const hash = crypto.createHash("sha1").update(base).digest("hex").slice(0, 10);
    return `${filePath}:${qualifiedName}:${hash}`;
  }

  private findFirstNamedChild(node: Parser.SyntaxNode, types: string[]): Parser.SyntaxNode | null {
    for (const child of node.namedChildren) {
      if (types.includes(child.type)) {
        return child;
      }
    }
    return null;
  }

  private extractFirstQuotedLiteral(text: string): string | null {
    const match = text.match(/["']([^"']+)["']/);
    return match?.[1] ?? null;
  }

  private nodeText(node: Parser.SyntaxNode, content: string): string {
    return content.slice(node.startIndex, node.endIndex);
  }
}

function hasSyntaxErrors(rootNode: Parser.SyntaxNode): boolean {
  const hasErrorFn = (rootNode as { hasError?: (() => boolean) | boolean }).hasError;
  if (typeof hasErrorFn === "function") {
    return hasErrorFn.call(rootNode);
  }
  if (typeof hasErrorFn === "boolean") {
    return hasErrorFn;
  }

  const stack: Parser.SyntaxNode[] = [rootNode];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === "ERROR" || node.type === "MISSING") {
      return true;
    }
    for (const child of node.namedChildren) {
      stack.push(child);
    }
  }
  return false;
}

function lineCount(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      lines += 1;
    }
  }
  return lines;
}
