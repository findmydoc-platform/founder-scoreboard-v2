import assert from "node:assert/strict";

import test from "node:test";

import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-contract.ts",
);

const githubContract = await loadTranspiledModule(
  "src/lib/github-sync/contract.ts",
);

let standaloneAccessRequest = null;

let standaloneMode = "accepted";

let standaloneEnqueueError = null;

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
      handlePlanningItemsRequest: async (_request, accessRequest, _fallback, handler) => {
        standaloneAccessRequest = accessRequest;
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
      planningItemsTokenInactiveError: () => ({
        status: 401,
        headers: new Headers({ "WWW-Authenticate": 'Bearer error="invalid_token"' }),
        async json() {
          return { ok: false, code: "TOKEN_INACTIVE", error: "Planning-API-Token ist nicht mehr aktiv." };
        },
      }),
    },
    "@/features/planning-items/model/planning-items-github-projection": {
      enqueueTeamPlanningGitHubProjection: async ({ itemId }) => standaloneEnqueueError
        ? { ok: false, error: standaloneEnqueueError }
        : {
            ok: true,
            value: {
              operationId: "team-sync:token-1:key-1",
              itemId,
              itemType: "sub_issue",
              githubSync: { status: "accepted" },
              replayed: false,
            },
          },
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

test("standalone async sync requires the new scope and returns 202 without an idempotency key", async () => {
  standaloneMode = "accepted";
  standaloneEnqueueError = null;
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

  assert.deepEqual(standaloneAccessRequest, {
    operation: "planningItems.githubSync",
    mode: "commit",
    requiredScopes: ["write:planning-items:github-sync"],
  });
  assert.equal(response.status, 202);
  assert.equal(body.githubSync.status, "accepted");
  assert.equal(typeof scheduledAfter, "function");
});

test("standalone sync preserves a late inactive-token response", async () => {
  standaloneEnqueueError = { code: "P0004", message: "planning items token is inactive" };
  const response = await standaloneRoute.handleTeamPlanningItemGitHubSync({
    json: async () => ({
      githubSyncMode: "async",
      createIfMissing: true,
    }),
  }, {
    params: Promise.resolve({ id: "task-1" }),
  });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, "TOKEN_INACTIVE");
  assert.equal(response.headers.get("www-authenticate"), 'Bearer error="invalid_token"');
  standaloneEnqueueError = null;
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
