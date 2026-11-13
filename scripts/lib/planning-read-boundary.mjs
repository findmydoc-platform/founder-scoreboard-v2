import ts from "typescript";
import path from "node:path";
import { createHash } from "node:crypto";
import { createSourceModuleResolver } from "./source-module-resolver.mjs";

const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const tables = new Set(["tasks", "active_tasks", "planning_item_strategy", "planning_item_raci_assignments", "task_links", "task_dependencies", "task_relationship_edges", "task_blockers"]);
const readRpcs = /^(planning_workspace_snapshot|planning_source_version|planning_deliverable_selection|planning_.*(read|search|select|snapshot|summary|count|version).*|prepare_(team_)?planning_.*command)$/;
const field = node => ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
const accountable = entry => ["consumer", "owner", "reason", "evidence", "expiresWhen"].every(key => typeof entry[key] === "string" && entry[key].trim());

export function verifyPlanningReadBoundary({ root, policy, collect = false }) {
  const accountableEntry = entry => accountable({ ...policy.contracts?.[entry.contract], ...entry });
  const resolver = createSourceModuleResolver(root), failures = [], edges = [], sites = [];
  const files = ts.sys.readDirectory(path.join(root, "src"), extensions);
  const queued = new Set(files), parsed = new Map();
  const privateModules = new Set(policy.privateModules || []);
  const parse = file => {
    if (!parsed.has(file)) parsed.set(file, ts.createSourceFile(file, ts.sys.readFile(file) || "", ts.ScriptTarget.Latest, true));
    return parsed.get(file);
  };
  const imports = new Map();
  function literal(node, source, visited = new Set()) {
    if (!node) return null;
    if (ts.isStringLiteralLike(node)) return node.text;
    if (!ts.isIdentifier(node)) return null;
    const key = `${source.fileName}:${node.text}`;
    if (visited.has(key)) return null;
    visited.add(key);
    let found;
    function visit(value) {
      if (ts.isVariableDeclaration(value) && ts.isIdentifier(value.name) && value.name.text === node.text) found = literal(value.initializer, source, visited);
      ts.forEachChild(value, visit);
    }
    visit(source);
    if (found) return found;
    const imported = imports.get(key);
    if (imported) return literal(ts.factory.createIdentifier(imported.name), parse(imported.file), visited);
    // The existing canonical table identity is used across declared adapters.
    return node.text === "ACTIVE_TASKS_TABLE" ? "active_tasks" : null;
  }
  function candidates(node, source) {
    if (node && ts.isConditionalExpression(node)) {
      const left = candidates(node.whenTrue, source), right = candidates(node.whenFalse, source);
      return left && right ? [...new Set([...left, ...right])] : null;
    }
    const value = literal(node, source);
    return value ? [value] : null;
  }
  for (const file of files) {
    const from = resolver.relative(file), source = parse(file);
    function dependency(specifier, typeOnly) {
      if (typeOnly) return;
      const resolved = resolver.resolve(specifier, file);
      const to = resolved && !resolved.isExternalLibraryImport ? resolver.relative(resolved.resolvedFileName) : specifier;
      if (resolved && !resolved.isExternalLibraryImport && !queued.has(resolved.resolvedFileName) && extensions.some(extension => resolved.resolvedFileName.endsWith(extension))) { queued.add(resolved.resolvedFileName); files.push(resolved.resolvedFileName); }
      if (privateModules.has(to)) {
        edges.push({ from, to });
        const allowance = policy.allowedEdges?.find(entry => entry.from === from && entry.to === to && accountableEntry(entry));
        if (!collect && !allowance) failures.push(`${from} -> ${to}: Planning read implementation is private`);
      }
      return resolved;
    }
    // Register constants before inspecting calls, regardless of import order.
    for (const statement of source.statements) if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings;
      const resolved = resolver.resolve(statement.moduleSpecifier.text, file);
      if (bindings && ts.isNamedImports(bindings) && resolved && !resolved.isExternalLibraryImport) for (const element of bindings.elements) imports.set(`${file}:${element.name.text}`, { file: resolved.resolvedFileName, name: element.propertyName?.text || element.name.text });
    }
    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause, bindings = clause?.namedBindings;
        dependency(node.moduleSpecifier.text, clause?.isTypeOnly || bindings && ts.isNamedImports(bindings) && !clause.name && bindings.elements.length > 0 && bindings.elements.every(value => value.isTypeOnly));
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        dependency(node.moduleSpecifier.text, node.isTypeOnly || node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.length > 0 && node.exportClause.elements.every(value => value.isTypeOnly));
      } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteral(node.moduleReference.expression)) dependency(node.moduleReference.expression.text, node.isTypeOnly);
      else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require")) {
        if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) dependency(node.arguments[0].text, false);
        else failures.push(`${from}: unresolved runtime dependency is forbidden`);
      }
      if (ts.isIdentifier(node) && node.text === "require" && !(ts.isCallExpression(node.parent) && node.parent.expression === node)) failures.push(`${from}: aliased runtime loader is forbidden`);
      if (ts.isIdentifier(node) && ["eval", "Function", "createRequire"].includes(node.text) && !ts.isTypeReferenceNode(node.parent)) failures.push(`${from}: generated runtime loader is forbidden`);
      if (ts.isElementAccessExpression(node) && field(node) === "require") failures.push(`${from}: computed runtime loader is forbidden`);
      if (ts.isIdentifier(node) && node.text === "getBuiltinModule") {
        const access = node.parent, call = access.parent;
        if (from !== "src/lib/credentials/internal/github-installation.ts" || !ts.isPropertyAccessExpression(access) || access.expression.getText(source) !== "process" || !ts.isCallExpression(call) || call.arguments.length !== 1 || !ts.isStringLiteral(call.arguments[0]) || call.arguments[0].text !== "node:fs") failures.push(`${from}: unresolved runtime loader is forbidden`);
      }
      const receiver = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : null;
      const builtinCollection = receiver && ts.isIdentifier(receiver) && ["Array", "Buffer", "Uint8Array", "Int32Array", "Float64Array"].includes(receiver.text);
      const detached = node.parent && (ts.isVariableDeclaration(node.parent) && node.parent.initializer === node
        || ts.isBinaryExpression(node.parent) && node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.parent.right === node
        || ts.isPropertyAccessExpression(node.parent) && ["bind", "call", "apply"].includes(node.parent.name.text));
      if (receiver && !builtinCollection && ["from", "rpc"].includes(field(node)) && detached) failures.push(`${from}: detached database reader is forbidden`);
      if (ts.isCallExpression(node) && ["from", "rpc"].includes(field(node.expression))) {
        const callReceiver = ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression) ? node.expression.expression : null;
        const collectionCall = callReceiver && ts.isIdentifier(callReceiver) && ["Array", "Buffer", "Uint8Array", "Int32Array", "Float64Array"].includes(callReceiver.text);
        const kind = field(node.expression), targets = candidates(node.arguments[0], source) || ["<dynamic>"];
        const planningTargets = targets.filter(target => target === "<dynamic>" || (kind === "from" ? tables.has(target) : readRpcs.test(target)));
        const target = planningTargets.sort().join("|");
        if (!collectionCall && planningTargets.length) {
          let chain = node;
          const operations = [];
          while (ts.isPropertyAccessExpression(chain.parent) || ts.isElementAccessExpression(chain.parent) || ts.isCallExpression(chain.parent)) {
            chain = chain.parent;
            if (ts.isCallExpression(chain)) operations.push(field(chain.expression));
          }
          if (!operations.some(operation => ["insert", "update", "upsert", "delete"].includes(operation))) {
            const expression = ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Expression, chain, source);
            const fingerprint = createHash("sha256").update(expression).digest("hex");
            const site = { from, kind, target, fingerprint };
            sites.push(site);
            if (!collect && !policy.readSites?.some(entry => entry.from === from && entry.kind === kind && entry.target === target && entry.fingerprint === fingerprint && accountableEntry(entry))) failures.push(`${from}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: competing Planning ${kind} read ${target} (${fingerprint})`);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  // A duplicate exact expression still represents another unaccounted read.
  if (!collect) {
    const grouped = new Map();
    for (const site of sites) { const key = JSON.stringify(site); grouped.set(key, (grouped.get(key) || 0) + 1); }
    for (const [key, count] of grouped) {
      const site = JSON.parse(key), entry = policy.readSites?.find(value => value.from === site.from && value.fingerprint === site.fingerprint && value.kind === site.kind && value.target === site.target);
      if (entry && count > (entry.references || 1)) failures.push(`${site.from}: competing duplicate Planning read ${site.target}`);
    }
    for (const entry of [...(policy.allowedEdges || []), ...(policy.readSites || [])]) if (!accountableEntry(entry)) failures.push(`${entry.from}: Planning exception is missing accountable contract fields`);
  }
  return collect ? { edges, readSites: sites } : [...new Set(failures)];
}
