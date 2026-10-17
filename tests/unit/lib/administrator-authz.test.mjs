import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture(options) {
  const protocol = administratorProtocol(options);
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  return { ...protocol, authorize: (action, request) => authorizeCredentialAction({ credential: { kind: "session-request", request }, action, targetId: "synthetic-task", targetProfileId: "synthetic-target" }) };
}

test("public administrator actions use the public policy and retain named capabilities", async () => {
  const current = await fixture();
  expect(await current.authorize("administration.technical.update", current.request())).toMatchObject({ ok: true, authority: { capabilities: { technicalAdministration: true, ceoGovernance: false } } });
  current.state.role = "ceo";
  current.state.snapshot = { eligible: false, active: false, expiresAt: null };
  expect(await current.authorize("administration.eligibility.manage", current.request())).toMatchObject({ ok: true, authority: { capabilities: { technicalAdministration: false, manageAdministratorEligibility: true } } });
});

test("the correction guard never applies administrator activation to a simulated actor", async () => {
  const current = await fixture({ role: "viewer" });
  expect(await current.authorize("planning.task.update", current.request())).toMatchObject({ ok: true });
  expect(await current.authorize("planning.task.update", current.request("/", "GET", undefined, { "x-fmd-dev-profile-id": "simulated-profile" }))).toMatchObject({ ok: false, status: 403 });
});

test("local simulation is denied on deployed hosts and cannot activate administration", async () => {
  const current = await fixture();
  vi.stubEnv("REQUIRE_SUPABASE_AUTH", "false"); vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("ENABLE_LOCAL_LOGIN", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost:3000");
  expect(await current.authorize("team.read", current.request("/", "GET", undefined, { host: "app.example.test" }))).toMatchObject({ ok: false, status: 403 });
  const local = current.request("/", "GET", undefined, { host: "localhost:3000" });
  expect(await current.authorize("team.read", local)).toMatchObject({ ok: true, profile: null });
  expect(await current.authorize("administration.technical.update", local)).toMatchObject({ ok: false, status: 403, code: "administrator_access_required" });
});

test("the public administrator decision retains expiry versus eligibility denial", async () => {
  const current = await fixture();
  current.state.snapshot = { eligible: true, active: false, expiresAt: null };
  expect(await current.authorize("administration.technical.update", current.request())).toMatchObject({ ok: false, code: "administrator_access_expired" });
  current.state.snapshot = { eligible: false, active: false, expiresAt: null };
  expect(await current.authorize("administration.technical.update", current.request())).toMatchObject({ ok: false, code: "administrator_access_required" });
});
