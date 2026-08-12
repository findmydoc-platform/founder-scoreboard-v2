import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

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
    await requireActivePlanningItem(guardSupabase({ data: { id: "task-1", trashed_at: null }, error: null }), "tasks", "task-1"),
    { ok: true },
  );
  assert.deepEqual(
    await requireActivePlanningItem(guardSupabase({ data: null, error: null }), "packages", "initiative-1"),
    { ok: false, status: 404, error: "Initiative wurde nicht gefunden." },
  );
  assert.deepEqual(
    await requireActivePlanningItem(guardSupabase({ data: { id: "task-1", trashed_at: "2026-07-13T08:00:00Z" }, error: null }), "tasks", "task-1"),
    { ok: false, status: 409, error: "Aufgabe befindet sich im Papierkorb und kann nicht geändert werden." },
  );
});

test("all high-risk task and initiative mutations use the centralized active guard", async () => {
  const guardedRoutes = [
    "src/app/api/tasks/[id]/route.ts",
    "src/app/api/tasks/[id]/approval/route.ts",
    "src/app/api/tasks/[id]/comments/route.ts",
    "src/app/api/tasks/[id]/github-comments/route.ts",
    "src/app/api/tasks/[id]/blockers/route.ts",
    "src/app/api/tasks/[id]/attachments/route.ts",
  ];

  for (const route of guardedRoutes) {
    const source = await read(route);
    assert.match(source, /requireActivePlanningItem/, `${route} must fail closed for trash mutations`);
  }
  for (const route of [
    "src/app/api/initiatives/[id]/route.ts",
    "src/app/api/initiatives/[id]/approval/route.ts",
  ]) {
    const source = await read(route);
    assert.match(source, /loadCanonicalStrategicItem/, `${route} must use the active canonical item adapter`);
  }
  const syncProjection = await read("src/lib/github-sync/task-projection.ts");
  assert.match(syncProjection, /requireActivePlanningItem/, "task projection must fail closed for trash mutations");

  const [relationshipRoute, relationshipModule, relationshipMigration] = await Promise.all([
    read("src/app/api/tasks/[id]/relationships/route.ts"),
    read("src/features/planning-items/model/planning-items-relationships.ts"),
    read("supabase/migrations/20260812131418_planning_relationship_command_transaction.sql"),
  ]);
  assert.match(relationshipRoute, /createPlanningRelationshipPlanningItems/);
  assert.match(relationshipModule, /state\.source\.trashed/);
  assert.match(relationshipModule, /state\.related\.trashed/);
  assert.match(relationshipMigration, /v_source\.trashed_at is not null/);
  assert.match(relationshipMigration, /v_related\.trashed_at is not null/);

  const [reviewRoute, reviewReopenRoute, reviewWithdrawRoute, reviewModule, reviewMigration] = await Promise.all([
    read("src/app/api/tasks/[id]/review/route.ts"),
    read("src/app/api/tasks/[id]/review/reopen/route.ts"),
    read("src/app/api/tasks/[id]/review/withdraw/route.ts"),
    read("src/features/planning-items/model/planning-items-review.ts"),
    read("supabase/migrations/20260812133802_planning_review_command_transaction.sql"),
  ]);
  for (const route of [reviewRoute, reviewReopenRoute, reviewWithdrawRoute]) {
    assert.match(route, /createPlanningReviewPlanningItems/);
  }
  assert.match(reviewModule, /task\.trashed/);
  assert.match(reviewMigration, /v_task\.trashed_at is not null/);
});

test("reparenting and relationship targets use active read models", async () => {
  const [taskRoute, relationshipModule, relationshipMigration] = await Promise.all([
    read("src/app/api/tasks/[id]/route.ts"),
    read("src/features/planning-items/model/planning-items-relationships.ts"),
    read("supabase/migrations/20260812131418_planning_relationship_command_transaction.sql"),
  ]);

  assert.match(taskRoute, /\.from\(ACTIVE_TASKS_TABLE\)[^]*\.select\("id,task_type,approval_status"\)/);
  assert.match(relationshipModule, /state\.related\.trashed/);
  assert.match(relationshipMigration, /v_related\.trashed_at is not null/);
});

