import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule("src/lib/github-sync/contract.ts");
const issueReferences = await loadTranspiledModule("src/lib/github-issue-reference.ts");

function baseTask(overrides = {}) {
  return {
    id: "task-1",
    title: "Project task",
    taskType: "deliverable",
    status: "Offen",
    priority: "P2",
    approvalStatus: "approved",
    parentApprovalStatus: null,
    parentTaskId: "",
    githubRepo: "findmydoc-platform/management",
    githubIssueNumber: 42,
    githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/42",
    issueNumber: "42",
    issueUrl: "https://github.com/findmydoc-platform/management/issues/42",
    githubIssueSyncStatus: "not_synced",
    githubIssueSyncError: "",
    githubIssueLastSyncedAt: "",
    linkedPullRequests: [],
    sprintId: "",
    updatedAt: "revision-1",
    ...overrides,
  };
}

function taskQuery(tasks, loadIndexRef) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    single: async () => {
      const task = tasks[Math.min(loadIndexRef.value, tasks.length - 1)];
      loadIndexRef.value += 1;
      return { data: { task, assignee: null, owner: null }, error: null };
    },
    maybeSingle: async () => ({
      data: {
        approval_status: tasks[Math.max(0, loadIndexRef.value - 1)].parentApprovalStatus,
      },
      error: null,
    }),
  };
  return builder;
}

async function projectionFixture(options = {}) {
  const calls = [];
  const tasks = options.tasks || [baseTask(), baseTask()];
  const loadIndexRef = { value: 0 };
  const rpcResults = {
    try_acquire_github_issue_sync_lock: { data: options.locked === false ? null : "lock-token", error: options.lockError || null },
    begin_github_issue_sync_transaction_v2: options.begin || { data: { updated_at: "pending-revision" }, error: null },
    finalize_github_issue_sync_with_pull_requests_v1: options.finalize || { data: { updated_at: "final-revision" }, error: null },
    release_github_issue_sync_lock: options.release || { data: true, error: null },
  };
  const supabase = {
    from(table) {
      if (table === "active_tasks") return taskQuery(tasks, loadIndexRef);
      if (table === "profiles") {
        const builder = {
          select: () => builder,
          in: async () => ({ data: [], error: null }),
        };
        return builder;
      }
      throw new Error(`Unexpected table: ${table}`);
    },
    async rpc(name, params) {
      if (name === "try_acquire_github_issue_sync_lock") calls.push("lock");
      if (name === "begin_github_issue_sync_transaction_v2") calls.push("begin");
      if (name === "finalize_github_issue_sync_with_pull_requests_v1") calls.push("finalize");
      if (name === "release_github_issue_sync_lock") calls.push("release");
      if (name === "release_github_issue_sync_lock" && options.releaseThrows) {
        throw options.releaseThrows;
      }
      const result = rpcResults[name];
      if (!result) throw new Error(`Unexpected RPC: ${name} ${JSON.stringify(params)}`);
      return result;
    },
  };
  let activeCheck = 0;
  let failurePersistenceCalls = 0;
  const taskProjectionModule = await loadTranspiledModule("src/lib/github-sync/task-projection.ts", {
    "../github-comment-delivery": {
      deliverPendingGitHubComments: async () => {
        calls.push("comments");
        if (options.commentError) throw options.commentError;
        return {
          delivered: 1,
          reconciled: 0,
          created: 1,
          waitingForAuthorConnection: 0,
          waitingForIssue: 0,
          retryScheduled: 0,
          failed: 0,
        };
      },
    },
    "../github": {
      connectGitHubSubIssue: async () => {
        calls.push("subIssue");
        if (options.relationshipError) throw options.relationshipError;
      },
      listGitHubIssueLinkedPullRequests: async () => {
        calls.push("pullRequests");
        if (options.pullRequestError) throw options.pullRequestError;
        return [{ title: "PR", repository: "repo", number: 1, url: "url", status: "open" }];
      },
    },
    "../github-sync-failure-persistence": {
      githubSyncStatePersistFailedMessage: "failure state unavailable",
      persistGitHubSyncFailure: async () => {
        calls.push("persistFailure");
        failurePersistenceCalls += 1;
        return options.failurePersistence || {
          ok: true,
          data: { updated_at: "failed-revision" },
        };
      },
    },
    "../github-issue-reference": issueReferences,
    "../github-repositories": {
      resolveTaskGitHubRepository: () => (
        options.invalidTarget
          ? { ok: false, error: "invalid repository" }
          : { ok: true, repository: "findmydoc-platform/management" }
      ),
    },
    "../github-sub-issue-parent": {
      preflightGitHubSubIssueParent: async () => {
        calls.push("parentPreflight");
        if (options.parentPreflightError) throw options.parentPreflightError;
        return { repository: "findmydoc-platform/management", issueNumber: 41 };
      },
    },
    "../planning-task-mappers": {
      mapTaskRow: (row) => row.task,
    },
    "../planning-read-model": {
      ACTIVE_TASKS_TABLE: "active_tasks",
    },
    "../planning-trash-mutation-guard": {
      requireActivePlanningItem: async () => {
        calls.push(activeCheck === 0 ? "activeInitial" : "activeReload");
        const result = options.activeResults?.[activeCheck] || { ok: true };
        activeCheck += 1;
        return result;
      },
    },
    "./contract": contract,
    "./dependency-projection": {
      projectTaskGitHubDependencies: async () => {
        calls.push("dependencies");
        if (options.relationshipError) throw options.relationshipError;
        return { added: 0, removed: 0 };
      },
    },
    "./issue-projection": {
      projectTaskGitHubIssue: async () => {
        calls.push("issue");
        if (options.issueError) throw options.issueError;
        return {
          repository: "findmydoc-platform/management",
          number: 42,
          url: "https://github.com/findmydoc-platform/management/issues/42",
          warnings: [],
          recovered: false,
          recreated: false,
        };
      },
    },
    "./project-projection": {
      projectTaskToFounderOpsGitHubProject: async () => {
        calls.push("project");
        if (options.projectError) throw options.projectError;
        return { changes: [], warnings: options.projectWarnings || [] };
      },
    },
  });
  return {
    calls,
    failurePersistenceCalls: () => failurePersistenceCalls,
    project: (createIfMissing = false) => taskProjectionModule.projectTaskToGitHub({
      supabase,
      installationToken: "installation-token",
      taskId: "task-1",
      actorProfileId: "profile-1",
      createIfMissing,
    }),
  };
}

