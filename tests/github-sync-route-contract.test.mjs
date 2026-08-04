import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule("src/lib/github-sync/contract.ts");

let payload;
let tokenCalls;
let projectionCalls;
let apiContext;
let activeTaskType = "deliverable";
let activeTaskError = null;
let activeTaskMissing = false;

function activeTaskSupabase() {
  return {
    from() {
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return {
            data: activeTaskMissing ? null : { task_type: activeTaskType },
            error: activeTaskError,
          };
        },
      };
    },
  };
}
const route = await loadTranspiledModule(
  "src/app/api/tasks/[id]/sync-github/route.ts",
  {
    "next/server": {
      NextResponse: {
        json: (body, init) => ({
          status: init.status,
          async json() {
            return body;
          },
        }),
      },
    },
    "@/lib/authz": {
      requireTeamMember: () => ({ ok: true }),
    },
    "@/lib/api-response": {
      requireJsonApiContext: async () => apiContext,
    },
    "@/lib/github-app": {
      getGitHubAppInstallationToken: async () => {
        tokenCalls += 1;
        return "installation-token";
      },
    },
    "@/lib/github-sync/contract": contract,
    "@/lib/github-sync/task-projection": {
      projectTaskToGitHub: async (command) => {
        projectionCalls.push(command);
        return contract.taskGitHubSyncFailure(
          "github_sync_creation_required",
          "creation required",
        );
      },
    },
    "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
  },
);

test("sync route rejects a non-boolean creation decision before token acquisition", async () => {
  payload = { createIfMissing: "false" };
  tokenCalls = 0;
  projectionCalls = [];
  apiContext = {
    ok: true,
    supabase: activeTaskSupabase(),
    permission: { profile: { id: "profile-1" } },
    payload,
  };

  const response = await route.POST({}, { params: Promise.resolve({ id: "task-1" }) });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "github_sync_invalid_target");
  assert.equal(body.retryable, false);
  assert.equal(tokenCalls, 0);
  assert.deepEqual(projectionCalls, []);
});

test("sync route forwards an explicit false creation decision unchanged", async () => {
  payload = { createIfMissing: false };
  tokenCalls = 0;
  projectionCalls = [];
  apiContext = {
    ok: true,
    supabase: activeTaskSupabase(),
    permission: { profile: { id: "profile-1" } },
    payload,
  };

  const response = await route.POST({}, { params: Promise.resolve({ id: "task-1" }) });

  assert.equal(response.status, 409);
  assert.equal(tokenCalls, 1);
  assert.equal(projectionCalls.length, 1);
  assert.equal(projectionCalls[0].createIfMissing, false);
});

test("sync route preserves API context infrastructure status metadata", async () => {
  tokenCalls = 0;
  projectionCalls = [];
  apiContext = {
    ok: false,
    status: 501,
    error: "Supabase env is not configured.",
  };

  const response = await route.POST({}, { params: Promise.resolve({ id: "task-1" }) });
  const body = await response.json();

  assert.equal(response.status, 501);
  assert.equal(body.code, "github_sync_unavailable");
  assert.equal(body.retryable, true);
  assert.equal(tokenCalls, 0);
  assert.deepEqual(projectionCalls, []);
});

test("sync route rejects strategic items before token acquisition", async () => {
  payload = { createIfMissing: false };
  activeTaskType = "initiative";
  tokenCalls = 0;
  projectionCalls = [];
  apiContext = {
    ok: true,
    supabase: activeTaskSupabase(),
    permission: { profile: { id: "profile-1" } },
    payload,
  };

  const response = await route.POST({}, { params: Promise.resolve({ id: "initiative-1" }) });
  const body = await response.json();

  assert.equal(response.status, 409);
  assert.equal(body.code, "github_sync_invalid_target");
  assert.equal(tokenCalls, 0);
  assert.deepEqual(projectionCalls, []);
  activeTaskType = "deliverable";
});

test("sync route distinguishes a database outage from a missing item", async () => {
  payload = { createIfMissing: false };
  tokenCalls = 0;
  projectionCalls = [];
  apiContext = {
    ok: true,
    supabase: activeTaskSupabase(),
    permission: { profile: { id: "profile-1" } },
    payload,
  };

  activeTaskError = { code: "08006", message: "connection failed" };
  let response = await route.POST({}, { params: Promise.resolve({ id: "task-1" }) });
  let body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "github_sync_unavailable");
  assert.equal(body.retryable, true);
  assert.equal(tokenCalls, 0);

  activeTaskError = null;
  activeTaskMissing = true;
  response = await route.POST({}, { params: Promise.resolve({ id: "task-1" }) });
  body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.code, "github_sync_not_found");
  assert.equal(body.retryable, false);
  assert.equal(tokenCalls, 0);
  assert.deepEqual(projectionCalls, []);
  activeTaskMissing = false;
});
