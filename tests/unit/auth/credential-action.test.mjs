import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("the public credential seam retains the missing-session HTTP contract", async () => {
  administratorProtocol();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  expect(await authorizeCredentialAction({
    credential: { kind: "session-request", request: { headers: new Headers() } },
    action: "team.read",
  })).toEqual({ ok: false, status: 401, error: "Anmeldung erforderlich." });
});

test("the seam verifies a bearer and preserves founder versus CEO action authority", async () => {
  const protocol = administratorProtocol();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const credential = { kind: "session-request", request: protocol.request() };
  expect(await authorizeCredentialAction({ credential, action: "tools.create" })).toMatchObject({
    ok: true, profile: { id: "synthetic-profile", platformRole: "founder" },
  });
  expect(await authorizeCredentialAction({ credential, action: "account.governance.update", targetProfileId: "synthetic-profile" })).toEqual({
    ok: false, status: 403, error: "Keine Berechtigung für diese Aktion.",
  });
});
