import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture(options = {}) {
  const protocol = administratorProtocol(options);
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  return { ...protocol, authorize: action => authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action, targetId: "synthetic-task", targetProfileId: "synthetic-target" }) };
}

test("a known administrator deadline cannot be prolonged by an active snapshot received late", async () => {
  const current = await fixture({ snapshot: { eligible: true, active: true, expiresAt: new Date(Date.now() - 1).toISOString() } });
  expect(await current.authorize("administration.technical.update")).toMatchObject({ ok: false, status: 403, code: "administrator_access_expired" });
});


test.each([
  ["ceo", "planning.sprint.lock", true], ["founder", "planning.sprint.lock", false], ["deputy", "planning.sprint.lock", false], ["viewer", "team.read", true],
  ["ceo", "tools.create", true], ["founder", "tools.create", true], ["deputy", "tools.create", true], ["viewer", "tools.create", false],
  ["ceo", "planning.sprint.assign", true], ["deputy", "planning.sprint.assign", true], ["founder", "planning.sprint.assign", false], ["viewer", "planning.sprint.assign", false], ["unknown", "team.read", false],
])("%s retains its %s role boundary", async (role, action, allowed) => {
  const current = await fixture({ role });
  expect((await current.authorize(action)).ok).toBe(allowed);
});

test("an active administrator receives correction without CEO governance", async () => {
  const current = await fixture({ role: "viewer" });
  expect(await current.authorize("planning.task.update")).toMatchObject({ ok: true, authority: { capabilities: { operationalCorrection: true, ceoGovernance: false } } });
  expect(await current.authorize("tools.create")).toMatchObject({ ok: false, status: 403 });
  expect(await current.authorize("planning.sprint.lock")).toMatchObject({ ok: false, status: 403 });
});

test("ending or expiring activation removes administrator capabilities on the next action", async () => {
  const current = await fixture();
  expect(await current.authorize("administration.technical.update")).toMatchObject({ ok: true });
  current.state.snapshot = { eligible: true, active: false, expiresAt: null };
  expect(await current.authorize("administration.technical.update")).toMatchObject({ ok: false, code: "administrator_access_expired" });
  current.state.snapshot = { eligible: false, active: false, expiresAt: null };
  expect(await current.authorize("administration.technical.update")).toMatchObject({ ok: false, code: "administrator_access_required" });
});

test("CEO eligibility management does not require administrator activation", async () => {
  const current = await fixture({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null } });
  expect(await current.authorize("administration.eligibility.manage")).toMatchObject({ ok: true, authority: { capabilities: { manageAdministratorEligibility: true, technicalAdministration: false } } });
  expect(await current.authorize("administration.technical.update")).toMatchObject({ ok: false, code: "administrator_access_required" });
});

test("optional snapshot failure retains base planning permission while required administration fails closed", async () => {
  const current = await fixture({ snapshotError: "PGRST202" });
  expect(await current.authorize("planning.task.update")).toMatchObject({ ok: true, profile: { platformRole: "founder" } });
  expect(await current.authorize("administration.technical.update")).toEqual({ ok: false, status: 403, error: "Adminzugang konnte nicht geprüft werden." });
});

test("unmapped or ambiguous identities cannot acquire role authority", async () => {
  const unmapped = await fixture({ profile: false });
  expect(await unmapped.authorize("team.read")).toMatchObject({ ok: false, status: 403 });
  const ambiguous = await fixture({ profileError: true });
  expect(await ambiguous.authorize("team.read")).toMatchObject({ ok: false, status: 403 });
});
