import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

function createSupabaseFixture(failedTable = "") {
  const calls = [];
  const data = {
    projects: { id: "findmydoc-founder-execution", name: "findmydoc Planning", range_label: "", review_objection_window_hours: 48 },
    profiles: [{ id: "person", name: "Person" }],
    active_tasks: [
      { id: "epic", task_type: "epic", parent_task_id: null, approval_status: "not_required", updated_at: "2026-08-10T00:00:00.000Z" },
      { id: "initiative", task_type: "initiative", parent_task_id: "epic", approval_status: "approved", updated_at: "2026-08-11T00:00:00.000Z" },
      { id: "deliverable", task_type: "deliverable", parent_task_id: "initiative", approval_status: "approved", updated_at: "2026-08-12T00:00:00.000Z" },
    ],
    planning_item_strategy: [],
    planning_item_raci_assignments: [],
    task_links: [],
    sprints: [{ id: "sprint" }],
    task_relationship_edges: [
      { id: 1, task_id: "deliverable", related_task_id: "initiative", relation_type: "relates_to" },
      { id: 2, task_id: "deliverable", related_task_id: "inactive", relation_type: "relates_to" },
    ],
    profile_ui_preferences: [{ profile_id: "person" }],
  };
  return {
    calls,
    from(table) {
      const call = { table, eq: [], orders: [], limit: null };
      calls.push(call);
      const query = {
        select() { return query; },
        eq(field, value) { call.eq.push([field, value]); return query; },
        single() { return query; },
        order(field, options) { call.orders.push([field, options]); return query; },
        limit(value) { call.limit = value; return query; },
        then(resolve, reject) {
          const result = table === failedTable
            ? { data: null, error: { message: "fixture failure" } }
            : { data: data[table] ?? [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const moduleStubs = {
  "server-only": {},
  "@/lib/planning-row-mappers": { mapTaskRelation: (row) => ({ id: row.id, taskId: row.task_id, relatedTaskId: row.related_task_id, relationType: row.relation_type }) },
  "@/lib/planning-row-types": { taskRowSelect: "id" },
  "@/lib/planning-profile-mappers": {
    mapProfile: (row) => ({ id: row.id, name: row.name }),
    mapProfileUiPreference: (row) => ({ profileId: row.profile_id }),
  },
  "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
  "@/lib/planning-sprint-mappers": { mapSprint: (row) => row },
  "@/lib/planning-task-mappers": {
    mapTaskRow: (row) => ({
      id: row.id,
      taskType: row.task_type,
      parentTaskId: row.parent_task_id,
      approvalStatus: row.approval_status,
      updatedAt: row.updated_at,
    }),
  },
  "@/lib/sprint-review-window": { DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS: 48 },
};

const { loadPlanningWorkspaceModel } = await loadTranspiledModule(
  "src/features/planning-items/server/planning-workspace-read-source.ts",
  moduleStubs,
);

test("planning workspace reader fails closed and distinguishes dependency failure", async () => {
  const denied = createSupabaseFixture();
  assert.deepEqual(await loadPlanningWorkspaceModel(denied, { authorized: false, actorProfileId: null }), { status: "forbidden" });
  assert.equal(denied.calls.length, 0);
  const unavailable = createSupabaseFixture("task_relationship_edges");
  assert.deepEqual(await loadPlanningWorkspaceModel(unavailable, { authorized: true, actorProfileId: "person" }), { status: "unavailable" });
});

test("planning workspace reader loads only the focused canonical model", async () => {
  const supabase = createSupabaseFixture();
  const result = await loadPlanningWorkspaceModel(supabase, { authorized: true, actorProfileId: "person" });
  assert.equal(result.status, "ready");
  assert.equal(result.model.revision, "2026-08-12T00:00:00.000Z");
  assert.deepEqual(result.model.items.map(({ id }) => id), ["epic", "initiative", "deliverable"]);
  assert.equal(result.model.items.find(({ id }) => id === "deliverable").parentApprovalStatus, "approved");
  assert.deepEqual(result.model.relationships.map(({ id }) => id), [1]);
  assert.deepEqual(Object.keys(result.model).sort(), ["items", "people", "preferences", "project", "relationships", "revision", "sprints"]);
  assert.deepEqual(supabase.calls.map(({ table }) => table), [
    "projects",
    "profiles",
    "active_tasks",
    "planning_item_strategy",
    "planning_item_raci_assignments",
    "task_links",
    "sprints",
    "task_relationship_edges",
    "profile_ui_preferences",
  ]);
  assert.equal(supabase.calls.find(({ table }) => table === "task_relationship_edges").limit, 500);
});
