import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let protocol;
beforeEach(() => { vi.resetModules(); protocol = administratorProtocol({ role: "ceo" }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function route() { return importTestModule("src/app/api/profiles/[id]/route.ts", { "server-only": {} }); }
const context = { params: Promise.resolve({ id: "bound-target" }) };

test("profile governance returns only governance fields through the real route and credential seam", async () => {
  protocol.state.responses.update_profile_governance_transaction = { profile: {
    id: "bound-target", name: "Synthetic Founder", platform_role: "founder", org_role: "Founder",
    deputy_for: null, deputy_active_from: null, deputy_active_until: null, weekly_capacity: 31,
    auth_user_id: "excluded", github_login: "excluded",
  } };
  const response = await (await route()).PATCH(protocol.request("/api/profiles/bound-target", "PATCH", { weeklyCapacity: 31 }), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ profile: { id: "bound-target", name: "Synthetic Founder", platformRole: "founder", orgRole: "Founder", deputyFor: "", deputyActiveFrom: "", deputyActiveUntil: "", weeklyCapacity: 31, persistenceBasis: { platform_role: "founder", org_role: "Founder", deputy_for: null, deputy_active_from: null, deputy_active_until: null, weekly_capacity: 31 } }, notificationPreferences: [] });
  expect(protocol.calls[0].body.p_profile_id).toBe("bound-target");
});

test.each(["founder", "deputy", "viewer"])("%s cannot use CEO governance even with an active administrator session", async role => {
  protocol.state.role = role;
  const response = await (await route()).PATCH(protocol.request("/api/profiles/bound-target", "PATCH", { platformRole: "ceo" }), context);
  expect(response.status).toBe(403);
  expect(protocol.calls).toEqual([]);
});

test.each([["P0002", 404], ["23514", 409], ["22023", 400], ["42501", 403], ["unexpected", 500]])("governance error %s keeps its response contract", async (code, status) => {
  protocol.state.responses.update_profile_governance_transaction = () => Response.json({ code, message: "Sensitive upstream detail" }, { status: 400 });
  const response = await (await route()).PATCH(protocol.request("/api/profiles/bound-target", "PATCH", { weeklyCapacity: 31 }), context);
  expect(response.status).toBe(status);
  expect(JSON.stringify(await response.json())).not.toContain("Sensitive upstream detail");
});


test("local simulation still requires a real user credential before governance payload processing", async () => {
  protocol = administratorProtocol({ role: "ceo", origin: "http://localhost" });
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("REQUIRE_SUPABASE_AUTH", "false");
  vi.stubEnv("ENABLE_LOCAL_LOGIN", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost"); vi.stubEnv("SUPABASE_URL", "http://localhost");
  const { PATCH } = await importTestModule("src/app/api/profiles/[id]/route.ts", { "server-only": {} });
  const response = await PATCH(protocol.request("/api/profiles/target", "PATCH", { platformRole: "founder" }, { authorization: "", host: "localhost" }), { params: Promise.resolve({ id: "target" }) });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Anmeldung erforderlich." });
});


test("a real CEO Bearer credential retains user-RPC governance in supported local simulation", async () => {
  protocol = administratorProtocol({ role: "ceo", origin: "http://localhost" });
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("REQUIRE_SUPABASE_AUTH", "false"); vi.stubEnv("ENABLE_LOCAL_LOGIN", "true");
  protocol.state.responses.update_profile_governance_transaction = { profile: { id: "bound-target", name: "Synthetic Founder", platform_role: "founder", weekly_capacity: 31 } };
  const { PATCH } = await route();
  expect((await PATCH(protocol.request("/api/profiles/bound-target", "PATCH", { weeklyCapacity: 31 }, { host: "localhost" }), context)).status).toBe(200);
  expect(protocol.calls[0].body.p_profile_id).toBe("bound-target");
});


test("governance preserves original values including implicit deputy clears", async () => {
  protocol.state.responses.update_profile_governance_transaction = { profile: { id: "bound-target", name: "Founder", platform_role: "founder", weekly_capacity: 30 } };
  const expected = { platform_role: "deputy", deputy_for: "ceo", deputy_active_from: null, deputy_active_until: null };
  const response = await (await route()).PATCH(protocol.request("/api/profiles/bound-target", "PATCH", { platformRole: "founder", expected }), context);
  expect(response.status).toBe(200);
  expect(protocol.calls[0].body.p_profile_patch).toEqual({ platform_role: "founder", deputy_for: null, deputy_active_from: null, deputy_active_until: null, _expected: expected });
});

test("governance refuses incomplete or technical comparison fields before dispatch", async () => {
  const response = await (await route()).PATCH(protocol.request("/api/profiles/bound-target", "PATCH", { weeklyCapacity: 31, expected: { weekly_capacity: 30, auth_user_id: "foreign" } }), context);
  expect(response.status).toBe(400);
  expect(protocol.calls).toEqual([]);
});

test("governance distinguishes its actual comparison conflict from other409 outcomes", async () => {
  protocol.state.responses.update_profile_governance_transaction = () => Response.json({ code: "P0004", message: "Sensitive upstream detail" }, { status: 400 });
  const response = await (await route()).PATCH(protocol.request("/api/profiles/bound-target", "PATCH", { weeklyCapacity: 31, expected: { weekly_capacity: 30 } }), context);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ code: "profile_revision_conflict", error: "Profil wurde zwischenzeitlich geändert." });
});
