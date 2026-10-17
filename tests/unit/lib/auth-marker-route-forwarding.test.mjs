import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { notificationDeliveryProtocol } from "../../helpers/notification-delivery-protocol.mjs";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

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

test("platform release routes preserve a marked team-member failure through actual session authorization", async () => {
  vi.resetModules();
  const fixture = administratorProtocol({ authError: 401 });
  try {
    const releasesRoute = await importTestModule("src/app/api/team/platform-releases/v1/releases/route.ts", { "server-only": {} });
    const seenRoute = await importTestModule("src/app/api/team/platform-releases/v1/releases/[version]/seen/route.ts", { "server-only": {} });
    const releasesResponse = await releasesRoute.GET(fixture.request("/api/team/platform-releases/v1/releases"));
    assert.equal(releasesResponse.status, 401);
    assert.deepEqual(await releasesResponse.json(), {
      ok: false, code: "session_invalid_before_effect", error: "Anmeldung ungültig oder abgelaufen.",
    });
    const seenResponse = await seenRoute.POST(fixture.request("/api/team/platform-releases/v1/releases/v1.2.3/seen", "POST"), { params: Promise.resolve({ version: "v1.2.3" }) });
    assert.equal(seenResponse.status, 401);
    assert.deepEqual(await seenResponse.json(), {
      ok: false, code: "session_invalid_before_effect", error: "Anmeldung ungültig oder abgelaufen.",
    });
    assert.deepEqual(fixture.calls, []);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
