import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const contract = await importTestModule("src/lib/github-sync/contract.ts");

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

test("GitHub sync command requires an explicit boolean creation decision", () => {
  assert.deepEqual(
    contract.parseTaskGitHubSyncCommand({ createIfMissing: true }),
    { createIfMissing: true },
  );
  assert.deepEqual(
    contract.parseTaskGitHubSyncCommand({ createIfMissing: false }),
    { createIfMissing: false },
  );
  for (const invalid of [
    null,
    {},
    { createIfMissing: "false" },
    { createIfMissing: 0 },
    { createIfMissing: null },
  ]) {
    assert.equal(contract.parseTaskGitHubSyncCommand(invalid), null);
  }
});

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

test("GitHub sync client classifier handles every contract code", () => {
  assert.equal(contract.classifyTaskGitHubSyncResponse(200, success).kind, "success");
  const expected = new Map([
    ["github_sync_unauthenticated", ["failure", "failed"]],
    ["github_sync_forbidden", ["failure", "failed"]],
    ["github_sync_not_found", ["failure", "failed"]],
    ["github_sync_inactive", ["failure", "failed"]],
    ["github_sync_invalid_target", ["failure", "failed"]],
    ["github_sync_not_approved", ["failure", "failed"]],
    ["github_sync_creation_required", ["failure", "failed"]],
    ["github_sync_locked", ["locked", "pending"]],
    ["github_sync_stale", ["retryable", "not_synced"]],
    ["github_sync_failed", ["retryable", "failed"]],
    ["github_sync_unavailable", ["retryable", "failed"]],
    ["github_sync_state_persist_failed", ["retryable", "not_synced"]],
  ]);
  for (const [code, status] of errorCases) {
    const classification = contract.classifyTaskGitHubSyncResponse(
      status,
      contract.taskGitHubSyncFailure(code, code),
    );
    assert.deepEqual(
      [classification.kind, classification.taskStatus],
      expected.get(code),
      code,
    );
  }
});

test("retryable cleanup failures preserve an already finalized synced task patch", () => {
  const classification = contract.classifyTaskGitHubSyncResponse(
    503,
    contract.taskGitHubSyncFailure(
      "github_sync_unavailable",
      "lock release failed",
      { githubIssueSyncStatus: "synced", updatedAt: "revision-2" },
    ),
  );
  assert.equal(classification.kind, "retryable");
  assert.equal(classification.taskStatus, "synced");
});