test("task detail is active-first and falls back to a read-only trash surface", async () => {
  const [page, taskTemplate, initiativeTemplate, banner] = await Promise.all([
    read("src/app/tasks/[id]/page.tsx"),
    read("src/features/planning-trash/templates/planning-trash-task-detail-page.tsx"),
    read("src/features/planning-trash/templates/planning-initiative-detail-page.tsx"),
    read("src/features/planning-trash/molecules/planning-trash-banner.tsx"),
  ]);

  assert.match(page, /const task = data\.tasks\.find/);
  assert.match(page, /loadPlanningTrashTaskDetail\(supabase, id, data\.profiles\)/);
  assert.match(page, /getServerPlanningAuth\(\["ceo", "founder", "deputy", "viewer"\]\)/);
  for (const template of [taskTemplate, initiativeTemplate]) {
    assert.doesNotMatch(template, /"use client"|<form|UiButton|onUpdate|onDecide|onRestore|onSyncGitHub/);
    assert.match(template, /Schreibgeschützt/);
  }
  assert.match(banner, /Begründung/);
  assert.match(banner, /Ausgeführt von/);
  assert.match(banner, /Bereinigung ab/);
  assert.match(banner, /Papierkorb-Wurzel/);
  assert.match(banner, /GitHub-Lifecycle/);
  assert.match(taskTemplate, /Initiativenstrategie/);
  assert.match(taskTemplate, /task\.strategy\?\.goal/);
  assert.match(taskTemplate, /raciIds\("accountable"\)/);
  assert.match(taskTemplate, /typeLabels\[task\.taskType\]/);
});

test("canonical trashed Initiatives retain strategy, RACI, parent, and direct children", async () => {
  const trashDetail = await loadTranspiledModule(
    "src/lib/planning-trash-detail.ts",
    {
      "@/lib/planning-profile-mappers": { mapMilestone: (row) => row, mapPackage: (row) => row },
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
      "@/lib/planning-data-row-types": { taskRowSelect: "task-columns" },
    },
  );
  const initiativeRow = {
    id: "initiative-1",
    title: "Strategic initiative",
    description: "Fallback",
    task_type: "initiative",
    parent_task_id: "epic-1",
    package_id: null,
    milestone_id: null,
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
  assert.equal(result.detail.children[0].taskType, "deliverable");
});

test("legacy initiative details redirect into the common task detail surface", async () => {
  const page = await read("src/app/initiatives/[id]/page.tsx");
  assert.match(page, /planning_item_legacy_ids/);
  assert.match(page, /source_kind", "package"/);
  assert.match(page, /redirect\(`\/tasks\//);
  assert.doesNotMatch(page, /requirePlanningContributor|requireOperationalLead|requireCEO/);
});

test("notifications keep rejected initiative details read-only and return revisions to the editable workspace", async () => {
  const { notificationTarget } = await loadTranspiledModule(
    "src/features/notifications/model/notification-target.ts",
  );
  const commands = await read("src/features/planning/hooks/use-notification-commands.ts");

  assert.equal(notificationTarget({ entityType: "task", entityId: "task/1" }).href, "/tasks/task%2F1");
  assert.equal(notificationTarget({ entityType: "initiative", entityId: "initiative/1" }).href, "/initiatives/initiative%2F1");
  assert.deepEqual(
    notificationTarget({ type: "planning_item.returned", entityType: "initiative", entityId: "initiative/1" }),
    { workspace: "backlog", href: "/backlog?backlog.level=initiative" },
  );
  assert.equal(
    notificationTarget({ type: "planning_item.rejected", entityType: "initiative", entityId: "initiative/1" }).href,
    "/initiatives/initiative%2F1",
  );
  assert.doesNotMatch(commands, /Die verknüpfte Aufgabe wurde nicht gefunden/);
  assert.match(commands, /if \(!task \|\| !taskOverlayWorkspaces\.has\(workspace\)\)/);
});