test("task projection executes hard projections before warning-only projections and finalizes once", async () => {
  const fixture = await projectionFixture();
  const result = await fixture.project();

  assert.equal(result.ok, true);
  assert.equal(result.code, "github_sync_succeeded");
  assert.deepEqual(fixture.calls, [
    "activeInitial",
    "lock",
    "activeReload",
    "begin",
    "issue",
    "dependencies",
    "project",
    "pullRequests",
    "finalize",
    "comments",
    "release",
  ]);
});

test("task projection reports a held lock as retryable without starting a transaction", async () => {
  const fixture = await projectionFixture({ locked: false });
  const result = await fixture.project();
  assert.deepEqual(
    { code: result.code, retryable: result.retryable },
    { code: "github_sync_locked", retryable: true },
  );
  assert.deepEqual(fixture.calls, ["activeInitial", "lock"]);
});

test("task projection does not treat a lookalike GitHub hostname as an existing issue", async () => {
  const task = baseTask({
    githubIssueNumber: null,
    githubIssueUrl: "",
    issueNumber: "",
    issueUrl: "https://github.com.attacker.example/findmydoc-platform/management/issues/42",
  });
  const fixture = await projectionFixture({ tasks: [task, task] });
  const result = await fixture.project();
  assert.equal(result.code, "github_sync_invalid_target");
  assert.deepEqual(fixture.calls, ["activeInitial"]);
});

test("task projection requires explicit creation when no local issue reference exists", async () => {
  const task = baseTask({
    githubIssueNumber: null,
    githubIssueUrl: "",
    issueNumber: "",
    issueUrl: "",
  });
  const fixture = await projectionFixture({ tasks: [task, task] });
  const result = await fixture.project();
  assert.equal(result.code, "github_sync_creation_required");
  assert.deepEqual(fixture.calls, ["activeInitial"]);
});

test("task projection rejects contradictory local references before locking", async () => {
  const task = baseTask({
    githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/43",
  });
  const fixture = await projectionFixture({ tasks: [task, task] });
  const result = await fixture.project();
  assert.equal(result.code, "github_sync_invalid_target");
  assert.equal(result.retryable, false);
  assert.deepEqual(fixture.calls, ["activeInitial"]);
});

test("task projection rejects contradictory references found during the locked reload", async () => {
  const fixture = await projectionFixture({
    tasks: [
      baseTask(),
      baseTask({
        githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/43",
      }),
    ],
  });
  const result = await fixture.project();
  assert.equal(result.code, "github_sync_invalid_target");
  assert.deepEqual(fixture.calls, ["activeInitial", "lock", "activeReload", "release"]);
});

