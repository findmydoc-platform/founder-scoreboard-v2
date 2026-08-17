import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-contract.ts",
);
const githubContract = await loadTranspiledModule(
  "src/lib/github-sync/contract.ts",
);

let installationTokenError = null;
let activeProjections = 0;
let maximumActiveProjections = 0;
const projectionOrder = [];
const persistedFailures = [];
const preflightFailures = new Map();
const syncModel = await loadTranspiledModule(
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

let standaloneScope = "";
let standaloneMode = "accepted";
let scheduledAfter = null;
const standaloneRoute = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-team-github-sync-route.ts",
  {
    "next/server": {
      after: (callback) => {
        scheduledAfter = callback;
      },
    },
    "@/features/planning-items/model/planning-items-contract": contract,
    "@/features/planning-items/model/planning-items-team-canonical-item": {
      hasCanonicalTeamPlanningItem: async () => true,
    },
    "@/features/planning-items/model/planning-items-github-sync": {
      loadPlanningItemGitHubSyncTarget: async (_supabase, itemId, command) => ({
        ok: true,
        target: {
          itemId,
          itemType: "sub_issue",
          command,
        },
      }),
      preflightPlanningItemGitHubSync: async () => (
        standaloneMode === "accepted"
          ? { status: "accepted" }
          : {
            status: "notEligible",
            code: "github_sync_not_approved",
            error: "Parent is not approved",
            retryable: false,
          }
      ),
      executePlanningItemGitHubSyncs: async ({ targets }) => new Map([
        [targets[0].itemId, standaloneMode === "failed"
          ? {
            status: "failed",
            code: "github_sync_unavailable",
            error: "GitHub unavailable",
            retryable: true,
          }
          : {
            status: "synced",
            code: "github_sync_succeeded",
            issue: {
              repository: "findmydoc-platform/management",
              number: 42,
              url: "https://github.com/findmydoc-platform/management/issues/42",
              recovered: false,
              recreated: false,
            },
            warnings: [],
          }],
      ]),
    },
    "@/features/planning-items/model/planning-items-route": {
      handlePlanningItemsRequest: async (_request, scope, _fallback, handler) => {
        standaloneScope = scope;
        return handler({
          supabase: {},
          profile: { id: "profile-1" },
          tokenId: "token-1",
          scopes: ["write:planning-items:github-sync"],
        });
      },
      planningItemsError: (error, status) => ({
        status,
        async json() {
          return { ok: false, error };
        },
      }),
      planningItemsJson: (body, status = 200) => ({
        status,
        async json() {
          return body;
        },
      }),
    },
    "@/features/planning-items/model/planning-items-github-projection": {
      enqueueTeamPlanningGitHubProjection: async ({ itemId }) => ({
        ok: true,
        value: {
          operationId: "team-sync:token-1:key-1",
          itemId,
          itemType: "sub_issue",
          githubSync: { status: "accepted" },
          replayed: false,
        },
      }),
      dispatchAndLoadPlanningGitHubProjections: async () => new Map([
        ["task-1", standaloneMode === "failed"
          ? {
              status: "failed",
              code: "github_sync_unavailable",
              error: "GitHub unavailable",
              retryable: true,
            }
          : {
              status: "synced",
              code: "github_sync_succeeded",
              issue: {
                repository: "findmydoc-platform/management",
                number: 42,
                url: "https://github.com/findmydoc-platform/management/issues/42",
                recovered: false,
                recreated: false,
              },
              warnings: [],
            }],
      ]),
    },
    "@/lib/github-sync/contract": githubContract,
  },
);

const create = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-create.ts",
  {
    "@/lib/planning-read-model": {
      ACTIVE_PACKAGES_TABLE: "active_packages",
      ACTIVE_TASKS_TABLE: "active_tasks",
    },
    "@/lib/github-repositories": {
      defaultGitHubRepository: "findmydoc-platform/management",
      resolveTaskGitHubRepository: () => ({
        ok: true,
        repository: "findmydoc-platform/management",
      }),
    },
    "@/features/reviews/model/task-review-state": {},
    "@/features/planning-items/model/planning-items-contract": contract,
    "@/features/planning-items/model/planning-items-github-sync-preview": {
      previewPlanningItemGitHubSync: () => ({ status: "accepted" }),
    },
    "@/features/planning-items/model/planning-item-normalization": {
      intakeText: (value) => String(value || "").trim(),
    },
  },
);

const update = await loadTranspiledModule(
  "src/features/planning-items/model/planning-item-update.ts",
  {
    "@/lib/planning-read-model": {
      ACTIVE_PACKAGES_TABLE: "active_packages",
      ACTIVE_TASKS_TABLE: "active_tasks",
    },
    "@/lib/github-repositories": {},
    "@/features/tasks/model/task-detail-permissions": {},
    "@/features/reviews/model/task-review-state": {},
    "@/features/tasks/model/task-route-update-helpers": {},
    "@/lib/platform": {},
    "@/lib/status": {},
    "@/features/planning-items/model/planning-items-contract": contract,
    "@/features/planning-items/model/planning-item-normalization": {},
  },
);

