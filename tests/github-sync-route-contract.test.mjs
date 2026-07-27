import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule("src/lib/github-sync/contract.ts");

let payload;
let tokenCalls;
let projectionCalls;
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
      requireJsonApiContext: async () => ({
        ok: true,
        supabase: {},
        permission: { profile: { id: "profile-1" } },
        payload,
      }),
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
  },
);

test("sync route rejects a non-boolean creation decision before token acquisition", async () => {
  payload = { createIfMissing: "false" };
  tokenCalls = 0;
  projectionCalls = [];

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

  const response = await route.POST({}, { params: Promise.resolve({ id: "task-1" }) });

  assert.equal(response.status, 409);
  assert.equal(tokenCalls, 1);
  assert.equal(projectionCalls.length, 1);
  assert.equal(projectionCalls[0].createIfMissing, false);
});
