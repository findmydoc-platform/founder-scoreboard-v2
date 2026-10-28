import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
const basis = "2099-01-01T00:00:00.000Z";
const row = { id: 7, title: "Original", category: "other", starts_at: "2099-01-12T10:00:00.000Z", ends_at: null, location: "", description: "", audience_mode: "all", participant_profile_ids: [], reminder_days_before: 7, reminder_generated_at: null, status: "planned", created_by: "synthetic-profile", created_at: basis, updated_at: basis };
for (const conflict of [false, true]) test(`event updates compare the captured revision atomically (conflict=${conflict})`, async () => {
  const protocol = administratorProtocol({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null } }), authFetch = globalThis.fetch;
  let writes = 0, audits = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/founder_events") {
      if (request.method === "GET") return Response.json(row);
      writes++; assert.equal(url.searchParams.get("updated_at"), `eq.${basis}`);
      return Response.json(conflict ? null : { ...row, ...await request.json() });
    }
    if (url.pathname === "/rest/v1/audit_log") { audits++; return new Response(null, { status: 201 }); }
    return authFetch(request);
  });
  const { PATCH } = await importTestModule("src/app/api/events/[id]/route.ts", { "server-only": {}, "next/cache": { revalidateTag() {} } });
  const response = await PATCH(protocol.request("/api/events/7", "PATCH", { title: "Changed", expectedUpdatedAt: basis }), { params: Promise.resolve({ id: "7" }) });
  assert.equal(response.status, conflict ? 409 : 200); const body = await response.json();
  if (conflict) assert.equal(body.code, "event_version_conflict"); else assert.equal(body.event.title, "Changed");
  assert.equal(writes, 1); assert.equal(audits, conflict ? 0 : 1);
});
for (const auditFailure of ["response", "throw"]) test(`confirmed event creation survives a later audit ${auditFailure} failure`, async () => {
  const protocol = administratorProtocol({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null } }), authFetch = globalThis.fetch; let writes = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/founder_events") { writes++; return Response.json({ ...row, ...await request.json() }); }
    if (url.pathname === "/rest/v1/audit_log") { if (auditFailure === "throw") throw new Error("Synthetic lost audit"); return Response.json({ message: "Synthetic audit denied", code: "42501" }, { status: 403 }); }
    return authFetch(request);
  });
  const { POST } = await importTestModule("src/app/api/events/route.ts", { "server-only": {}, "next/cache": { revalidateTag() {} } });
  const response = await POST(protocol.request("/api/events", "POST", { title: "Created", startsAt: row.starts_at }));
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.event.title, "Created"); assert.equal(body.code, "event_saved_audit_unconfirmed"); assert.ok(body.warning); assert.equal(writes, 1);
});

test("Event reads expose the exact normalized start-time range and reject malformed ranges", async () => {
  const protocol = administratorProtocol({ role: "viewer", snapshot: { eligible: false, active: false, expiresAt: null } }), authFetch = globalThis.fetch; const eventQueries = [];
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) { if (url.pathname === "/rest/v1/founder_events") eventQueries.push(url.searchParams); return Response.json([]); }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/events-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: fn => fn } });
  const from = "2099-01-01T01:00:00+01:00", to = "2099-02-01T01:00:00+01:00";
  const response = await GET(protocol.request(`/api/events-data?${new URLSearchParams({ from, to })}`)); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).model.coverage, { range: { from: "2099-01-01T00:00:00.000Z", to: "2099-02-01T00:00:00.000Z" }, completeness: "complete" });
  assert.ok(eventQueries.some(query => query.getAll("starts_at").includes("gte.2099-01-01T00:00:00.000Z") && query.getAll("starts_at").includes("lt.2099-02-01T00:00:00.000Z")));
  const count = eventQueries.length; assert.equal((await GET(protocol.request("/api/events-data?from=invalid"))).status, 400); assert.equal(eventQueries.length, count);
});
