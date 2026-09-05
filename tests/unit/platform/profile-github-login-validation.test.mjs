import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

async function loadRoute(rpcCalls) {
  return importTestModule("src/app/api/profiles/[id]/route.ts", {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/api-input": {
      auditRequestMetadata: () => ({ request_ip: "test-ip", user_agent: "test-agent" }),
      cleanOptionalDate: () => null,
      cleanOptionalText: (value, maximumLength) => typeof value === "string" ? value.trim().slice(0, maximumLength) : "",
    },
    "@/lib/authz": { requireCEO: () => ({}) },
    "@/lib/planning-row-mappers": { mapNotificationPreference: (value) => value, mapProfile: (value) => value },
    "@/lib/notification-policy": { googleChatDigestEventTypes: [] },
    "@/lib/api-response": {
      apiError: (error, status) => ({ body: { error }, status }),
      requireApiContext: async () => ({
        ok: true,
        permission: { profile: { id: "ceo" } },
        supabase: { rpc: async (...args) => { rpcCalls.push(args); return { data: null, error: null }; } },
      }),
    },
    "@/features/profile/model/profile-color-api": {
      buildProfileColorPatch: () => ({ ok: true, patch: {} }),
      mapProfileColorTransactionError: () => null,
    },
  });
}

test("rejects an invalid GitHub login before the profile transaction", async () => {
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
