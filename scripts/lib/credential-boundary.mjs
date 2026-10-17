import ts from "typescript";
import path from "node:path";

const internalDirectory = "src/lib/credentials/internal/";
const publicEntries = new Set(["src/lib/credentials/index.ts", "src/lib/credentials/browser.ts"]);

export function verifyCredentialBoundary({ root, resourceEdges = [], protectedModules = [], resourceTransports = [], collect = false }) {
  const configPath = path.join(root, "tsconfig.json");
  const config = ts.sys.fileExists(configPath) ? ts.readConfigFile(configPath, ts.sys.readFile) : null;
  const configured = config && !config.error ? ts.parseJsonConfigFileContent(config.config, ts.sys, root).options : {};
  const options = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext, baseUrl: root, paths: { "@/*": ["src/*"] }, ...configured };
  const files = ts.sys.readDirectory(path.join(root, "src"), [".ts", ".tsx", ".js", ".mjs"]);
  const failures = [];
  const observed = [];
  const transports = new Map();
  const dependencies = new Map();
  const clientEntries = [];
  const allowed = new Set(resourceEdges.map(edge => `${edge.from} -> ${edge.to}`));
  const relative = file => path.relative(root, file).split(path.sep).join("/");
  for (const file of files) {
    const from = relative(file);
    const source = ts.createSourceFile(file, ts.sys.readFile(file), ts.ScriptTarget.Latest, true);
    dependencies.set(from, []);
    if (source.statements.some(statement => ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression) && statement.expression.text === "use client")) clientEntries.push(from);
    function dependency(specifier, typeOnly = false) {
      if (typeOnly) return;
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
      const to = resolved && !resolved.isExternalLibraryImport ? relative(resolved.resolvedFileName) : specifier;
      const edge = `${from} -> ${to}`;
      dependencies.get(from).push(to);
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
        || /^(node:)?(https?|http2|net|tls|module)$|^(undici|axios|node-fetch)$/.test(to);
      if (sensitive && !from.startsWith(internalDirectory)) {
        observed.push({ from, to });
        if (!collect && (/^@supabase\//.test(to) || !allowed.has(edge))) failures.push(`${edge}: use the public credential seam`);
      }
    }
    function visit(node) {
      if (ts.isIdentifier(node) && node.text === "require" && !(ts.isCallExpression(node.parent) && node.parent.expression === node && node.parent.arguments.length === 1 && ts.isStringLiteral(node.parent.arguments[0]))) failures.push(`${from}: aliased runtime loader is forbidden`);
      if (ts.isIdentifier(node) && ["eval", "Function", "createRequire"].includes(node.text) && !ts.isTypeReferenceNode(node.parent)) failures.push(`${from}: runtime code generation is forbidden`);
      if ((ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "require")) failures.push(`${from}: computed runtime loader is forbidden`);
      if (ts.isIdentifier(node) && node.text === "getBuiltinModule") {
        const access = node.parent, call = access.parent;
        if (from !== "src/lib/credentials/internal/github-installation.ts" || !ts.isPropertyAccessExpression(access) || access.expression.getText(source) !== "process" || !ts.isCallExpression(call) || call.expression !== access || call.arguments.length !== 1 || !ts.isStringLiteral(call.arguments[0]) || call.arguments[0].text !== "node:fs") failures.push(`${from}: only the fixed private file loader is allowed`);
      }
      if (publicEntries.has(from)) {
        if (ts.isExportAssignment(node) || (ts.isVariableStatement(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))) failures.push(`${from}: public credential entries expose only fixed operations`);
        if (ts.isFunctionDeclaration(node) && node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) && (from !== "src/lib/credentials/index.ts" || node.name?.text !== "authorizeCredentialAction")) failures.push(`${from}: public credential entries expose only fixed operations`);
        if (ts.isExportDeclaration(node) && !node.isTypeOnly) {
          const names = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.filter(element => !element.isTypeOnly).map(element => element.name.text) : null;
          if (names === null || (names.length && (from !== "src/lib/credentials/browser.ts" || names.some(name => name !== "createBrowserSessionAdapter")))) failures.push(`${from}: public credential entries cannot re-export private resources`);
        }
      }
      if (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && ["fetch", "XMLHttpRequest", "WebSocket"].includes(node.argumentExpression.text) && !from.startsWith(internalDirectory)) {
        const key = `${from} -> ${node.argumentExpression.text}`;
        transports.set(key, (transports.get(key) || 0) + 1);
      }
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
  for (const entry of clientEntries) {
    const visited = new Set();
    function visitClient(from) {
      if (visited.has(from)) return;
      visited.add(from);
      for (const to of dependencies.get(from) || []) {
        if (to === "src/lib/credentials/index.ts" || to === "server-only" || /^@supabase\//.test(to) || (to.startsWith(internalDirectory) && to !== "src/lib/credentials/internal/browser-session.ts")) failures.push(`${entry} -> ${to}: client dependency graph contains server credentials`);
        else visitClient(to);
      }
    }
    visitClient(entry);
  }
  for (const [key, count] of transports) {
    const allowance = resourceTransports.find(entry => `${entry.from} -> ${entry.name}` === key);
    if (!collect && count > (allowance?.references || 0)) failures.push(`${key}: network transport requires approved ownership`);
  }
  return collect ? { edges: observed, transports: [...transports].map(([key, references]) => {
    const [from, name] = key.split(" -> "); return { from, name, references };
  }) } : [...new Set(failures)];
}
