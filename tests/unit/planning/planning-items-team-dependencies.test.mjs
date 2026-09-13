import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

import { importTestModule } from "../../helpers/vitest-module.mjs";

async function loadContract() {
  return importTestModule(
    "src/features/planning-items/model/planning-items-team-dependency-contract.ts",
  );
}

test("dependency PATCH parsing keeps direction relative to the target item", async () => {
  const contract = await loadContract();

  assert.deepEqual(contract.parseTeamPlanningDependency({
    operation: "add",
    direction: "blocked_by",
    relatedItemId: " blocker ",
    note: " Waiting for approval ",
  }), {
    ok: true,
    dependency: {
      operation: "add",
      direction: "blocked_by",
      relatedItemId: "blocker",
      note: "Waiting for approval",
    },
  });

  assert.deepEqual(contract.parseTeamPlanningDependency({
    operation: "remove",
    relationshipId: 41,
  }), {
    ok: true,
    dependency: { operation: "remove", relationshipId: 41 },
  });
});

test("dependency PATCH parsing rejects unsupported directions, fields, and long notes", async () => {
  const contract = await loadContract();

  assert.equal(contract.parseTeamPlanningDependency({
    operation: "add",
    direction: "relates_to",
    relatedItemId: "target",
  }).ok, false);
  assert.equal(contract.parseTeamPlanningDependency({
    operation: "add",
    direction: "blocks",
    relatedItemId: "target",
    note: "x".repeat(501),
  }).ok, false);
  assert.equal(contract.parseTeamPlanningDependency({
    operation: "add",
    direction: "blocks",
    relatedItemId: "target",
    note: null,
  }).ok, false);
  assert.equal(contract.parseTeamPlanningDependency({
    operation: "remove",
    relationshipId: 41,
    note: "not allowed",
  }).ok, false);
});

test("canonical dependencies collapse storage direction into blocked and blocking items", async () => {
  const contract = await loadContract();

  assert.deepEqual(contract.canonicalPlanningDependency({
    id: 41,
    taskId: "blocked",
    relatedTaskId: "blocker",
    relationType: "blocked_by",
    note: "Wait",
  }), {
    relationshipId: 41,
    blockedItemId: "blocked",
    blockingItemId: "blocker",
    note: "Wait",
  });
  assert.deepEqual(contract.canonicalPlanningDependency({
    id: 42,
    taskId: "blocker",
    relatedTaskId: "blocked",
    relationType: "blocks",
    note: "Wait",
  }), {
    relationshipId: 42,
    blockedItemId: "blocked",
    blockingItemId: "blocker",
    note: "Wait",
  });
  assert.equal(contract.canonicalPlanningDependency({
    id: 43,
    taskId: "one",
    relatedTaskId: "two",
    relationType: "relates_to",
    note: "",
  }), null);
});

test("a new dependency preview has no relationship ID before storage", async () => {
  const contract = await loadContract();

  assert.deepEqual(contract.canonicalPlanningDependencyChange({
    id: 0,
    taskId: "blocked",
    relatedTaskId: "blocker",
    relationType: "blocked_by",
    note: "Wait",
  }), {
    relationshipId: null,
    blockedItemId: "blocked",
    blockingItemId: "blocker",
    note: "Wait",
  });
});

test("context returns only canonical blocking dependencies between visible planning items", async () => {
  const rows = {
    profiles: [{ id: "ceo", name: "CEO" }],
    sprints: [],
    active_tasks: [
      { id: "blocked", title: "Blocked", task_type: "deliverable", project_id: "findmydoc-founder-execution", status: "Offen", priority: "P2" },
      { id: "blocker", title: "Blocker", task_type: "deliverable", project_id: "findmydoc-founder-execution", status: "Offen", priority: "P2" },
    ],
    planning_item_strategy: [],
    planning_item_raci_assignments: [],
    task_blockers: [],
    task_relationship_edges: [
      { id: 41, task_id: "blocked", related_task_id: "blocker", relation_type: "blocked_by", note: "Wait" },
      { id: 42, task_id: "blocked", related_task_id: "blocker", relation_type: "relates_to", note: null },
      { id: 43, task_id: "blocked", related_task_id: "outside", relation_type: "blocks", note: null },
    ],
    task_comments: [],
    task_external_comments: [],
  };
  const supabase = {
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        order() { return query; },
        async range() { return { data: rows[table] || [], error: null }; },
      };
      return query;
    },
  };
  const contextModel = await importTestModule(
    "src/features/planning-items/model/planning-items-context.ts",
    {
      "@/lib/status": {
        normalizeStatus: (value) => value,
        normalizeSubIssueStatus: (value) => value,
      },
    },
  );

  const context = await contextModel.buildPlanningItemsContext(supabase, {
    id: "ceo",
    name: "CEO",
    platformRole: "ceo",
  });
  assert.deepEqual(context.dependencies, [{
    relationshipId: 41,
    blockedItemId: "blocked",
    blockingItemId: "blocker",
    note: "Wait",
  }]);
});

test("the unchanged v2 OpenAPI contract documents dependency reads and update commands", async () => {
  const contract = JSON.parse(await readFile(
    new URL("../../../public/founderops-team-planning-items-v2-openapi.json", import.meta.url),
    "utf8",
  ));

  assert.equal(contract.info.version, "2.1.0");
  assert.ok(contract.components.schemas.ContextResponse.properties.context.required.includes("dependencies"));
  assert.equal(
    contract.components.schemas.ContextResponse.properties.context.properties.dependencies.items.$ref,
    "#/components/schemas/PlanningDependency",
  );
  assert.equal(
    contract.components.schemas.PatchPayload.properties.dependency.$ref,
    "#/components/schemas/DependencyCommand",
  );
  assert.deepEqual(contract.components.schemas.DependencyDirection.enum, ["blocked_by", "blocks"]);
  assert.equal(contract.components.schemas.DependencyAddCommand.properties.note.maxLength, 500);
  assert.deepEqual(
    contract.components.schemas.PlanningDependencyChangeRelationship.properties.relationshipId.type,
    ["integer", "null"],
  );
});