test("GitHub sync command and mode parsing are strict", () => {
  assert.deepEqual(
    contract.parsePlanningItemGitHubSyncCommand({ createIfMissing: false }),
    { ok: true, command: { createIfMissing: false } },
  );
  assert.equal(
    contract.parsePlanningItemGitHubSyncCommand({ createIfMissing: "false" }).ok,
    false,
  );
  assert.equal(
    contract.parsePlanningItemGitHubSyncCommand({
      createIfMissing: true,
      unexpected: true,
    }).ok,
    false,
  );
  assert.equal(contract.parsePlanningItemGitHubSyncMode("async"), "async");
  assert.equal(contract.parsePlanningItemGitHubSyncMode("wait"), "wait");
  assert.equal(contract.parsePlanningItemGitHubSyncMode("later"), null);
});

test("create requires an explicit mode exactly when an item requests GitHub sync", () => {
  const baseItem = { itemType: "sub_issue", title: "Sync item" };
  assert.equal(create.parsePlanningItemCreatePayload({
    items: [{ ...baseItem, githubSync: { createIfMissing: true } }],
  }).ok, false);
  assert.equal(create.parsePlanningItemCreatePayload({
    githubSyncMode: "async",
    items: [baseItem],
  }).ok, false);

  const parsed = create.parsePlanningItemCreatePayload({
    githubSyncMode: "wait",
    items: [
      { ...baseItem, githubSync: { createIfMissing: false } },
      { itemType: "deliverable", title: "FounderOps only" },
    ],
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.githubSyncMode, "wait");
  assert.deepEqual(create.planningItemCreateGitHubSyncCommands(parsed.items), [
    { createIfMissing: false },
    null,
  ]);
});

test("PATCH permits sync-only commands and keeps mode-command coupling strict", () => {
  const expectedUpdatedAt = "2026-07-28T12:00:00.000Z";
  const parsed = update.parsePlanningItemPatchPayload({
    expectedUpdatedAt,
    githubSyncMode: "async",
    githubSync: { createIfMissing: true },
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.presentFields, []);
  assert.deepEqual(parsed.githubSync, { createIfMissing: true });

  assert.equal(update.parsePlanningItemPatchPayload({
    expectedUpdatedAt,
    githubSync: { createIfMissing: true },
  }).ok, false);
  assert.equal(update.parsePlanningItemPatchPayload({
    expectedUpdatedAt,
    githubSyncMode: "wait",
    title: "No command",
  }).ok, false);

  const unknownField = update.parsePlanningItemPatchPayload({
    expectedUpdatedAt,
    unsupportedField: "value",
  });
  assert.equal(unknownField.ok, false);
  assert.match(unknownField.error, /unbekannte Feld unsupportedField/);

  assert.equal(update.parsePlanningItemPatchPayload({ expectedUpdatedAt, sprintId: "sprint-1" }).ok, false);
  assert.equal(update.parsePlanningItemPatchPayload({ expectedUpdatedAt, evidenceLink: "https://example.com" }).ok, false);
  const internal = update.parsePlanningItemPatchPayload(
    { expectedUpdatedAt, sprintId: "sprint-1", evidenceLink: "https://example.com" },
    { allowWebhookProjectionFields: true },
  );
  assert.equal(internal.ok, true);
  assert.deepEqual(internal.presentFields, ["sprintId", "evidenceLink"]);
});

test("create idempotency hash includes GitHub mode and per-item decisions", () => {
  const items = [{
    clientId: "planning-items-create-1",
    itemType: "sub_issue",
    title: "Sync item",
    description: "",
    approvalStatus: null,
    errors: [],
    warnings: [],
  }];
  const asyncHash = create.planningItemCreateHash(
    items,
    "async",
    [{ createIfMissing: true }],
  );
  const waitHash = create.planningItemCreateHash(
    items,
    "wait",
    [{ createIfMissing: true }],
  );
  const noCreateHash = create.planningItemCreateHash(
    items,
    "async",
    [{ createIfMissing: false }],
  );
  assert.notEqual(asyncHash, waitHash);
  assert.notEqual(asyncHash, noCreateHash);
});

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

test("standalone async sync requires the new scope and returns 202 without an idempotency key", async () => {
  standaloneMode = "accepted";
  scheduledAfter = null;
  const response = await standaloneRoute.handleTeamPlanningItemGitHubSync({
    json: async () => ({
      githubSyncMode: "async",
      createIfMissing: true,
    }),
  }, {
    params: Promise.resolve({ id: "task-1" }),
  });
  const body = await response.json();

  assert.equal(standaloneScope, "write:planning-items:github-sync");
  assert.equal(response.status, 202);
  assert.equal(body.githubSync.status, "accepted");
  assert.equal(typeof scheduledAfter, "function");
});

test("standalone wait sync preserves GitHub failure status", async () => {
  standaloneMode = "failed";
  const response = await standaloneRoute.handleTeamPlanningItemGitHubSync({
    json: async () => ({
      githubSyncMode: "wait",
      createIfMissing: false,
    }),
  }, {
    params: Promise.resolve({ id: "task-1" }),
  });
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.ok, false);
  assert.equal(body.githubSync.code, "github_sync_unavailable");
});
