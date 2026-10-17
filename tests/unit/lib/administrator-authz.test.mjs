import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture(options) {
  const protocol = administratorProtocol(options);
  const authz = await importTestModule("src/lib/authz.ts", { "server-only": {} });
  return { ...protocol, authz };
}

test("compatibility administrator guards use the public policy and retain named capabilities", async () => {
  const current = await fixture();
  expect(await current.authz.requireActiveAdministrator(current.request())).toMatchObject({ ok: true, authority: { capabilities: { technicalAdministration: true, ceoGovernance: false } } });
  current.state.role = "ceo";
  current.state.snapshot = { eligible: false, active: false, expiresAt: null };
  expect(await current.authz.requireAdministratorEligibilityManager(current.request())).toMatchObject({ ok: true, authority: { capabilities: { technicalAdministration: false, manageAdministratorEligibility: true } } });
});

test("the correction guard never applies administrator activation to a simulated actor", async () => {
  const current = await fixture({ role: "viewer" });
  expect(await current.authz.requirePlanningContributorOrActiveAdministrator(current.request())).toMatchObject({ ok: true });
  expect(await current.authz.requirePlanningContributorOrActiveAdministrator(current.request("/", "GET", undefined, { "x-fmd-dev-profile-id": "simulated-profile" }))).toMatchObject({ ok: false, status: 403 });
});

test("local simulation is denied on deployed hosts and cannot activate administration", async () => {
  const current = await fixture();
  vi.stubEnv("REQUIRE_SUPABASE_AUTH", "false"); vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("ENABLE_LOCAL_LOGIN", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:3000");
  expect(await current.authz.requireTeamMember(current.request("/", "GET", undefined, { host: "app.example.test" }))).toMatchObject({ ok: false, status: 403 });
  const local = current.request("/", "GET", undefined, { host: "localhost:3000" });
  expect(await current.authz.requireTeamMember(local)).toEqual({ ok: true, profile: null });
  expect(await current.authz.requireActiveAdministrator(local)).toMatchObject({ ok: false, status: 403, code: "administrator_access_required" });
});

test("the legacy late-failure adapter retains expiry versus eligibility denial", async () => {
  const current = await fixture();
  const client = { rpc: async () => ({ data: current.state.snapshot, error: null }) };
  current.state.snapshot = { eligible: true, active: false, expiresAt: null };
  expect(await current.authz.resolveAdministratorAccessFailure(client)).toMatchObject({ ok: false, code: "administrator_access_expired" });
  current.state.snapshot = { eligible: false, active: false, expiresAt: null };
  expect(await current.authz.resolveAdministratorAccessFailure(client)).toMatchObject({ ok: false, code: "administrator_access_required" });
});
