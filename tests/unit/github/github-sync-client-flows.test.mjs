import assert from "node:assert/strict";
import { test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const contract = await importTestModule("src/lib/github-sync/contract.ts");

function task(overrides = {}) {
  return {
    id: "task-1",
    title: "Client flow task",
    taskType: "deliverable",
    status: "Offen",
    approvalStatus: "approved",
    approvalRevision: 1,
    githubRepo: "findmydoc-platform/management",
    githubIssueNumber: 42,
    githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/42",
    issueUrl: "https://github.com/findmydoc-platform/management/issues/42",
    githubIssueSyncStatus: "not_synced",
    githubIssueSyncError: "",
    githubIssueSyncPendingSince: "",
    githubIssueLastSyncedAt: "",
    parentTaskId: "",
    updatedAt: "revision-1",
    ...overrides,
  };
}

function successResult() {
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
    task: {
      githubRepo: "findmydoc-platform/management",
      githubIssueNumber: 42,
      githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/42",
      githubIssueSyncStatus: "synced",
      githubIssueSyncError: "",
      updatedAt: "revision-2",
    },
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
}

function responseFor(result) {
  return {
    response: {
      ok: result.ok,
      status: contract.taskGitHubSyncHttpStatus(result),
    },
    body: result,
  };
}

let commandSyncResponse = responseFor(successResult());
const commandTransitions = [];
const { useTaskGitHubSyncCommand } = await importTestModule(
  "src/features/tasks/hooks/use-task-github-sync-command.ts",
  {
    react: {
      useState: (initial) => [
        typeof initial === "function" ? initial() : initial,
        () => undefined,
      ],
    },
    "@/features/tasks/model/github-sync-queue": {
      githubBulkSyncTasks: ({ tasks }) => tasks,
    },
    "@/features/tasks/model/task-api-client": {
      syncTaskToGitHubRequest: async () => commandSyncResponse,
    },
    "@/lib/github-sync/contract": contract,
    "@/lib/platform": {
      hasGitHubIssue: () => true,
    },
  },
);

function useCommandFixture(initialTasks = [task()]) {
  const owner=createPlanningState({userId:"sync-client-fixture",initialData:{...emptyPlanningShellState,tasks:initialTasks},adapter:{readWorkspace:async()=>null,saveTask:async()=>({task:{}}),syncTaskGitHub:async()=>contract.classifyTaskGitHubSyncResponse(commandSyncResponse.response.status,commandSyncResponse.body)}});
  const errors = [];
  commandTransitions.length = 0;
  const command = useTaskGitHubSyncCommand({
    planningState:owner.planning,
    setSaveError: (value) => errors.push(value),
    source: "supabase",
    startTransition: (callback) => {
      const transition = Promise.resolve().then(callback);
      commandTransitions.push(transition);
    },
  });
  return {
    command,
    errors,
    getTask: () => owner.planning.board().tasks[0],
    wait: async () => Promise.all(commandTransitions),
  };
}

for (const [name, result, expectedStatus] of [
  ["success", successResult(), "synced"],
  [
    "lock",
    contract.taskGitHubSyncFailure("github_sync_locked", "locked", {
      githubIssueSyncStatus: "pending",
    }),
    "pending",
  ],
  ["stale", contract.taskGitHubSyncFailure("github_sync_stale", "stale"), "not_synced"],
  [
    "terminal failure",
    contract.taskGitHubSyncFailure("github_sync_invalid_target", "invalid"),
    "failed",
  ],
  [
    "cleanup failure after finalize",
    contract.taskGitHubSyncFailure("github_sync_unavailable", "release failed", {
      githubIssueSyncStatus: "synced",
      updatedAt: "revision-2",
    }),
    "synced",
  ],
]) {
  test(`single sync applies the ${name} transition`, async () => {
    commandSyncResponse = responseFor(result);
    const fixture = useCommandFixture();
    fixture.command.syncTaskToGitHub(fixture.getTask());
    await fixture.wait();
    assert.equal(fixture.getTask().githubIssueSyncStatus, expectedStatus);
    assert.equal(fixture.getTask().githubIssueSyncPendingSince === "", expectedStatus !== "pending");
  });

  test(`bulk sync applies the ${name} transition`, async () => {
    commandSyncResponse = responseFor(result);
    const fixture = useCommandFixture();
    fixture.command.syncLinkedGitHubTasks();
    await fixture.wait();
    assert.equal(fixture.getTask().githubIssueSyncStatus, expectedStatus);
    assert.equal(fixture.getTask().githubIssueSyncPendingSince === "", expectedStatus !== "pending");
  });
}

let createSyncResponse = responseFor(successResult());
const createTransitions = [];
const createdTask = task({
  githubIssueNumber: null,
  githubIssueUrl: "",
  issueUrl: "",
});
const { useTaskCreateCommand } = await importTestModule(
  "src/features/tasks/hooks/use-task-create-command.ts",
  {
    "@/features/planning/model/planning-app-model": {
      profileForAssigneeValue: () => null,
    },
    "@/features/tasks/model/task-api-client": {
      createTaskRequest: async () => ({
        response: { ok: true, status: 200 },
        body: { task: createdTask, relation: null, relatedTask: null },
      }),
      syncTaskToGitHubRequest: async () => createSyncResponse,
    },
    "@/lib/github-sync/contract": contract,
    "@/features/tasks/model/task-creation-draft": {
      resolveTaskCreationHierarchy: (draft) => draft,
      taskCreationRequestPayload: (draft) => draft,
    },
  },
);

function useCreateFixture() {
  commandSyncResponse = createSyncResponse;
  const syncFixture = useCommandFixture([createdTask]);
  const owner = createPlanningState({ userId: "create-fixture", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }),
    readWorkspace: async () => null,
    createTask: async () => ({ task: createdTask }),
  } });
  const errors = syncFixture.errors;
  createTransitions.length = 0;
  const command = useTaskCreateCommand({
    planningState: owner.planning,
    syncTaskToGitHub: syncFixture.command.syncTaskToGitHub,
    currentProfile: null,
    data: emptyPlanningShellState,
    setSaveError: (value) => errors.push(value),
    setTaskDialogDefaults: () => undefined,
    startTransition: (callback) => {
      const transition = Promise.resolve().then(callback);
      createTransitions.push(transition);
    },
  });
  return {
    command, errors,
    getTask: () => syncFixture.getTask(),
    getCreated: () => owner.planning.board().tasks[0],
    wait: async () => { await Promise.all(createTransitions); await syncFixture.wait(); },
  };
}

for (const [name, result, expectedStatus, expectsError] of [
  ["success", successResult(), "synced", false],
  [
    "lock",
    contract.taskGitHubSyncFailure("github_sync_locked", "locked", {
      githubIssueSyncStatus: "pending",
    }),
    "pending",
    true,
  ],
  ["stale", contract.taskGitHubSyncFailure("github_sync_stale", "stale"), "not_synced", true],
  [
    "terminal failure",
    contract.taskGitHubSyncFailure("github_sync_invalid_target", "invalid"),
    "failed",
    true,
  ],
]) {
  test(`create-and-sync applies the ${name} transition`, async () => {
    createSyncResponse = responseFor(result);
    const fixture = useCreateFixture();
    fixture.command.createTask({
      creationRequestId: "create-client-flow",
      title: "Client flow task",
      taskType: "deliverable",
      createGitHubIssue: true,
      assignee: "",
    });
    await fixture.wait();
    assert.equal(fixture.getCreated().id, createdTask.id);
    assert.equal(fixture.getTask().githubIssueSyncStatus, expectedStatus);
    assert.equal(Boolean(fixture.errors.at(-1)), expectsError);
  });
}