test("task projection revalidates approval under the lock and always releases it", async () => {
  const fixture = await projectionFixture({
    tasks: [baseTask(), baseTask({ approvalStatus: "proposed" })],
  });
  const result = await fixture.project();
  assert.equal(result.code, "github_sync_not_approved");
  assert.deepEqual(fixture.calls, ["activeInitial", "lock", "activeReload", "release"]);
});

test("task projection treats a changed resource identity after reload as stale", async () => {
  const fixture = await projectionFixture({
    tasks: [baseTask(), baseTask({
      githubIssueNumber: 43,
      githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/43",
      issueNumber: "43",
      issueUrl: "https://github.com/findmydoc-platform/management/issues/43",
    })],
  });
  const result = await fixture.project();
  assert.equal(result.code, "github_sync_stale");
  assert.equal(result.retryable, true);
  assert.deepEqual(fixture.calls, ["activeInitial", "lock", "activeReload", "release"]);
});

test("task projection revalidates Sub-Issue parent approval before parent preflight", async () => {
  const fixture = await projectionFixture({
    tasks: [
      baseTask({
        taskType: "sub_issue",
        parentTaskId: "parent-1",
        parentApprovalStatus: "approved",
      }),
      baseTask({
        taskType: "sub_issue",
        parentTaskId: "parent-1",
        parentApprovalStatus: "proposed",
      }),
    ],
  });
  const result = await fixture.project();
  assert.equal(result.code, "github_sync_not_approved");
  assert.equal(fixture.calls.includes("parentPreflight"), false);
  assert.equal(fixture.calls.at(-1), "release");
});

for (const [name, options] of [
  ["begin", { begin: { data: null, error: { code: "P0001", message: "stale" } } }],
  ["finalize", { finalize: { data: null, error: { code: "P0001", message: "stale" } } }],
]) {
  test(`${name} CAS conflict stays retryable and is not persisted as failed`, async () => {
    const fixture = await projectionFixture(options);
    const result = await fixture.project();
    assert.equal(result.code, "github_sync_stale");
    assert.equal(result.retryable, true);
    assert.equal(fixture.failurePersistenceCalls(), 0);
    assert.equal(fixture.calls.at(-1), "release");
  });
}

test("hard projection errors persist a failed state and release the lock", async () => {
  const fixture = await projectionFixture({
    relationshipError: new Error("dependency write failed"),
  });
  const result = await fixture.project();
  assert.equal(result.code, "github_sync_failed");
  assert.equal(result.task.githubIssueSyncStatus, "failed");
  assert.deepEqual(fixture.calls.slice(-2), ["persistFailure", "release"]);
});

test("warning-only Project, Pull Request, and comment failures keep the core sync successful", async () => {
  const fixture = await projectionFixture({
    projectWarnings: ["field warning"],
    pullRequestError: new Error("pull request read failed"),
    commentError: new Error("comment delivery failed"),
  });
  const result = await fixture.project();
  assert.equal(result.ok, true);
  assert.equal(result.warnings.some((warning) => warning.includes("field warning")), true);
  assert.equal(result.warnings.some((warning) => warning.includes("pull request read failed")), true);
  assert.equal(result.commentDelivery.failed, 1);
  assert.equal(fixture.failurePersistenceCalls(), 0);
});

test("failed error-state persistence returns the explicit unavailable state", async () => {
  const fixture = await projectionFixture({
    issueError: new Error("issue failed"),
    failurePersistence: { ok: false, error: "database unavailable" },
  });
  const result = await fixture.project();
  assert.equal(result.code, "github_sync_state_persist_failed");
  assert.equal(result.retryable, true);
  assert.equal(fixture.calls.at(-1), "release");
});

for (const [name, options] of [
  ["returned RPC error", { release: { data: null, error: { message: "release unavailable" } } }],
  ["unconfirmed RPC result", { release: { data: false, error: null } }],
  ["thrown RPC error", { releaseThrows: new Error("release network failed") }],
]) {
  test(`lock release ${name} overrides success with a retryable unavailable result`, async () => {
    const fixture = await projectionFixture(options);
    const result = await fixture.project();
    assert.equal(result.code, "github_sync_unavailable");
    assert.equal(result.retryable, true);
    assert.equal(result.task.githubIssueSyncStatus, "synced");
    assert.match(result.error, /freigegeben|release network failed/);
    assert.equal(fixture.calls.at(-1), "release");
  });
}
