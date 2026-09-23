import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const rpcCalls = [];
let rpcError = null;

const route = await importTestModule("src/app/api/administration/profiles/[id]/technical/route.ts", {
  "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  "@/lib/api-input": {
    auditRequestMetadata: () => ({ request_ip: "127.0.0.1", user_agent: "test" }),
    cleanOptionalText: (value) => typeof value === "string" ? value.trim() : "",
  },
  "@/lib/api-response": {
    apiError: (error, status) => Response.json({ error }, { status }),
    authzError: (permission) => Response.json({
      error: permission.error,
      ...(permission.code ? { code: permission.code } : {}),
    }, { status: permission.status }),
  },
  "@/lib/authz": {
    bearerToken: () => "session-token",
    requireActiveAdministrator: async () => ({ ok: true, profile: { id: "administrator" } }),
    resolveAdministratorAccessFailure: async () => ({
      ok: false,
      status: 403,
      code: "administrator_access_expired",
      error: "Der Adminzugang ist abgelaufen.",
    }),
  },
  "@/lib/mentions": { isGitHubLogin: () => true },
  "@/lib/supabase": {
    getSupabaseForToken: () => ({
      rpc: async (name, params) => {
        rpcCalls.push([name, params]);
        return {
          data: { profile: { id: "sebastian", auth_user_id: "must-not-leak" } },
          error: rpcError,
        };
      },
    }),
  },
});

beforeEach(() => {
  rpcCalls.length = 0;
  rpcError = null;
});

function request(payload) {
  return new Request("http://localhost/api/administration/profiles/sebastian/technical", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

const context = { params: Promise.resolve({ id: "sebastian" }) };

test("technical administration rejects personal notification preference writes", async () => {
  const response = await route.PATCH(request({ notificationsEnabled: false }), context);

  assert.equal(response.status, 400);
  assert.equal(rpcCalls.length, 0);
});

test("technical administration returns a narrow success response", async () => {
  const response = await route.PATCH(request({
    githubLogin: "sebastian",
    googleChatUserId: "chat-user",
    googleChatDmSpace: "spaces/dm",
  }), context);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(rpcCalls, [["update_profile_technical_identity_transaction", {
    p_profile_id: "sebastian",
    p_profile_patch: {
      github_login: "sebastian",
      google_chat_user_id: "chat-user",
      google_chat_dm_space: "spaces/dm",
    },
    p_request_ip: "127.0.0.1",
    p_user_agent: "test",
  }]]);
});

test("technical administration exposes the late expiry code", async () => {
  rpcError = { code: "42501" };

  const response = await route.PATCH(request({ githubLogin: "sebastian" }), context);

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    code: "administrator_access_expired",
    error: "Der Adminzugang ist abgelaufen.",
  });
});
