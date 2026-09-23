import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

async function loadRoute(rpcCalls) {
  return importTestModule("src/app/api/administration/profiles/[id]/technical/route.ts", {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/api-input": {
      auditRequestMetadata: () => ({ request_ip: "test-ip", user_agent: "test-agent" }),
      cleanOptionalText: (value, maximumLength) => typeof value === "string" ? value.trim().slice(0, maximumLength) : "",
    },
    "@/lib/authz": {
      bearerToken: () => "session-token",
      requireActiveAdministrator: async () => ({ ok: true, profile: { id: "administrator" } }),
    },
    "@/lib/api-response": {
      apiError: (error, status) => ({ body: { error }, status }),
      authzError: (permission) => ({ body: { error: permission.error }, status: permission.status }),
    },
    "@/lib/mentions": { isGitHubLogin: (value) => !value.includes("_") },
    "@/lib/supabase": {
      getSupabaseForToken: () => ({
        rpc: async (...args) => {
          rpcCalls.push(args);
          return { data: null, error: null };
        },
      }),
    },
  });
}

test("rejects an invalid GitHub login before the technical identity transaction", async () => {
  const rpcCalls = [];
  const { PATCH } = await loadRoute(rpcCalls);
  const response = await PATCH(
    { json: async () => ({ githubLogin: "bad_login" }) },
    { params: Promise.resolve({ id: "profile-1" }) },
  );
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "GitHub-Login ist ungültig.");
  assert.equal(rpcCalls.length, 0);
});
