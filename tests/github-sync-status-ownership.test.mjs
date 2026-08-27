import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const routeHelpers = await loadTranspiledModule("src/features/tasks/model/task-route-update-helpers.ts", {
  "@/features/tasks/model/task-mutation-contract": { taskAssignedToProfile: () => true },
  "@/lib/status": { normalizeStatus: (status) => status, taskStatuses: ["Offen"] },
});

test("rejects normal PATCH attempts to set GitHub sync status for every team role", () => {
  for (const role of ["ceo", "deputy", "founder", "viewer"]) {
    const result = routeHelpers.rejectClientGitHubSyncStatusUpdate({
      expectedUpdatedAt: "2026-07-13T16:00:00.000Z",
      githubIssueSyncStatus: role === "viewer" ? null : "synced",
    });

    assert.deepEqual(result, {
      ok: false,
      error: "Der GitHub-Sync-Status wird ausschließlich vom Server verwaltet.",
      status: 403,
    }, role);
  }

  assert.deepEqual(routeHelpers.rejectClientGitHubSyncStatusUpdate({ status: "In Arbeit" }), { ok: true });
});

test("normal task update contract omits sync status and route rejects it before task mutation", async () => {
  const [contract, taskRoute] = await Promise.all([
    readFile("src/features/tasks/model/task-mutation-contract.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-browser-task-update.ts", "utf8"),
  ]);
  const payloadType = contract.slice(
    contract.indexOf("export type TaskUpdatePayload"),
    contract.indexOf("export type CurrentTaskForActivity"),
  );
  const requestPayload = contract.slice(
    contract.indexOf("export function taskUpdateRequestPayload"),
    contract.indexOf("function formatChange"),
  );
  const guardIndex = taskRoute.indexOf("rejectClientGitHubSyncStatusUpdate(rawPayload)");
  const activeItemIndex = taskRoute.indexOf("requireActivePlanningItem(supabase");

  assert.doesNotMatch(payloadType, /githubIssueSyncStatus/);
  assert.doesNotMatch(requestPayload, /githubIssueSyncStatus/);
  assert.ok(guardIndex > -1);
  assert.ok(activeItemIndex > guardIndex);
  assert.doesNotMatch(taskRoute, /applyTaskSyncStatusUpdate/);
});
