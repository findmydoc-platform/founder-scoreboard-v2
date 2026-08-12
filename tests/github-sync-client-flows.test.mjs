import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule("src/lib/github-sync/contract.ts");

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
const { useTaskGitHubSyncCommand } = await loadTranspiledModule(
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
    "@/features/tasks/model/task-server-revision": {
      rememberTaskServerRevision: () => undefined,
    },
    "@/lib/github-sync/contract": contract,
    "@/lib/platform": {
      hasGitHubIssue: () => true,
    },
  },
);

function useCommandFixture() {
  let data = {
    tasks: [task()],
    taskComments: [],
  };
  const errors = [];
  commandTransitions.length = 0;
  const command = useTaskGitHubSyncCommand({
    apiClient: {},
    data,
    setData: (update) => {
      data = typeof update === "function" ? update(data) : update;
    },
    setSaveError: (value) => errors.push(value),
    serverUpdatedAtByTask: new Map(),
    source: "supabase",
    startTransition: (callback) => {
      const transition = Promise.resolve().then(callback);
      commandTransitions.push(transition);
    },
  });
  return {
    command,
    errors,
    getTask: () => data.tasks[0],
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
const { useTaskCreateCommand } = await loadTranspiledModule(
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
  let data = {
    tasks: [],
    profiles: [],
    taskRelations: [],
  };
  const errors = [];
  createTransitions.length = 0;
  const command = useTaskCreateCommand({
    apiClient: {},
    applyPlanningShellStateUpdate: (update) => {
      data = typeof update === "function" ? update(data) : update;
    },
    currentProfile: null,
    data,
    setSaveError: (value) => errors.push(value),
    setTaskDialogDefaults: () => undefined,
    startTransition: (callback) => {
      const transition = Promise.resolve().then(callback);
      createTransitions.push(transition);
    },
  });
  return {
    command,
    errors,
    getTask: () => data.tasks[0],
    wait: async () => Promise.all(createTransitions),
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
    "not_synced",
    true,
  ],
]) {
  test(`create-and-sync applies the ${name} transition`, async () => {
    createSyncResponse = responseFor(result);
    const fixture = useCreateFixture();
    fixture.command.createTask({
      title: "Client flow task",
      taskType: "deliverable",
      createGitHubIssue: true,
      assignee: "",
    });
    await fixture.wait();
    assert.equal(fixture.getTask().githubIssueSyncStatus, expectedStatus);
    assert.equal(Boolean(fixture.errors.at(-1)), expectsError);
  });
}

let detailSyncResponse = responseFor(successResult());
let detailStates = [];
let detailTransitions = [];
const { useTaskDetailWorkflow } = await loadTranspiledModule(
  "src/features/tasks/hooks/use-task-detail-workflow.ts",
  {
    react: {
      useEffect: () => undefined,
      useRef: (value) => ({ current: value }),
      useState: (initial) => {
        const index = detailStates.length;
        detailStates.push(typeof initial === "function" ? initial() : initial);
        return [
          detailStates[index],
          (update) => {
            detailStates[index] = typeof update === "function"
              ? update(detailStates[index])
              : update;
          },
        ];
      },
      useTransition: () => [
        false,
        (callback) => {
          const transition = Promise.resolve().then(callback);
          detailTransitions.push(transition);
        },
      ],
    },
    "next/navigation": {
      useRouter: () => ({ push: () => undefined, refresh: () => undefined, replace: () => undefined }),
    },
    "@/lib/browser-api-client": {
      createBrowserApiClient: () => ({}),
    },
    "@/features/tasks/model/task-api-client": {
      createTaskRequest: async () => ({ response: { ok: false }, body: null }),
      reportTaskBlockerRequest: async () => ({ response: { ok: false }, body: null }),
      syncTaskToGitHubRequest: async () => detailSyncResponse,
      updateTaskRequest: async () => ({ response: { ok: false }, body: null }),
      withdrawTaskRequest: async () => ({ response: { ok: false }, body: null }),
    },
    "@/features/tasks/model/task-mutation-contract": {
      buildClientTaskUpdatePatch: (_, patch) => patch,
      taskUpdateRequestPayload: (_, patch) => patch,
    },
    "@/features/tasks/model/task-detail-state": {
      buildEditableTaskState: (value) => ({ ...value }),
      buildTaskDetailGitHubState: (value) => ({
        githubRepo: value.githubRepo,
        githubIssueNumber: value.githubIssueNumber,
        githubIssueUrl: value.githubIssueUrl,
        githubIssueSyncStatus: value.githubIssueSyncStatus,
        githubIssueLastSyncedAt: value.githubIssueLastSyncedAt,
        githubIssueSyncError: value.githubIssueSyncError,
        githubIssueSyncPendingSince: value.githubIssueSyncPendingSince,
      }),
    },
    "@/features/tasks/hooks/use-task-comments": {
      useTaskComments: () => ({
        taskComments: [],
        taskExternalComments: [],
        taskActivities: [],
        localCommentImportNotice: "",
        githubCommentImportPending: false,
        addComment: () => undefined,
        uploadAttachment: () => undefined,
        importGitHubComments: () => undefined,
        appendTaskActivities: () => undefined,
      }),
    },
    "@/features/tasks/hooks/use-task-relationships": {
      useTaskRelationships: () => ({
        relations: [],
        addRelation: () => undefined,
        removeRelation: () => undefined,
      }),
    },
    "@/lib/github-sync/contract": contract,
    "@/lib/local-development-auth": {
      isLocalLoginSimulationEnabled: () => false,
    },
  },
);

function useDetailFixture() {
  detailStates = [];
  detailTransitions = [];
  const workflow = useTaskDetailWorkflow({
    task: task(),
    packages: [],
    comments: [],
    externalComments: [],
    activities: [],
    blockers: [],
    subIssues: [],
    taskRelations: [],
    profiles: [],
    source: "supabase",
    commentImportNotice: "",
  });
  return {
    workflow,
    getError: () => detailStates[1],
    getGitHubState: () => detailStates[2],
    wait: async () => Promise.all(detailTransitions),
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
  test(`detail sync applies the ${name} transition`, async () => {
    detailSyncResponse = responseFor(result);
    const fixture = useDetailFixture();
    fixture.workflow.syncGitHub();
    await fixture.wait();
    assert.equal(fixture.getGitHubState().githubIssueSyncStatus, expectedStatus);
    assert.equal(
      fixture.getGitHubState().githubIssueSyncPendingSince === "",
      expectedStatus !== "pending",
    );
  });
}
