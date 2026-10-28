import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
const basis = "2099-01-01T00:00:00.000Z";
const row = { id: "tool-1", name: "Original", category: "tool", kind: "Werkzeuge", description: "Useful tool description", url: "https://tools.example.test/", owner: "Team", status: "active", is_curated: false, preview_image_url: null, preview_image_source: "none", sort_order: 10, updated_at: basis };
const draft = { name: "Changed", category: "tool", description: row.description, url: row.url, owner: "Team", expectedUpdatedAt: basis };
for (const conflict of [false, true]) test(`Tool PATCH compares the captured revision atomically (conflict=${conflict})`, async () => {
  const protocol = administratorProtocol({ role: "founder", snapshot: { eligible: false, active: false, expiresAt: null } }), authFetch = globalThis.fetch; let writes = 0, audits = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/fmd_tools") {
      if (request.method === "GET") return Response.json(row);
      writes++; assert.equal(url.searchParams.get("updated_at"), `eq.${basis}`); return Response.json(conflict ? null : { ...row, ...await request.json() });
    }
    if (url.pathname === "/rest/v1/audit_log") { audits++; return new Response(null, { status: 201 }); }
    return authFetch(request);
  });
  const { PATCH } = await importTestModule("src/app/api/tools/[id]/route.ts", { "server-only": {}, "next/cache": { revalidateTag() {} } });
  const response = await PATCH(protocol.request("/api/tools/tool-1", "PATCH", draft), { params: Promise.resolve({ id: "tool-1" }) }); const body = await response.json();
  assert.equal(response.status, conflict ? 409 : 200); assert.equal(writes, 1); assert.equal(audits, conflict ? 0 : 1);
  if (conflict) assert.equal(body.code, "tool_version_conflict"); else { assert.equal(body.tool.name, "Changed"); assert.ok(body.tool.updatedAt); }
});
for (const auditFailure of ["response", "throw"]) test(`confirmed Tool creation survives a subsequent ${auditFailure} audit failure`, async () => {
  const protocol = administratorProtocol({ role: "founder", snapshot: { eligible: false, active: false, expiresAt: null } }), authFetch = globalThis.fetch; let writes = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/fmd_tools") { if (request.method === "GET") return Response.json({ sort_order: 10 }); writes++; return Response.json({ ...row, ...await request.json() }); }
    if (url.pathname === "/rest/v1/audit_log") { if (auditFailure === "throw") throw new Error("Lost audit response"); return Response.json({ code: "42501", message: "Audit unavailable" }, { status: 403 }); }
    return authFetch(request);
  });
  const { POST } = await importTestModule("src/app/api/tools/route.ts", { "server-only": {}, "next/cache": { revalidateTag() {} } });
  const response = await POST(protocol.request("/api/tools", "POST", draft)); assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.code, "tool_saved_audit_unconfirmed"); assert.equal(body.tool.name, "Changed"); assert.ok(body.tool.updatedAt); assert.ok(body.warning); assert.equal(writes, 1);
});
