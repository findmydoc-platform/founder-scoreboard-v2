import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { notificationDeliveryProtocol } from "../../helpers/notification-delivery-protocol.mjs";
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

async function assertMarked(response) {
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    code: "session_invalid_before_effect",
    error: "Anmeldung ungültig oder abgelaufen.",
  });
}

test.each(["deliver","generate-digest"])("notification %s preserves the invalid-session marker through central authorization", async action => {
  vi.resetModules();
  const fixture = notificationDeliveryProtocol();
  fixture.state.authError = 401;
  try {
    const route = await importTestModule(`src/app/api/notifications/${action}/route.ts`, {"server-only":{}});
    await assertMarked(await route.POST(fixture.request()));
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
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
