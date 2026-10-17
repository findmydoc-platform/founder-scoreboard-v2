import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("a bearer API guard verifies its exact request credential through the public policy", async () => {
  const protocol = administratorProtocol();
  const authz = await importTestModule("src/lib/authz.ts", { "server-only": {} });
  expect(await authz.requirePlanningContributor(protocol.request())).toMatchObject({ ok: true, profile: { id: "synthetic-profile" } });
  expect(await authz.requirePlanningContributor(protocol.request("/", "GET", undefined, { authorization: "Bearer unrelated-token" }))).toMatchObject({ ok: false, status: 401 });
});

test("the remaining legacy page adapter retains the exact stored credential contract", async () => {
  vi.resetModules();
  const user = { id: "synthetic-user" };
  const assertGoogleSession = vi.fn().mockResolvedValue("synthetic-session");
  const authz = await importTestModule("src/lib/authz.ts", { "server-only": {}, "@/lib/workspace-access": { requireWorkspaceAccess: async () => ({ userId: user.id }), assertGoogleSession } });
  const result = await authz.requireTeamMemberForSession({ auth: {
    getUser: async () => ({ data: { user }, error: null }),
    getSession: async () => ({ data: { session: { access_token: "synthetic-stored-token" } }, error: null }),
  }, rpc: async () => ({ data: { id: "synthetic-profile", platform_role: "founder" }, error: null }) });
  expect(result).toMatchObject({ ok: true, user, profile: { id: "synthetic-profile" } });
  expect(assertGoogleSession).toHaveBeenCalledWith("synthetic-stored-token", user.id);
});
