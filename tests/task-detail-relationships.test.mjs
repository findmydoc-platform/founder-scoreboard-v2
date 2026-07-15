import assert from "node:assert/strict";
import test from "node:test";

import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const platform = await loadTranspiledModule("src/lib/platform.ts");
const state = await loadTranspiledModule(
  "src/features/tasks/model/task-detail-state.ts",
  {
    "@/features/tasks/model/task-relationship-permissions": {
      taskRelationshipAccess: () => ({ allowedRelationTypes: [], canRemoveRelation: () => false }),
    },
    "@/lib/display": { taskAssigneeLabel: (task) => task.assignee || "" },
    "@/lib/platform": platform,
    "@/lib/status": { normalizeStatus: (status) => status },
  },
);
const relationshipViewModel = await loadTranspiledModule(
  "src/lib/relationship-view-model.ts",
  {
    "@/lib/platform": platform,
    "@/lib/status": { normalizeStatus: (status) => status },
  },
);

const { effectiveTaskRelation, taskRelationsFor } = platform;
const { buildTaskRelationshipRows } = state;
const { relationMatchesDraft, relationshipBadgeFor } = relationshipViewModel;

function relation(overrides = {}) {
  return {
    id: 1,
    taskId: "task-a",
    relatedTaskId: "task-b",
    relationType: "blocked_by",
    note: "",
    ...overrides,
  };
}

function task(id, overrides = {}) {
  return { id, title: id, status: "Offen", assignee: id, ...overrides };
}

test("effectiveTaskRelation normalizes incoming and outgoing directions", () => {
  const blockedBy = relation();
  const blocks = relation({ relationType: "blocks" });

  assert.deepEqual(effectiveTaskRelation("task-a", blockedBy), { direction: "waitsOn", linkedTaskId: "task-b" });
  assert.deepEqual(effectiveTaskRelation("task-b", blockedBy), { direction: "blocks", linkedTaskId: "task-a" });
  assert.deepEqual(effectiveTaskRelation("task-a", blocks), { direction: "blocks", linkedTaskId: "task-b" });
  assert.deepEqual(effectiveTaskRelation("task-b", blocks), { direction: "waitsOn", linkedTaskId: "task-a" });
  assert.deepEqual(
    effectiveTaskRelation("task-b", relation({ relationType: "relates_to" })),
    { direction: "related", linkedTaskId: "task-a" },
  );
  assert.equal(effectiveTaskRelation("task-c", blockedBy), null);
});

test("relationship groups expose incoming blockers and deduplicate semantic inverses", () => {
  const relations = [
    relation({ id: 1, taskId: "task-a", relatedTaskId: "task-b", relationType: "blocked_by" }),
    relation({ id: 2, taskId: "task-b", relatedTaskId: "task-a", relationType: "blocks" }),
    relation({ id: 3, taskId: "task-a", relatedTaskId: "task-b", relationType: "relates_to" }),
    relation({ id: 4, taskId: "task-a", relatedTaskId: "task-c", relationType: "blocks" }),
    relation({ id: 5, taskId: "task-c", relatedTaskId: "task-a", relationType: "blocked_by" }),
  ];

  const grouped = taskRelationsFor("task-a", relations);
  assert.equal(grouped.waitsOn.length, 2);
  assert.equal(grouped.blocks.length, 2);

  const rows = buildTaskRelationshipRows(
    task("task-a"),
    [task("task-a"), task("task-b"), task("task-c")],
    relations,
  );
  assert.deepEqual(rows.waitsOn.map((row) => row.linkedTaskId), ["task-b"]);
  assert.deepEqual(rows.blocks.map((row) => row.linkedTaskId), ["task-c"]);
  assert.deepEqual(rows.related, []);
});

test("inverse relationship drafts are detected and incoming blockers get the correct badge", () => {
  const incomingBlocks = relation({ taskId: "task-b", relatedTaskId: "task-a", relationType: "blocks" });

  assert.equal(
    relationMatchesDraft("task-a", incomingBlocks, { relationType: "blocked_by", relatedTaskId: "task-b" }),
    true,
  );
  assert.deepEqual(
    relationshipBadgeFor(task("task-a"), incomingBlocks, task("task-b")),
    { label: "Blockiert aktuell", tone: "red" },
  );
});
