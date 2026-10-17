import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("the public credential seam retains the missing-session HTTP contract", async () => {
  vi.stubEnv("REQUIRE_SUPABASE_AUTH", "true");
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  expect(await authorizeCredentialAction({
    credential: { kind: "session-request", request: { headers: new Headers() } },
    action: "team.read",
  })).toEqual({ ok: false, status: 401, error: "Anmeldung erforderlich." });
});

test("the seam verifies a bearer and preserves founder versus CEO action authority", async () => {
  vi.stubEnv("REQUIRE_SUPABASE_AUTH", "true");
  vi.stubEnv("SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("SUPABASE_ANON_KEY", "synthetic-anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service");
  vi.stubGlobal("fetch", async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    if (url.pathname === "/auth/v1/user") return Response.json({ id: "auth-1", aud: "authenticated", identities: [] });
    if (url.pathname === "/rest/v1/rpc/workspace_access_context") return Response.json({ mode: "legacy", userId: "auth-1", profileId: "profile-1" });
    if (url.pathname === "/rest/v1/rpc/current_authenticated_profile") return Response.json({ id: "profile-1", name: "Founder", platform_role: "founder" });
    throw new Error(`Unexpected external protocol ${url.pathname}`);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const credential = { kind: "session-request", request: { headers: new Headers({ authorization: "Bearer synthetic-access" }) } };
  expect(await authorizeCredentialAction({ credential, action: "planning.contribute" })).toMatchObject({
    ok: true, profile: { id: "profile-1", platformRole: "founder" },
  });
  expect(await authorizeCredentialAction({ credential, action: "governance.ceo" })).toEqual({
    ok: false, status: 403, error: "Keine Berechtigung für diese Aktion.",
  });
});
