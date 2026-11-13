import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyPlanningReadBoundary } from "../../scripts/lib/planning-read-boundary.mjs";

const privateModule = "src/features/planning-items/server/selection.ts";
function fixture(files, run) {
  const root = mkdtempSync(path.join(tmpdir(), "planning-boundary-"));
  try {
    for (const [file, source] of Object.entries({ [privateModule]: "export const select = () => [];", ...files })) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), source);
    }
    return run(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
const policy = { privateModules: [privateModule], allowedEdges: [{ from: "src/adapter.ts", to: privateModule, consumer: "BOARD", owner: "Planning feature maintainer", reason: "Declared Board adapter", evidence: "planning-selected-deliverables.test.ts", expiresWhen: "Permanent declared boundary" }], readSites: [] };

test("a declared private read adapter is allowed and a neighboring reader is rejected", () => {
  fixture({ "src/adapter.ts": "import { select } from './features/planning-items/server/selection'; select();", "src/neighbor.ts": "import { select } from './features/planning-items/server/selection'; select();" }, root => {
    const failures = verifyPlanningReadBoundary({ root, policy });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /neighbor.*private/);
  });
});

for (const [name, source] of Object.entries({
  alias: "import { select } from '@/features/planning-items/server/selection'; select();",
  reexport: "export { select } from './features/planning-items/server/selection';",
  dynamic: "import('./features/planning-items/server/selection');",
  commonjs: "require('./features/planning-items/server/selection');",
  importEquals: "import reader = require('./features/planning-items/server/selection');",
  indirect: "export * from './features/planning-items/server/selection';",
})) test(`resolved ${name} cannot bypass the private read boundary`, () => {
  fixture({ "src/neighbor.ts": source, "src/consumer.ts": "import './neighbor';" }, root => assert.ok(verifyPlanningReadBoundary({ root, policy }).some(value => /neighbor.*private/.test(value))));
});

test("explicit type-only edges do not acquire a private reader", () => {
  fixture({ "src/consumer.ts": "import type { select } from './features/planning-items/server/selection'; export type Selection = typeof select;" }, root => assert.deepEqual(verifyPlanningReadBoundary({ root, policy }), []));
});

for (const source of ["import(variable);", "const load = require; load(variable);", "globalThis['require'](variable);", "eval(variable);", "new Function(variable);", "module.createRequire(variable);", "process.getBuiltinModule(variable);"])
  test(`an unresolved runtime loader fails closed: ${source}`, () => fixture({ "src/neighbor.ts": source }, root => assert.ok(verifyPlanningReadBoundary({ root, policy }).some(value => /runtime/.test(value)))));

for (const source of [
  "client.from('tasks').select('id');", "client.from('active_tasks').select('id');",
  "import { ACTIVE_TASKS_TABLE } from './constants'; client.from(ACTIVE_TASKS_TABLE).select('id');",
  "client.rpc('planning_deliverable_selection');", "client.rpc('planning_workspace_snapshot');",
  "client['from']('task_relationship_edges').select('id');",
]) test(`a competing Planning read is rejected: ${source}`, () => fixture({ "src/neighbor.ts": source, "src/constants.ts": "export const ACTIVE_TASKS_TABLE = 'active_tasks';" }, root => assert.ok(verifyPlanningReadBoundary({ root, policy }).some(value => /competing/.test(value)))));

test("mutation result projection is distinct from an independent read", () => {
  fixture({ "src/command.ts": "client.from('tasks').update({ title: 'Updated' }).eq('id', id).select('id');" }, root => assert.deepEqual(verifyPlanningReadBoundary({ root, policy }), []));
});

test("an exact accounted read remains allowed while a second neighboring read is rejected", () => {
  const source = "client.from('tasks').select('id').eq('id', target);";
  fixture({ "src/legacy.ts": source }, root => {
    const observed = verifyPlanningReadBoundary({ root, policy, collect: true });
    const exception = { ...observed.readSites[0], consumer: "DETAIL", owner: "Tasks feature maintainer", reason: "Existing identity read until DETAIL migration", evidence: "task-detail-read-model.test.mjs", expiresWhen: "DETAIL migration under #641" };
    const accounted = { ...policy, readSites: [exception] };
    assert.deepEqual(verifyPlanningReadBoundary({ root, policy: accounted }), []);
    writeFileSync(path.join(root, "src/legacy.ts"), `${source}\nclient.from('tasks').select('*');`);
    assert.ok(verifyPlanningReadBoundary({ root, policy: accounted }).some(value => /competing/.test(value)));
  });
});

for (const source of ["client.from(table).select('id');", "client.rpc(operation);", "const read = client.from; read('tasks');", "const read = client['rpc']; read('planning_source_version');"])
  test(`an unresolved or detached reader cannot hide a competing Planning read: ${source}`, () => fixture({ "src/neighbor.ts": source }, root => assert.ok(verifyPlanningReadBoundary({ root, policy }).some(value => /competing|detached/.test(value)))));

test("standard collection construction is not database access", () => fixture({ "src/collection.ts": "const ids = Array.from({ length: 20 }, (_, index) => index);" }, root => assert.deepEqual(verifyPlanningReadBoundary({ root, policy }), [])));

test("renamed imported table constants are resolved before ownership is checked", () => fixture({ "src/constants.ts": "export const table = 'tasks';", "src/neighbor.ts": "import { table as data } from './constants'; client.from(data).select('id');" }, root => assert.ok(verifyPlanningReadBoundary({ root, policy }).some(value => /competing.*tasks/.test(value)))));
