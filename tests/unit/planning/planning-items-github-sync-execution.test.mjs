import assert from "node:assert/strict";

import { test } from "vitest";

import { importTestModule } from "../../helpers/vitest-module.mjs";

const contract = await importTestModule(
  "src/features/planning-items/model/planning-items-contract.ts",
);

const githubContract = await importTestModule(
  "src/lib/github-sync/contract.ts",
);

let installationTokenError = null;

let activeProjections = 0;

let maximumActiveProjections = 0;

const projectionOrder = [];

const persistedFailures = [];

const preflightFailures = new Map();

const syncModel = await importTestModule(
  "src/features/planning-items/model/planning-items-github-sync.ts",
  {
    "server-only": {},
    "@/lib/github-app": {
      getGitHubAppInstallationToken: async () => {
        if (installationTokenError) throw installationTokenError;
        return "installation-token";
      },
    },
    "@/lib/github-sync-failure-persistence": {
      persistGitHubSyncFailure: async (_client, params) => {
        persistedFailures.push(params);
        return { ok: true, data: {} };
      },
    },
    "@/lib/github-sync/contract": githubContract,
    "@/lib/github-sync/task-projection": {
      projectTaskToGitHub: async (input) => {
        if (input.preflightOnly) {
          const failure = preflightFailures.get(input.taskId);
          if (failure) return failure;
          return {
            ok: true,
            code: "github_sync_ready",
            target: {
              repository: "findmydoc-platform/management",
              issueNumber: 42,
            },
          };
        }
        activeProjections += 1;
        maximumActiveProjections = Math.max(maximumActiveProjections, activeProjections);
        projectionOrder.push(input.taskId);
        await new Promise((resolve) => setImmediate(resolve));
        activeProjections -= 1;
        return {
          ok: true,
          code: "github_sync_succeeded",
          issue: {
            repository: "findmydoc-platform/management",
            number: 42,
            url: "https://github.com/findmydoc-platform/management/issues/42",
            recovered: false,
            recreated: false,
          },
          task: {},
          warnings: [],
          commentDelivery: {
            delivered: 0,
            reconciled: 0,
            created: 0,
            waitingForAuthorConnection: 0,
            waitingForIssue: 0,
            retryScheduled: 0,
            failed: 0,
          },
          notices: [],
        };
      },
    },
    "@/lib/planning-read-model": {
      ACTIVE_PACKAGES_TABLE: "active_packages",
      ACTIVE_TASKS_TABLE: "active_tasks",
    },
    "@/features/planning-items/model/planning-items-contract": contract,
  },
);

test("planning-item GitHub execution keeps mutations serial and preserves item order", async () => {
  installationTokenError = null;
  preflightFailures.clear();
  activeProjections = 0;
  maximumActiveProjections = 0;
  projectionOrder.length = 0;
  const targets = ["task-1", "task-2", "task-3"].map((itemId) => ({
    itemId,
    itemType: "sub_issue",
    command: { createIfMissing: true },
  }));

  const results = await syncModel.executePlanningItemGitHubSyncs({
    supabase: {},
    actorProfileId: "profile-1",
    targets,
  });

  assert.equal(maximumActiveProjections, 1);
  assert.deepEqual(projectionOrder, ["task-1", "task-2", "task-3"]);
  assert.equal(results.get("task-1").status, "synced");
  assert.equal(results.get("task-3").status, "synced");
});

test("installation-token failure is persisted for every requested task", async () => {
  installationTokenError = new Error("GitHub unavailable");
  preflightFailures.clear();
  persistedFailures.length = 0;
  const results = await syncModel.executePlanningItemGitHubSyncs({
    supabase: {},
    actorProfileId: "profile-1",
    targets: [
      {
        itemId: "task-1",
        itemType: "deliverable",
        command: { createIfMissing: false },
      },
      {
        itemId: "task-2",
        itemType: "sub_issue",
        command: { createIfMissing: true },
      },
    ],
  });

  assert.equal(persistedFailures.length, 2);
  assert.equal(results.get("task-1").status, "failed");
  assert.equal(results.get("task-1").code, "github_sync_unavailable");
  assert.equal(results.get("task-2").retryable, true);
});

test("wait execution reports local ineligibility before installation-token failures", async () => {
  installationTokenError = new Error("GitHub unavailable");
  preflightFailures.clear();
  preflightFailures.set("task-proposed", githubContract.taskGitHubSyncFailure(
    "github_sync_not_approved",
    "Only approved Deliverables can sync.",
  ));
  persistedFailures.length = 0;

  const results = await syncModel.executePlanningItemGitHubSyncs({
    supabase: {},
    actorProfileId: "profile-1",
    targets: [{
      itemId: "task-proposed",
      itemType: "deliverable",
      command: { createIfMissing: true },
    }],
  });

  assert.equal(results.get("task-proposed").status, "notEligible");
  assert.equal(results.get("task-proposed").code, "github_sync_not_approved");
  assert.equal(persistedFailures.length, 0);
});
