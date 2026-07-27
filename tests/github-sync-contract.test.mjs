import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule("src/lib/github-sync/contract.ts");

const errorCases = [
  ["github_sync_unauthenticated", 401, false],
  ["github_sync_forbidden", 403, false],
  ["github_sync_not_found", 404, false],
  ["github_sync_inactive", 409, false],
  ["github_sync_invalid_target", 409, false],
  ["github_sync_not_approved", 409, false],
  ["github_sync_creation_required", 409, false],
  ["github_sync_locked", 409, true],
  ["github_sync_stale", 409, true],
  ["github_sync_failed", 502, true],
  ["github_sync_unavailable", 503, true],
  ["github_sync_state_persist_failed", 503, true],
];

test("GitHub sync contract maps every error code to its status and retryability", () => {
  for (const [code, status, retryable] of errorCases) {
    const result = contract.taskGitHubSyncFailure(code, "message");
    assert.equal(result.retryable, retryable, code);
    assert.equal(contract.taskGitHubSyncHttpStatus(result), status, code);
  }
});

test("GitHub sync client classifier handles success, lock, retryable, and terminal results", () => {
  const success = {
    ok: true,
    code: "github_sync_succeeded",
    issue: {
      repository: "findmydoc-platform/management",
      number: 42,
      url: "https://github.com/findmydoc-platform/management/issues/42",
      recovered: false,
      recreated: false,
    },
    task: { githubIssueSyncStatus: "synced" },
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
  assert.equal(contract.classifyTaskGitHubSyncResponse(200, success).kind, "success");
  assert.equal(
    contract.classifyTaskGitHubSyncResponse(
      409,
      contract.taskGitHubSyncFailure("github_sync_locked", "locked"),
    ).kind,
    "locked",
  );
  assert.equal(
    contract.classifyTaskGitHubSyncResponse(
      503,
      contract.taskGitHubSyncFailure("github_sync_unavailable", "unavailable"),
    ).kind,
    "retryable",
  );
  assert.equal(
    contract.classifyTaskGitHubSyncResponse(
      503,
      contract.taskGitHubSyncFailure("github_sync_state_persist_failed", "persistence"),
    ).taskStatus,
    "not_synced",
  );
  assert.equal(
    contract.classifyTaskGitHubSyncResponse(
      403,
      contract.taskGitHubSyncFailure("github_sync_forbidden", "forbidden"),
    ).kind,
    "failure",
  );
});
