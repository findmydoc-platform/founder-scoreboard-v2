import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const { requireActivePlanningItem } = await loadTranspiledModule(
  "src/lib/planning-trash-mutation-guard.ts",
);

function guardSupabase(result) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result,
  };
  return { from: () => query };
}

test("central planning mutation guard distinguishes active, missing, and trashed items", async () => {
  assert.deepEqual(
    await requireActivePlanningItem(guardSupabase({ data: { id: "task-1", trashed_at: null }, error: null }), "task-1"),
    { ok: true },
  );
  assert.deepEqual(
    await requireActivePlanningItem(guardSupabase({ data: null, error: null }), "initiative-1"),
    { ok: false, status: 404, error: "Planning-Item wurde nicht gefunden." },
  );
  assert.deepEqual(
    await requireActivePlanningItem(guardSupabase({ data: { id: "task-1", trashed_at: "2026-07-13T08:00:00Z" }, error: null }), "task-1"),
    { ok: false, status: 409, error: "Planning-Item befindet sich im Papierkorb und kann nicht geändert werden." },
  );
});

test("canonical trashed Initiatives retain strategy, RACI, parent, and direct children", async () => {
  const trashDetail = await loadTranspiledModule(
    "src/lib/planning-trash-detail.ts",
    {
      "@/lib/planning-task-mappers": {
        mapTaskRow: (row, _profiles, options) => ({
          id: row.id,
          title: row.title,
          taskType: row.task_type,
          approvalStatus: row.approval_status,
          status: row.status,
          priority: row.priority,
          owner: "Sebastian",
          assignee: "Sebastian",
          description: row.description,
          strategy: options.strategy ? {
            goal: options.strategy.goal,
            successCriteria: options.strategy.success_criteria,
            scopeConstraints: options.strategy.scope_constraints,
          } : undefined,
          raciAssignments: options.raciAssignments.map((assignment) => ({
            profileId: assignment.profile_id,
            role: assignment.role,
            sortOrder: assignment.sort_order,
          })),
          githubIssueNumber: null,
          githubIssueUrl: "",
          issueNumber: "",
          issueUrl: "",
          trashedAt: row.trashed_at,
          trashedById: row.trashed_by,
          trashReason: row.trash_reason,
          trashCause: row.trash_cause,
          purgeAfter: row.purge_after,
          trashRootType: row.trash_root_type,
          trashRootId: row.trash_root_id,
          trashRevision: row.trash_revision,
        }),
      },
      "@/lib/planning-row-types": { taskRowSelect: "task-columns" },
    },
  );
  const initiativeRow = {
    id: "initiative-1",
    title: "Strategic initiative",
    description: "Fallback",
    task_type: "initiative",
    parent_task_id: "epic-1",
    status: "In Arbeit",
    priority: "P1",
    approval_status: "approved",
    trashed_at: "2026-08-01T09:00:00.000Z",
    trashed_by: "ceo",
    trash_reason: "Superseded",
    trash_cause: "withdrawn",
    purge_after: "2026-09-01T09:00:00.000Z",
    trash_root_type: "initiative",
    trash_root_id: "initiative-1",
    trash_revision: 2,
  };
  const strategy = {
    task_id: "initiative-1",
    goal: "Reach launch readiness",
    success_criteria: "All gates are green",
    scope_constraints: "No product expansion",
  };
  const raci = [{ task_id: "initiative-1", profile_id: "ceo", role: "accountable", sort_order: 0 }];
  const supabase = {
    from(table) {
      const filters = {};
      const builder = {
        select() { return this; },
        eq(field, value) { filters[field] = value; return this; },
        order() { return this; },
        async maybeSingle() {
          if (table === "tasks" && filters.id === "initiative-1") return { data: initiativeRow, error: null };
          if (table === "tasks" && filters.id === "epic-1") {
            return { data: { id: "epic-1", title: "Launch Epic", task_type: "epic", approval_status: null, trashed_at: null }, error: null };
          }
          if (table === "planning_item_strategy") return { data: strategy, error: null };
          return { data: null, error: null };
        },
        async returns() {
          if (table === "tasks" && filters.parent_task_id === "initiative-1") {
            return { data: [{ id: "deliverable-1", title: "Ship", task_type: "deliverable", approval_status: "approved", trashed_at: initiativeRow.trashed_at }], error: null };
          }
          if (table === "planning_item_raci_assignments") return { data: raci, error: null };
          return { data: [], error: null };
        },
      };
      return builder;
    },
  };

  const result = await trashDetail.loadPlanningTrashTaskDetail(
    supabase,
    "initiative-1",
    [{ id: "ceo", name: "Sebastian" }],
  );
  assert.equal(result.ok, true);
  assert.equal(result.detail.task.taskType, "initiative");
  assert.equal(result.detail.task.strategy.goal, "Reach launch readiness");
  assert.deepEqual(result.detail.task.raciAssignments, [{ profileId: "ceo", role: "accountable", sortOrder: 0 }]);
  assert.equal(result.detail.parent.taskType, "epic");
  assert.equal(result.detail.epic.taskType, "epic");
  assert.equal(result.detail.children[0].taskType, "deliverable");
});

test("notification targets keep rejected initiatives readable and returned items editable", async () => {
  const { notificationTarget } = await loadTranspiledModule(
    "src/features/notifications/model/notification-target.ts",
  );

  assert.equal(notificationTarget({ entityType: "task", entityId: "task/1" }).href, "/tasks/task%2F1");
  assert.equal(
    notificationTarget({ entityType: "task", entityId: "task-1", targetPath: "/tasks/task-1?comment=github:42" }).href,
    "/tasks/task-1?comment=github:42",
  );
  assert.equal(
    notificationTarget({ entityType: "task", entityId: "task-1", targetPath: "//outside.test/path" }).href,
    "/tasks/task-1",
  );
  assert.equal(notificationTarget({ entityType: "initiative", entityId: "initiative/1" }).href, "/initiatives/initiative%2F1");
  assert.deepEqual(
    notificationTarget({ type: "planning_item.returned", entityType: "initiative", entityId: "initiative/1" }),
    { workspace: "backlog", href: "/backlog?backlog.level=initiative" },
  );
  assert.equal(
    notificationTarget({ type: "planning_item.rejected", entityType: "initiative", entityId: "initiative/1" }).href,
    "/initiatives/initiative%2F1",
  );
});
