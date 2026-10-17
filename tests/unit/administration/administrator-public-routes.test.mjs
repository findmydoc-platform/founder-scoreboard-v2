import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function routes(options) {
  const protocol = administratorProtocol(options);
  return { ...protocol,
    access: await importTestModule("src/app/api/administrator-access/route.ts", { "server-only": {} }),
    eligibility: await importTestModule("src/app/api/administrator-access/profiles/[id]/route.ts", { "server-only": {} }),
    directory: await importTestModule("src/app/api/administration-data/route.ts", { "server-only": {} }),
  };
}

test("administrator inspection preserves snapshots and temporary-failure status", async () => {
  const current = await routes();
  const response = await current.access.GET(current.request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ administratorAccess: current.state.snapshot });
  current.state.snapshotError = "PGRST202";
  const failed = await current.access.GET(current.request());
  expect(failed.status).toBe(503);
  expect(await failed.json()).toEqual({ error: "Adminzugang konnte nicht geprüft werden." });
});

test("administrator activation and ending use separate fixed operations", async () => {
  const inactive = { eligible: true, active: false, expiresAt: null };
  const current = await routes({ snapshot: inactive });
  const active = { eligible: true, active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() };
  current.state.responses.activate_administrator_access = active;
  current.state.responses.end_administrator_access = inactive;
  expect(await (await current.access.POST(current.request("/", "POST", {}))).json()).toEqual({ administratorAccess: active });
  expect(await (await current.access.DELETE(current.request("/", "DELETE"))).json()).toEqual({ administratorAccess: inactive });
  expect(current.calls.map(call => call.name)).toEqual(["activate_administrator_access", "end_administrator_access"]);
});

test.each([["42501", 403], ["unexpected", 500]])("activation failure %s retains its public status", async (code, status) => {
  const current = await routes({ responses: { activate_administrator_access: () => Response.json({ code, message: "Private upstream detail" }, { status: 403 }) } });
  const response = await current.access.POST(current.request("/", "POST", {}));
  expect(response.status).toBe(status);
  expect(JSON.stringify(await response.json())).not.toContain("Private upstream detail");
});

test("eligibility validates boolean payloads before its owner-bound transaction", async () => {
  const current = await routes({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null } });
  current.state.responses.set_administrator_eligibility = { eligible: true, active: false, expiresAt: null };
  const context = { params: Promise.resolve({ id: "bound-target" }) };
  expect((await current.eligibility.PATCH(current.request("/", "PATCH", { eligible: "yes" }), context)).status).toBe(400);
  expect(current.calls).toEqual([]);
  expect((await current.eligibility.PATCH(current.request("/", "PATCH", { eligible: true }), context)).status).toBe(200);
  expect(current.calls).toEqual([{ name: "set_administrator_eligibility", body: { p_profile_id: "bound-target", p_eligible: true } }]);
});

test.each([["P0002", 404], ["42501", 403], ["unexpected", 500]])("eligibility failure %s retains its response distinction", async (code, status) => {
  const current = await routes({ role: "ceo", snapshot: { eligible: true, active: false, expiresAt: null }, responses: { set_administrator_eligibility: () => Response.json({ code }, { status: 403 }) } });
  expect((await current.eligibility.PATCH(current.request("/", "PATCH", { eligible: true }), { params: Promise.resolve({ id: "target" }) })).status).toBe(status);
});

test("the CEO directory projection excludes technical identity and delivery details without activation", async () => {
  const current = await routes({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null }, responses: {
    administrator_directory_snapshot: { people: [{ id: "person", name: "Person", platformRole: "founder", githubLogin: "hidden-login", googleChatUserId: "hidden-chat", eligible: false }], project: null },
  } });
  const response = await current.directory.GET(current.request());
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.administration.people[0]).toMatchObject({ githubLogin: "", googleChatUserId: "", notificationsEnabled: false });
  expect(body.administration.notificationEvents).toEqual([]);
  expect(body.administration.notificationDeliveries).toEqual([]);
  expect(current.calls.map(call => call.name)).toEqual(["administrator_directory_snapshot"]);
});

test("an issued administrator capability cannot call a different operation or target", async () => {
  const current = administratorProtocol({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null }, responses: { set_administrator_eligibility: {} } });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: current.request() }, action: "administration.eligibility.manage", targetProfileId: "bound-target" });
  expect(permission.ok).toBe(true);
  expect("data" in permission).toBe(false);
  expect(await permission.administrator.activate()).toMatchObject({ error: { code: "42501" } });
  await permission.administrator.setEligibility(true, "foreign-target");
  expect(current.calls[0].body.p_profile_id).toBe("bound-target");
  expect(await permission.administrator.directory.readNotificationEvents()).toMatchObject({ error: { code: "42501" } });
});


test("administrator operations reject a personal-token credential kind even with a real session bearer", async () => {
  const current = administratorProtocol();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  expect(await authorizeCredentialAction({ credential: { kind: "personal-planning-token", request: current.request() }, action: "administrator-access.activate" })).toMatchObject({ ok: false, status: 403 });
  expect(current.calls).toEqual([]);
});


test("server-rendered administration uses the same capability policy as the HTTP guard", async () => {
  vi.resetModules();
  const current = administratorProtocol({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null } });
  const jar = current.cookieJar();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {}, "next/headers": { cookies: async () => jar } });
  const rendered = await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "administration.directory.read" });
  const http = await authorizeCredentialAction({ credential: { kind: "session-request", request: current.request() }, action: "administration.directory.read" });
  expect(rendered).toMatchObject({ ok: true, authority: { capabilities: { manageAdministratorEligibility: true, technicalAdministration: false } } });
  expect(rendered.authority).toEqual(http.authority);
  current.state.role = "founder";
  expect(await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "administration.directory.read" })).toMatchObject({ ok: false, status: 403, code: "administrator_access_required" });
});

test("issued directory operations distinguish expired authority from a temporary snapshot failure", async () => {
  const current = administratorProtocol({ role: "viewer" });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: current.request() }, action: "administration.directory.read" });
  expect(permission.ok).toBe(true);
  expect(() => { permission.authority.capabilities.ceoGovernance = true; }).toThrow();
  current.state.snapshotError = "PGRST202";
  expect(await permission.administrator.directory.readNotificationEvents()).toMatchObject({ error: { code: "AUTHORIZATION_UNAVAILABLE" } });
  current.state.snapshotError = null;
  current.state.snapshot = { eligible: true, active: false, expiresAt: null };
  expect(await permission.administrator.directory.readNotificationEvents()).toMatchObject({ error: { code: "42501" } });
  expect(current.calls).toEqual([]);
});
