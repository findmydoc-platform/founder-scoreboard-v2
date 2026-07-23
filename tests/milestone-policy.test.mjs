import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const policy = await loadTranspiledModule("src/features/projects/model/milestone-policy.ts");

test("Milestone management is limited to operational leads", () => {
  assert.equal(policy.canManageMilestones("ceo"), true);
  assert.equal(policy.canManageMilestones("deputy"), true);
  assert.equal(policy.canManageMilestones("founder"), false);
  assert.equal(policy.canManageMilestones("viewer"), false);
  assert.equal(policy.canManageMilestones(null), false);
  assert.equal(policy.isManageableMilestone({ id: "milestone-one" }), true);
  assert.equal(policy.isManageableMilestone({ id: "" }), false);
});

test("Milestone delete policy blocks every non-empty child combination", () => {
  assert.deepEqual(policy.buildMilestoneDeletePolicy({ initiatives: 0, tasks: 0 }), {
    canDelete: true,
    isEmpty: true,
    children: { initiatives: 0, tasks: 0 },
    error: "",
  });

  const initiative = policy.buildMilestoneDeletePolicy({ initiatives: 1, tasks: 0 });
  assert.equal(initiative.canDelete, false);
  assert.match(initiative.error, /1 Initiative/);
  assert.doesNotMatch(initiative.error, /1 Initiativen/);

  const tasks = policy.buildMilestoneDeletePolicy({ initiatives: 0, tasks: 2 });
  assert.equal(tasks.canDelete, false);
  assert.match(tasks.error, /2 Aufgaben/);

  const mixed = policy.buildMilestoneDeletePolicy({ initiatives: 2, tasks: 1 });
  assert.equal(mixed.isEmpty, false);
  assert.match(mixed.error, /2 Initiativen und 1 Aufgabe/);
  assert.match(mixed.error, /nicht gelöscht/);
});

test("Milestone child counts are normalized before policy decisions", () => {
  assert.deepEqual(policy.normalizeMilestoneChildCounts({ initiatives: -4, tasks: 2.8 }), {
    initiatives: 0,
    tasks: 2,
  });
  assert.equal(policy.formatMilestoneChildCounts({ initiatives: 0, tasks: 0 }), "keine Initiativen oder Aufgaben");
});
