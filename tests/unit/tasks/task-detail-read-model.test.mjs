import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const taskDetailReadLimits = {
  ancestorDepth: 3,
  children: 200,
  comments: 200,
  externalComments: 300,
  blockers: 200,
  relationships: 250,
  activity: 500,
  reviews: 100,
};

function createSupabaseFixture(options = {}) {
  const calls = [];
  const target = {
    id: "target",
    task_type: "deliverable",
    parent_task_id: "parent",
    approval_status: "approved",
    updated_at: "2026-08-12T12:00:00.000Z",
  };
  const rows = {
    target,
    parent: {
      id: "parent",
      task_type: "initiative",
      parent_task_id: null,
      approval_status: "approved",
      updated_at: "2026-08-11T12:00:00.000Z",
    },
    child: {
      id: "child",
      task_type: "sub_issue",
      parent_task_id: "target",
      approval_status: "not_required",
      updated_at: "2026-08-10T12:00:00.000Z",
    },
    related: {
      id: "related",
      task_type: "deliverable",
      parent_task_id: null,
      approval_status: "approved",
      updated_at: "2026-08-09T12:00:00.000Z",
    },
  };

  function resultFor(call) {
    if (options.failedTable === call.table) return { data: null, error: { message: "fixture failure" } };
    if (options.failedTables?.includes(call.table)) return { data: null, error: { message: "fixture failure" } };
    if (call.table === "active_tasks") {
      const id = call.eq.find(([field]) => field === "id")?.[1];
      const parentId = call.eq.find(([field]) => field === "parent_task_id")?.[1];
      const ids = call.in.find(([field]) => field === "id")?.[1];
      if (id === "target") return { data: options.missingTarget ? null : target, error: null };
      if (id === "parent") return { data: rows.parent, error: null };
      if (parentId === "target") return { data: [rows.child], error: null };
      if (ids) return { data: ids.includes("related") ? [rows.related] : [], error: null };
      throw new Error("Task read was not constrained to an item, parent, or related IDs.");
    }
    if (call.table === "profiles") return { data: [{ id: "person", name: "Person" }], error: null };
    if (call.table === "projects") {
      return {
        data: {
          id: "findmydoc-founder-execution",
          name: "findmydoc Planning",
          range_label: "",
          review_objection_window_hours: 48,
          github_project_owner: "findmydoc-platform",
          github_project_number: 21,
        },
        error: null,
      };
    }
    if (call.table === "sprints") return { data: [{ id: "sprint" }], error: null };
    if (call.table === "task_relationship_edges") {
      return call.eq.some(([field]) => field === "task_id")
        ? { data: [{ id: 1, task_id: "target", related_task_id: "related", relation_type: "relates_to", created_at: "2026-08-12T12:00:00.000Z" }], error: null }
        : { data: [], error: null };
    }
    if (call.table === "task_comments") return { data: [{ id: 1, task_id: "target" }], error: null };
    if (call.table === "task_external_comments") return { data: [], error: null };
    if (call.table === "task_blockers") return { data: [], error: null };
    if (call.table === "task_audit_timeline") return { data: [{ id: 2, task_id: "target" }], error: null };
    if (call.table === "task_reviews") return { data: [], error: null };
    return { data: [], error: null };
  }

  return {
    calls,
    from(table) {
      const call = { table, eq: [], in: [], limits: [], orders: [] };
      calls.push(call);
      const query = {
        select() { return query; },
        eq(field, value) { call.eq.push([field, value]); return query; },
        in(field, value) { call.in.push([field, value]); return query; },
        order(field, options) { call.orders.push([field, options]); return query; },
        limit(value) { call.limits.push(value); return query; },
        maybeSingle() { return query; },
        single() { return query; },
        then(resolve, reject) { return Promise.resolve(resultFor(call)).then(resolve, reject); },
      };
      return query;
    },
  };
}

const mapTaskRow = (row) => ({
  id: row.id,
  taskType: row.task_type,
  parentTaskId: row.parent_task_id,
  approvalStatus: row.approval_status,
  updatedAt: row.updated_at,
});

