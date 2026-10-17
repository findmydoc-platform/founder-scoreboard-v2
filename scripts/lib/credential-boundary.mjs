import ts from "typescript";
import path from "node:path";

const internalDirectory = "src/lib/credentials/internal/";
const publicEntries = new Set(["src/lib/credentials/index.ts", "src/lib/credentials/browser.ts"]);

export function verifyCredentialBoundary({ root, legacyEdges = [], protectedModules = [], legacyTransports = [], collect = false }) {
  const configPath = path.join(root, "tsconfig.json");
  const config = ts.sys.fileExists(configPath) ? ts.readConfigFile(configPath, ts.sys.readFile) : null;
  const configured = config && !config.error ? ts.parseJsonConfigFileContent(config.config, ts.sys, root).options : {};
  const options = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext, baseUrl: root, paths: { "@/*": ["src/*"] }, ...configured };
  const files = ts.sys.readDirectory(path.join(root, "src"), [".ts", ".tsx", ".js", ".mjs"]);
  const failures = [];
  const observed = [];
  const transports = new Map();
  const allowed = new Set(legacyEdges.map(edge => `${edge.from} -> ${edge.to}`));
  const relative = file => path.relative(root, file).split(path.sep).join("/");
  for (const file of files) {
    const from = relative(file);
    const source = ts.createSourceFile(file, ts.sys.readFile(file), ts.ScriptTarget.Latest, true);
    function dependency(specifier, typeOnly = false) {
      if (typeOnly) return;
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
      const to = resolved && !resolved.isExternalLibraryImport ? relative(resolved.resolvedFileName) : specifier;
      const edge = `${from} -> ${to}`;
      if (from === "src/lib/credentials/internal/browser-session.ts" && (/^@supabase\//.test(to) || protectedModules.includes(to))) {
        failures.push(`${edge}: browser transport cannot acquire authentication SDKs or protected server helpers`);
      }
      if ((from === "src/lib/credentials/browser.ts" || from === "src/lib/credentials/internal/browser-session.ts")
        && to.startsWith(internalDirectory) && to !== "src/lib/credentials/internal/browser-session.ts") {
        failures.push(`${edge}: browser transport cannot acquire server credential adapters`);
      }
      if (to.startsWith(internalDirectory) && !publicEntries.has(from) && !from.startsWith(internalDirectory) && !allowed.has(edge)) {
        failures.push(`${edge}: internal credential adapter is private`);
      }
      const sensitive = protectedModules.includes(to) || /^@supabase\//.test(to)
        || /^(node:)?(https?|http2|net|tls)$|^(undici|axios|node-fetch)$/.test(to);
      if (sensitive && !from.startsWith(internalDirectory)) {
        observed.push({ from, to });
        if (!collect && !allowed.has(edge)) failures.push(`${edge}: use the public credential seam`);
      }
    }
    function visit(node) {
      if (ts.isIdentifier(node) && ["fetch", "XMLHttpRequest", "WebSocket"].includes(node.text)
        && !from.startsWith(internalDirectory)) {
        const key = `${from} -> ${node.text}`;
        transports.set(key, (transports.get(key) || 0) + 1);
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const onlyTypes = clause?.isTypeOnly || (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
          && !clause.name && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(element => element.isTypeOnly));
        dependency(node.moduleSpecifier.text, onlyTypes);
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const onlyTypes = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause)
          && node.exportClause.elements.length > 0 && node.exportClause.elements.every(element => element.isTypeOnly));
        dependency(node.moduleSpecifier.text, onlyTypes);
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
        const expression = node.moduleReference.expression;
        if (expression && ts.isStringLiteral(expression)) dependency(expression.text, node.isTypeOnly);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) dependency(node.arguments[0].text);
        else failures.push(`${from}: unresolved runtime dependency is forbidden`);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const [key, count] of transports) {
    const allowance = legacyTransports.find(entry => `${entry.from} -> ${entry.name}` === key);
    if (!collect && count > (allowance?.references || 0)) failures.push(`${key}: network transport requires approved ownership`);
  }
  return collect ? { edges: observed, transports: [...transports].map(([key, references]) => {
    const [from, name] = key.split(" -> "); return { from, name, references };
  }) } : [...new Set(failures)];
}
