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
    "src/app/api/tasks/[id]/sync-github/route.ts",
    "src/app/api/tasks/[id]/comments/route.ts",
    "src/app/api/tasks/[id]/github-comments/route.ts",
    "src/app/api/tasks/[id]/blockers/route.ts",
    "src/app/api/tasks/[id]/relationships/route.ts",
    "src/app/api/tasks/[id]/attachments/route.ts",
    "src/app/api/tasks/[id]/review/route.ts",
    "src/app/api/tasks/[id]/review/reopen/route.ts",
    "src/app/api/initiatives/[id]/route.ts",
    "src/app/api/initiatives/[id]/approval/route.ts",
  ];

  for (const route of guardedRoutes) {
    const source = await read(route);
    assert.match(source, /requireActivePlanningItem/, `${route} must fail closed for trash mutations`);
  }
});

test("reparenting and relationship targets use active read models", async () => {
  const [taskRoute, relationshipRoute] = await Promise.all([
    read("src/app/api/tasks/[id]/route.ts"),
    read("src/app/api/tasks/[id]/relationships/route.ts"),
  ]);

  assert.match(taskRoute, /\.from\(ACTIVE_TASKS_TABLE\)[^]*\.select\("id,task_type,approval_status"\)/);
  assert.match(relationshipRoute, /ACTIVE_TASKS_TABLE/);
  assert.match(relationshipRoute, /requireActivePlanningItem\(supabase, "tasks", relatedTaskId\)/);
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
});

test("initiative details require a team session and expose no mutation surface", async () => {
  const page = await read("src/app/initiatives/[id]/page.tsx");
  assert.match(page, /getServerPlanningAuth\(\["ceo", "founder", "deputy", "viewer"\]\)/);
  assert.match(page, /loadPlanningInitiativeDetail/);
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
    { workspace: "projects", href: "/projects" },
  );
  assert.equal(
    notificationTarget({ type: "planning_item.rejected", entityType: "initiative", entityId: "initiative/1" }).href,
    "/initiatives/initiative%2F1",
  );
  assert.doesNotMatch(commands, /Die verknüpfte Aufgabe wurde nicht gefunden/);
  assert.match(commands, /if \(!task \|\| !taskOverlayWorkspaces\.has\(workspace\)\)/);
});
