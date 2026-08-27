import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

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
