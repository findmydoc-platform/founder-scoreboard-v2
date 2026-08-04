import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

test("planning task revisions compare active count and newest server timestamp", async () => {
  const revisions = await loadTranspiledModule("src/features/planning/model/planning-data-revision.ts");
  const revision = revisions.planningTaskRevision([
    { id: "one", updatedAt: "2026-08-03T10:00:00.000Z" },
    { id: "two", updatedAt: "2026-08-03T12:00:00.000Z" },
    { id: "three", updatedAt: "" },
  ]);

  assert.deepEqual(revision, { activeTaskCount: 3, latestUpdatedAt: "2026-08-03T12:00:00.000Z" });
  assert.equal(revisions.planningTaskRevisionsEqual(revision, { ...revision }), true);
  assert.equal(revisions.planningTaskRevisionsEqual(revision, { ...revision, activeTaskCount: 4 }), false);
  assert.equal(revisions.planningTaskRevisionsEqual(revision, { ...revision, latestUpdatedAt: "2026-08-03T12:01:00.000Z" }), false);
});

test("remote planning changes use one guarded global header notice only when revisions differ", async () => {
  const [route, hook, apiClient, header] = await Promise.all([
    readFile("src/app/api/planning-data/revision/route.ts", "utf8"),
    readFile("src/features/planning/hooks/use-planning-remote-changes.ts", "utf8"),
    readFile("src/features/planning/model/planning-api-client.ts", "utf8"),
    readFile("src/features/planning/organisms/planning-header.tsx", "utf8"),
  ]);

  assert.match(route, /requireTeamMember/);
  assert.match(route, /ACTIVE_TASKS_TABLE/);
  assert.match(route, /count: "exact"/);
  assert.match(route, /order\("updated_at", \{ ascending: false \}\)/);
  assert.match(route, /private, no-store/);
  assert.match(apiClient, /requestPlanningDataRevision/);
  assert.match(hook, /planningTaskRevisionsEqual/);
  assert.match(hook, /60_000/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /if \(!mountedRef\.current \|\| !response\.ok \|\| !body\?\.revision\) return/);
  assert.match(header, /planningRemoteChangesAvailable &&/);
  assert.match(header, /Neue Änderungen an Planungselementen sind verfügbar/);
  assert.match(header, /refreshPlanningRemoteChanges/);
  assert.equal((header.match(/Neue Änderungen an Planungselementen sind verfügbar/g) || []).length, 1);
});

test("planning focus mode requests browser fullscreen and removes nonessential app chrome", async () => {
  const [focus, shell, header, appHeader] = await Promise.all([
    readFile("src/features/planning/hooks/use-planning-focus-mode.ts", "utf8"),
    readFile("src/features/planning/templates/planning-app-shell.tsx", "utf8"),
    readFile("src/features/planning/organisms/planning-header.tsx", "utf8"),
    readFile("src/features/planning/organisms/app-header.tsx", "utf8"),
  ]);

  assert.match(focus, /document\.documentElement\.requestFullscreen\(\)/);
  assert.match(focus, /document\.exitFullscreen\(\)/);
  assert.match(focus, /fullscreenchange/);
  assert.match(shell, /!focusModeActive \? \([\s\S]*<AppSidebar/);
  assert.match(shell, /focusModeActive \? "min-w-0" : "app-sidebar-main"/);
  assert.match(header, /workspace === "planning" \|\| workspace === "backlog"/);
  assert.match(header, /Fokusmodus im Vollbild starten/);
  assert.match(header, /focusModeActive \? focusModeButton/);
  assert.match(appHeader, /compact/);
  assert.match(appHeader, /Fokusmodus/);
});
