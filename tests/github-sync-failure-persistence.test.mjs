import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const failurePersistence = await loadTranspiledModule("src/lib/github-sync-failure-persistence.ts");
const syncQueue = await loadTranspiledModule("src/features/tasks/model/github-sync-queue.ts", {
  "@/lib/platform": { hasGitHubIssue: () => true },
});

function rpcClient(results) {
  const calls = [];
  return {
    calls,
    client: {
      rpc: async (name, params) => {
        calls.push({ name, params });
        const result = results.shift();
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

const failureParams = {
  taskId: "task-1",
  errorMessage: "GitHub unavailable",
  activityMessage: "GitHub sync failed",
};

test("persists the failure state on the first attempt", async () => {
  const { client, calls } = rpcClient([{ data: { id: "task-1" }, error: null }]);
  const delays = [];

  const result = await failurePersistence.persistGitHubSyncFailure(client, failureParams, {
    retryDelaysMs: [10, 20],
    sleep: async (delay) => delays.push(delay),
  });

  assert.deepEqual(result, { ok: true, data: { id: "task-1" }, attempts: 1 });
  assert.equal(calls.length, 1);
  assert.deepEqual(delays, []);
  assert.equal(calls[0].name, "fail_github_issue_sync_transaction");
});

test("retries bounded failure persistence and succeeds on the third attempt", async () => {
  const { client, calls } = rpcClient([
    { data: null, error: { message: "first failure" } },
    new Error("second failure"),
    { data: { id: "task-1", github_issue_sync_status: "failed" }, error: null },
  ]);
  const delays = [];

  const result = await failurePersistence.persistGitHubSyncFailure(client, failureParams, {
    retryDelaysMs: [10, 20],
    sleep: async (delay) => delays.push(delay),
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("reports an explicit persistence failure after all attempts fail", async () => {
  const { client, calls } = rpcClient([
    { data: null, error: { message: "first failure" } },
    { data: null, error: { message: "second failure" } },
    { data: null, error: { message: "final failure" } },
  ]);

  const result = await failurePersistence.persistGitHubSyncFailure(client, failureParams, {
    retryDelaysMs: [0, 0],
    sleep: async () => {},
  });

  assert.deepEqual(result, { ok: false, error: "final failure", attempts: 3 });
  assert.equal(calls.length, 3);
});

test("treats pending syncs as retryable after the ten-minute lock expires", () => {
  const now = Date.parse("2026-07-13T15:30:00.000Z");
  const expired = { githubIssueSyncStatus: "pending", updatedAt: "2026-07-13T15:20:00.000Z" };
  const active = { githubIssueSyncStatus: "pending", updatedAt: "2026-07-13T15:20:00.001Z" };

  assert.equal(syncQueue.isExpiredGitHubSyncPending(expired, now), true);
  assert.equal(syncQueue.isExpiredGitHubSyncPending(active, now), false);
  assert.equal(syncQueue.isExpiredGitHubSyncPending({ githubIssueSyncStatus: "pending", updatedAt: "" }, now), false);
  assert.equal(syncQueue.isExpiredGitHubSyncPending({ ...expired, githubIssueSyncStatus: "failed" }, now), false);
});

test("uses the client sync start instead of an old task revision for optimistic pending state", () => {
  const now = Date.parse("2026-07-13T15:30:00.000Z");
  const optimisticPending = {
    githubIssueSyncStatus: "pending",
    updatedAt: "2026-07-12T15:30:00.000Z",
    githubIssueSyncPendingSince: "2026-07-13T15:29:59.000Z",
  };

  assert.equal(syncQueue.isExpiredGitHubSyncPending(optimisticPending, now), false);
  assert.equal(syncQueue.isExpiredGitHubSyncPending({
    ...optimisticPending,
    githubIssueSyncPendingSince: "2026-07-13T15:20:00.000Z",
  }, now), true);
});

test("operational sync surfaces stop presenting expired pending syncs as running", async () => {
  const [card, table, queue, headerActions] = await Promise.all([
    readFile("src/features/tasks/molecules/task-card.tsx", "utf8"),
    readFile("src/features/tasks/organisms/task-table-view.tsx", "utf8"),
    readFile("src/features/tasks/organisms/task-github-sync-queue.tsx", "utf8"),
    readFile("src/features/tasks/molecules/task-detail-header-actions.tsx", "utf8"),
  ]);

  for (const surface of [queue, headerActions]) {
    assert.match(surface, /isExpiredGitHubSyncPending/);
  }
  for (const planningSurface of [card, table]) {
    assert.doesNotMatch(planningSurface, /isExpiredGitHubSyncPending|githubIssueSyncStatus === "pending"|Sync läuft/);
  }
});

test("route and clients preserve the explicit retryable persistence error contract", async () => {
  const [contract, commandHook, detailHook] = await Promise.all([
    readFile("src/lib/github-sync/contract.ts", "utf8"),
    readFile("src/features/tasks/hooks/use-task-github-sync-command.ts", "utf8"),
    readFile("src/features/tasks/hooks/use-task-detail-workflow.ts", "utf8"),
  ]);

  assert.match(contract, /github_sync_state_persist_failed: 503/);
  assert.match(contract, /"github_sync_state_persist_failed"/);
  assert.match(commandHook, /classifyTaskGitHubSyncResponse/);
  assert.match(commandHook, /githubIssueSyncPendingSince: syncStartedAt/);
  assert.match(detailHook, /classifyTaskGitHubSyncResponse/);
  assert.match(detailHook, /githubIssueSyncPendingSince: syncStartedAt/);
});
