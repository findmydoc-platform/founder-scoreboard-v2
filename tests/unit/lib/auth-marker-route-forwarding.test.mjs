import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const markedFailure = {
  ok: false,
  status: 401,
  code: "session_invalid_before_effect",
  error: "Anmeldung ungültig oder abgelaufen.",
};

function authzError(permission, fields = {}) {
  return Response.json({
    ...fields,
    ...(permission.code ? { code: permission.code } : {}),
    error: permission.error,
  }, { status: permission.status });
}

const nextServer = {
  NextResponse: {
    json: (body, init) => Response.json(body, init),
  },
};

async function assertMarked(response) {
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  });
}

test("notification delivery preserves a marked operational-lead failure", async () => {
  const route = await importTestModule("src/app/api/notifications/deliver/route.ts", {
    "next/server": nextServer,
    "@/lib/api-response": { apiError: () => null, authzError, supabaseUnavailable: () => null },
    "@/lib/authz": { requireOperationalLead: async () => markedFailure },
    "@/lib/google-chat": {
      googleChatDeliveryStatus: () => ({}),
      isGoogleChatDmSpace: () => false,
      sendGoogleChatDigest: async () => undefined,
      sendGoogleChatSpaceDigest: async () => undefined,
    },
    "@/lib/notification-policy": {
      shouldSendToGoogleChatDigest: () => false,
      shouldSendToGoogleChatDm: () => false,
    },
    "@/lib/notification-resolution": { reconcileNotificationEvents: async () => undefined },
    "@/lib/supabase": { getServerSupabase: () => ({}) },
  });

  await assertMarked(await route.POST(new Request("http://localhost/api/notifications/deliver", { method: "POST" })));
});

test("notification digest generation preserves a marked operational-lead failure", async () => {
  const route = await importTestModule("src/app/api/notifications/generate-digest/route.ts", {
    "next/server": nextServer,
    "@/lib/api-response": { apiError: () => null, authzError, supabaseUnavailable: () => null },
    "@/lib/authz": { requireOperationalLead: async () => markedFailure },
    "@/lib/supabase": { getServerSupabase: () => ({}) },
    "@/lib/notification-catalog": { createNotificationPayload: () => ({}) },
    "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
  });

  await assertMarked(await route.POST(new Request("http://localhost/api/notifications/generate-digest", { method: "POST" })));
});

test("platform release routes preserve a marked team-member failure", async () => {
  const releasesRoute = await importTestModule("src/app/api/team/platform-releases/v1/releases/route.ts", {
    "@/features/platform-releases/model/platform-release-manifest": {
      canonicalPlatformReleaseManifest: () => "",
      validatePlatformReleaseManifest: () => ({ ok: false, error: "unused" }),
    },
    "@/features/platform-releases/server/platform-release-read-model-supabase": {
      loadPlatformReleases: async () => [],
    },
    "@/lib/api-response": { authzError },
    "@/lib/authz": { requireTeamMember: async () => markedFailure },
    "@/lib/supabase-service-role": { getServerServiceRoleSupabase: () => null },
  });
  const seenRoute = await importTestModule("src/app/api/team/platform-releases/v1/releases/[version]/seen/route.ts", {
    "@/lib/api-response": { authzError },
    "@/lib/authz": { requireTeamMember: async () => markedFailure },
    "@/lib/supabase-service-role": { getServerServiceRoleSupabase: () => null },
  });

  const releasesResponse = await releasesRoute.GET(new Request("http://localhost/api/team/platform-releases/v1/releases"));
  assert.equal(releasesResponse.status, 401);
  assert.deepEqual(await releasesResponse.json(), {
    ok: false,
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  });

  const seenResponse = await seenRoute.POST(
    new Request("http://localhost/api/team/platform-releases/v1/releases/v1.2.3/seen", { method: "POST" }),
    { params: Promise.resolve({ version: "v1.2.3" }) },
  );
  assert.equal(seenResponse.status, 401);
  assert.deepEqual(await seenResponse.json(), {
    ok: false,
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  });
});