const { createSupabaseTaskDetailReadModel } = await loadTranspiledModule(
  "src/features/tasks/server/task-detail-read-model-supabase.ts",
  {
    "server-only": {},
    "@/features/tasks/model/task-detail-read-model": { taskDetailReadLimits },
    "@/lib/planning-row-mappers": {
      mapTaskAuditActivity: (row) => row,
      mapTaskBlocker: (row) => row,
      mapTaskComment: (row) => row,
      mapTaskExternalComment: (row) => row,
      mapTaskRelation: (row) => ({ id: row.id, taskId: row.task_id, relatedTaskId: row.related_task_id }),
      mapTaskReview: (row) => row,
    },
    "@/lib/planning-row-types": { taskRowSelect: "id" },
    "@/lib/planning-profile-mappers": { mapProfile: (row) => row },
    "@/lib/planning-sprint-mappers": { mapSprint: (row) => row },
    "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
    "@/lib/planning-task-mappers": { mapTaskRow },
    "@/lib/sprint-review-window": { DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS: 48 },
  },
);

test("task detail read model rejects unauthorized reads before querying", async () => {
  const supabase = createSupabaseFixture();
  const result = await createSupabaseTaskDetailReadModel(supabase).load(
    { itemId: "target" },
    { authorized: false, actorProfileId: null },
  );
  assert.deepEqual(result, { status: "forbidden" });
  assert.equal(supabase.calls.length, 0);
});

test("task detail read model distinguishes not found from unavailable", async () => {
  const missing = createSupabaseFixture({ missingTarget: true });
  const missingResult = await createSupabaseTaskDetailReadModel(missing).load(
    { itemId: "target" },
    { authorized: true, actorProfileId: "person" },
  );
  assert.equal(missingResult.status, "notFound");
  assert.deepEqual(missingResult.people.map(({ id }) => id), ["person"]);

  const unavailable = createSupabaseFixture({ failedTable: "projects" });
  const unavailableResult = await createSupabaseTaskDetailReadModel(unavailable).load(
    { itemId: "target" },
    { authorized: true, actorProfileId: "person" },
  );
  assert.deepEqual(unavailableResult, { status: "unavailable" });
});

test("task detail read model returns complete targeted references in deterministic order", async () => {
  const supabase = createSupabaseFixture();
  const result = await createSupabaseTaskDetailReadModel(supabase).load(
    { itemId: " target " },
    { authorized: true, actorProfileId: "person" },
  );
  assert.equal(result.status, "ready");
  assert.equal(result.model.item.id, "target");
  assert.deepEqual(result.model.ancestors.map(({ id }) => id), ["parent"]);
  assert.deepEqual(result.model.children.map(({ id }) => id), ["child"]);
  assert.deepEqual(result.model.relatedItems.map(({ id }) => id), ["related"]);
  assert.equal(result.model.revision, "2026-08-12T12:00:00.000Z");

  const taskCalls = supabase.calls.filter(({ table }) => table === "active_tasks");
  assert.ok(taskCalls.every((call) => call.eq.length || call.in.length));
  assert.deepEqual(
    supabase.calls.find(({ table }) => table === "task_comments").limits,
    [taskDetailReadLimits.comments],
  );
  assert.deepEqual(
    supabase.calls.find(({ table }) => table === "task_audit_timeline").orders,
    [["created_at", { ascending: true }]],
  );
});

test("task detail read model exposes degraded areas instead of empty-domain ambiguity", async () => {
  const supabase = createSupabaseFixture({
    failedTables: ["task_relationship_edges", "task_comments", "task_audit_timeline"],
  });
  const result = await createSupabaseTaskDetailReadModel(supabase).load(
    { itemId: "target" },
    { authorized: true, actorProfileId: "person" },
  );
  assert.equal(result.status, "degraded");
  assert.deepEqual(result.unavailable, ["relationships", "discussion", "timeline"]);
  assert.deepEqual(result.model.relationships, []);
  assert.deepEqual(result.model.discussion.comments, []);
  assert.deepEqual(result.model.activity, []);
});
