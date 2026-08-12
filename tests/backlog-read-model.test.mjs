import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

function createSupabaseFixture(failedTable = "") {
  const calls = [];
  const data = {
    profiles: [{ id: "person", name: "Person", weekly_capacity: 20 }],
    active_tasks: [
      { id: "epic", task_type: "epic", parent_task_id: null, approval_status: "not_required", updated_at: "2026-08-10T00:00:00.000Z" },
      { id: "initiative", task_type: "initiative", parent_task_id: "epic", approval_status: "approved", updated_at: "2026-08-11T00:00:00.000Z" },
      { id: "deliverable", task_type: "deliverable", parent_task_id: "initiative", approval_status: "approved", updated_at: "2026-08-12T00:00:00.000Z" },
      { id: "sub", task_type: "sub_issue", parent_task_id: "deliverable", approval_status: "not_required", updated_at: "2026-08-09T00:00:00.000Z" },
    ],
    planning_item_strategy: [],
    planning_item_raci_assignments: [],
    task_links: [],
    sprints: [{ id: "sprint" }],
    sprint_commitments: [{ id: 1, sprint_id: "sprint", profile_id: "person", weekly_hours: 20 }],
  };
  return {
    calls,
    from(table) {
      const call = { table, eq: [], orders: [] };
      calls.push(call);
      const query = {
        select() { return query; },
        eq(field, value) { call.eq.push([field, value]); return query; },
        order(field, options) { call.orders.push([field, options]); return query; },
        then(resolve, reject) {
          const result = table === failedTable
            ? { data: null, error: { message: "fixture failure" } }
            : { data: data[table] || [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const { createSupabaseBacklogReadModel } = await loadTranspiledModule(
  "src/features/backlog/server/backlog-read-model-supabase.ts",
  {
    "server-only": {},
    "@/lib/planning-data-row-types": { taskRowSelect: "id" },
    "@/lib/planning-profile-mappers": { mapProfile: (row) => ({ id: row.id, name: row.name, weeklyCapacity: row.weekly_capacity }) },
    "@/lib/planning-sprint-mappers": {
      mapSprint: (row) => row,
      mapSprintCommitment: (row) => ({ id: row.id, sprintId: row.sprint_id, profileId: row.profile_id, weeklyHours: row.weekly_hours }),
    },
    "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
    "@/lib/planning-task-mappers": {
      mapTaskRow: (row) => ({
        id: row.id,
        taskType: row.task_type,
        parentTaskId: row.parent_task_id,
        approvalStatus: row.approval_status,
        updatedAt: row.updated_at,
      }),
    },
  },
);

const { backlogModelReducer } = await loadTranspiledModule(
  "src/features/backlog/model/backlog-read-model.ts",
);

test("backlog reader fails closed before queries and distinguishes dependency failure", async () => {
  const denied = createSupabaseFixture();
  assert.deepEqual(
    await createSupabaseBacklogReadModel(denied).load({ authorized: false, actorProfileId: null }),
    { status: "forbidden" },
  );
  assert.equal(denied.calls.length, 0);

  const unavailable = createSupabaseFixture("sprints");
  assert.deepEqual(
    await createSupabaseBacklogReadModel(unavailable).load({ authorized: true, actorProfileId: "person" }),
    { status: "unavailable" },
  );
});

test("backlog reader loads one deterministic feature model with complete hierarchy references", async () => {
  const supabase = createSupabaseFixture();
  const result = await createSupabaseBacklogReadModel(supabase).load({ authorized: true, actorProfileId: "person" });
  assert.equal(result.status, "ready");
  assert.deepEqual(result.model.items.map(({ id }) => id), ["epic", "initiative", "deliverable", "sub"]);
  assert.equal(result.model.items.find(({ id }) => id === "deliverable").parentApprovalStatus, "approved");
  assert.equal(result.model.revision, "2026-08-12T00:00:00.000Z");
  assert.deepEqual(result.model.people.map(({ id }) => id), ["person"]);
  assert.deepEqual(result.model.commitments.map(({ sprintId }) => sprintId), ["sprint"]);
  assert.deepEqual(supabase.calls.map(({ table }) => table), [
    "profiles",
    "active_tasks",
    "planning_item_strategy",
    "planning_item_raci_assignments",
    "task_links",
    "sprints",
    "sprint_commitments",
  ]);
  assert.deepEqual(supabase.calls.find(({ table }) => table === "active_tasks").eq, [["project_id", "findmydoc-founder-execution"]]);
  assert.deepEqual(supabase.calls.find(({ table }) => table === "active_tasks").orders.map(([field]) => field), ["sort_order", "id"]);
});

test("backlog reducer patches only its own item slice", () => {
  const model = {
    revision: "one",
    items: [{ id: "item", title: "Old" }],
    people: [{ id: "person" }],
    sprints: [{ id: "sprint" }],
    commitments: [{ id: 1 }],
  };
  const updated = backlogModelReducer(model, { type: "itemsPatched", patches: [{ id: "item", title: "New" }] });
  assert.equal(updated.items[0].title, "New");
  assert.equal(updated.people, model.people);
  assert.equal(updated.sprints, model.sprints);
  assert.equal(updated.commitments, model.commitments);
});

test("backlog page and client state no longer depend on global PlanningData reads", async () => {
  const [workspacePage, overview, commands, viewModel, scopes] = await Promise.all([
    readFile("src/app/(workspaces)/workspace-page.tsx", "utf8"),
    readFile("src/features/backlog/organisms/backlog-overview.tsx", "utf8"),
    readFile("src/features/backlog/hooks/use-backlog-commands.ts", "utf8"),
    readFile("src/features/backlog/model/backlog-view-model.ts", "utf8"),
    readFile("src/lib/planning-data-scopes.ts", "utf8"),
  ]);
  assert.match(workspacePage, /createSupabaseBacklogReadModel\(supabase\)\.load/);
  assert.match(workspacePage, /initialWorkspace === "backlog"[\s\S]*loadBacklogPageData/);
  assert.match(overview, /useReducer\(backlogModelReducer, initialModel\)/);
  assert.match(overview, /requestBacklogModel/);
  for (const source of [overview, commands, viewModel]) assert.doesNotMatch(source, /PlanningData|refreshPlanningData|setData/);
  assert.doesNotMatch(scopes, /backlog: \{/);
});
