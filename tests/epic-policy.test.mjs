import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const policy = await loadTranspiledModule("src/features/projects/model/epic-policy.ts");

test("Epic management is limited to operational leads", () => {
  assert.equal(policy.canManageEpics("ceo"), true);
  assert.equal(policy.canManageEpics("deputy"), true);
  assert.equal(policy.canManageEpics("founder"), false);
  assert.equal(policy.canManageEpics("viewer"), false);
  assert.equal(policy.canManageEpics(null), false);
  assert.equal(policy.isManageableEpic({ id: "epic-one" }), true);
  assert.equal(policy.isManageableEpic({ id: "" }), false);
});

test("Epic delete policy blocks every non-empty child combination", () => {
  assert.deepEqual(policy.buildEpicDeletePolicy({ initiatives: 0, tasks: 0 }), {
    canDelete: true,
    isEmpty: true,
    children: { initiatives: 0, tasks: 0 },
    error: "",
  });

  const initiative = policy.buildEpicDeletePolicy({ initiatives: 1, tasks: 0 });
  assert.equal(initiative.canDelete, false);
  assert.match(initiative.error, /1 Initiative/);
  assert.doesNotMatch(initiative.error, /1 Initiativen/);

  const tasks = policy.buildEpicDeletePolicy({ initiatives: 0, tasks: 2 });
  assert.equal(tasks.canDelete, false);
  assert.match(tasks.error, /2 Aufgaben/);

  const mixed = policy.buildEpicDeletePolicy({ initiatives: 2, tasks: 1 });
  assert.equal(mixed.isEmpty, false);
  assert.match(mixed.error, /2 Initiativen und 1 Aufgabe/);
  assert.match(mixed.error, /nicht gelöscht/);
});

test("Epic child counts are normalized before policy decisions", () => {
  assert.deepEqual(policy.normalizeEpicChildCounts({ initiatives: -4, tasks: 2.8 }), {
    initiatives: 0,
    tasks: 2,
  });
  assert.equal(policy.formatEpicChildCounts({ initiatives: 0, tasks: 0 }), "keine Initiativen oder Aufgaben");
});
