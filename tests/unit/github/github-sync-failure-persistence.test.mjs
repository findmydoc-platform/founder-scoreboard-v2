import { test } from "vitest";
import assert from "node:assert/strict";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const failurePersistence = await importTestModule("src/lib/github-sync-failure-persistence.ts");
const syncQueue = await importTestModule("src/features/tasks/model/github-sync-queue.ts", {
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
