import { expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const user = { id: "user-1" };
const profile = { id: "profile-1", name: "Founder", platform_role: "founder" };

async function authzFixture(client) {
  const assertGoogleSession = vi.fn().mockResolvedValue("session-1");
  const authz = await importTestModule("src/lib/authz.ts", {
    "./workspace-access": {
      requireWorkspaceAccess: vi.fn().mockResolvedValue({ userId: user.id }),
      assertGoogleSession,
    },
    "./supabase-user": { getSupabaseForToken: vi.fn(() => client) },
    "./supabase": { requiresSupabaseAuth: () => true },
    "./local-development-auth": { isLocalLoginRequestAllowed: () => false },
    "./platform": { isOperationalLeadRole: () => false },
  });
  return { authz, assertGoogleSession };
}

test("a bearer API guard checks the request token without reading an empty session store", async () => {
  const getSession = vi.fn(() => { throw new Error("Bearer clients have no stored session"); });
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }), getSession },
    rpc: vi.fn().mockResolvedValue({ data: profile, error: null }),
  };
  const { authz, assertGoogleSession } = await authzFixture(client);

  const result = await authz.requirePlanningContributor({ headers: new Headers({ authorization: "Bearer exact-request-token" }) });

  expect(result).toMatchObject({ ok: true, profile: { id: profile.id } });
  expect(assertGoogleSession).toHaveBeenCalledWith("exact-request-token", user.id);
  expect(getSession).not.toHaveBeenCalled();
  expect(client.rpc).toHaveBeenCalledWith("current_authenticated_profile");
});

test("a cookie-backed page guard checks its stored session token", async () => {
  const getSession = vi.fn().mockResolvedValue({ data: { session: { access_token: "cookie-session-token" } }, error: null });
  const client = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }), getSession },
    rpc: vi.fn().mockResolvedValue({ data: profile, error: null }),
  };
  const { authz, assertGoogleSession } = await authzFixture(client);

  const result = await authz.requireTeamMemberForSession(client);

  expect(result).toMatchObject({ ok: true, user, profile: { id: profile.id } });
  expect(getSession).toHaveBeenCalledOnce();
  expect(assertGoogleSession).toHaveBeenCalledWith("cookie-session-token", user.id);
});
