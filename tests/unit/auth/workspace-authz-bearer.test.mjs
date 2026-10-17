import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

test("a bearer action verifies its exact request credential through the public policy", async () => {
  const protocol = administratorProtocol();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const authorize = request => authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "tools.create" });
  expect(await authorize(protocol.request())).toMatchObject({ ok: true, profile: { id: "synthetic-profile" } });
  expect(await authorize(protocol.request("/", "GET", undefined, { authorization: "Bearer unrelated-token" }))).toMatchObject({ ok: false, status: 401 });
});

test("server-cookie admission verifies the stored credential and rejects an unmapped session", async () => {
  const protocol = administratorProtocol();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {}, "next/headers": { cookies: async () => protocol.cookieJar() } });
  expect(await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.planning" })).toMatchObject({ ok: true, user: { id: "synthetic-user" }, profile: { id: "synthetic-profile" } });
  protocol.state.profile = false;
  expect(await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.planning" })).toMatchObject({ ok: false, status: 403 });
});
