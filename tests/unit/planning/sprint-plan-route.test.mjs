import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { planningRouteProtocol } from "../../helpers/planning-route-protocol.mjs";
const { POST } = await importTestModule("src/app/api/sprints/route.ts", { "server-only": {} });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const row = { id: "sprint-1", name: "Sprint 1", status: "planning", start_date: "2098-01-01", end_date: "2098-01-14", review_due_at: "2098-01-16T23:59:00Z", score_locked: false, updated_at: "opaque/displayed" };
const payload = { firstSprintNumber: 1, anchorStartDate: "2099-01-01", rhythmWeeks: 2, horizonWeeks: 1, targetSprintNumber: 1, expectedSprints: [{ id: row.id, updatedAt: "opaque/displayed" }] };
function protocol(options = {}) { const tables = { projects: { review_objection_window_hours: 72 }, sprints: [row], active_tasks: [], ...options.tables }; if (Array.isArray(tables.sprints)) tables.sprints = Response.json(tables.sprints, { headers: { "content-range": tables.sprints.length ? `0-${tables.sprints.length - 1}/${tables.sprints.length}` : "*/0" } }); return planningRouteProtocol({ role: "ceo", tables: { projects: { review_objection_window_hours: 72 }, sprints: [row], active_tasks: [] }, responses: { create_sprint_plan_with_review_window_transaction: body => { expect(body.p_sprints[0].expected_updated_at).toBe("opaque/displayed"); return Response.json([{ ...row, updated_at: "opaque/receipt" }]); } }, ...options, tables }); }
test("plan creation passes the displayed opaque version to the existing transaction and confirms only returned rows", async () => {
  const p = protocol(); const response = await POST(p.request("/api/sprints", "POST", payload));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ sprints: [{ id: row.id, updatedAt: "opaque/receipt" }] });
  const write = p.calls.find(call => call.name === "create_sprint_plan_with_review_window_transaction");
  expect(write.body.p_meetings).toHaveLength(2);
  expect(write.body.p_sprints[0].review_due_at).toBe("2099-01-16T22:59:59.999Z");
});
test("only the plan transaction revision/protection conflict receives the plan conflict code", async () => {
 const p=protocol({ responses: { create_sprint_plan_with_review_window_transaction: () => Response.json({ code: "P0001", message: "parallel" }, { status: 400 }) } });
 const response=await POST(p.request("/api/sprints", "POST", payload)); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ code: "sprint_plan_changed_or_protected" });
});
test.each([undefined, [], [{ id: row.id }]])("an existing affected Sprint never obtains a fresh save-time version: %j", async expectedSprints => {
 const p=protocol(); const response=await POST(p.request("/api/sprints", "POST", { ...payload, expectedSprints })); expect([400,409]).toContain(response.status); expect(p.calls.some(call=>call.name==="create_sprint_plan_with_review_window_transaction")).toBe(false);
});
test("locked and task-referenced Sprints are preserved even without a displayed version", async () => {
 for (const assigned of [false,true]) { const p=protocol({ tables: { projects: { review_objection_window_hours: 48 }, sprints: [{ ...row, score_locked: !assigned }], active_tasks: assigned ? [{ sprint_id: row.id }] : [] } }); const response=await POST(p.request("/api/sprints", "POST", { ...payload, expectedSprints: [] })); expect(await response.json()).toMatchObject({ ok:true,sprints:[] }); expect(p.calls.some(call=>call.name==="create_sprint_plan_with_review_window_transaction")).toBe(false); }
});
test.each(["founder","administrator"])("plan creation remains restricted for %s", async role=>{ const p=protocol({role}); expect((await POST(p.request("/api/sprints","POST",payload))).status).toBe(403); });

test("a stale displayed basis is a genuine version conflict before any mutation", async () => { const p=protocol({ tables: { projects:{review_objection_window_hours:48},sprints:[{...row,updated_at:"opaque/newer"}],active_tasks:[] } }); const response=await POST(p.request("/api/sprints","POST",payload)); expect(response.status).toBe(409); expect(await response.json()).toMatchObject({code:"sprint_plan_conflict"}); expect(p.calls.some(call=>call.name==="create_sprint_plan_with_review_window_transaction")).toBe(false); });

test("a removed displayed Sprint with a custom identity is not silently recreated under a new identity",async()=>{const p=protocol({tables:{projects:{review_objection_window_hours:48},sprints:[],active_tasks:[]}});const response=await POST(p.request("/api/sprints","POST",{...payload,expectedSprints:[{id:"custom-plan",number:1,updatedAt:"opaque/displayed"}]}));expect(response.status).toBe(409);expect(p.calls.some(call=>call.name==="create_sprint_plan_with_review_window_transaction")).toBe(false);});

test("a deputy can create a genuinely new Sprint and receives only the confirmed transaction subset",async()=>{const p=protocol({role:"deputy",tables:{projects:{review_objection_window_hours:48},sprints:[],active_tasks:[]},responses:{create_sprint_plan_with_review_window_transaction:body=>{expect(body.p_sprints).toHaveLength(1);expect(body.p_sprints[0].expected_updated_at).toBeNull();return Response.json([{...row,updated_at:"opaque/new"}]);}}});const response=await POST(p.request("/api/sprints","POST",{...payload,expectedSprints:[]}));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({sprints:[{id:row.id,updatedAt:"opaque/new"}]});});

test("an incomplete planned-Sprint read cannot create another numeric plan from missing membership",async()=>{const p=protocol({tables:{sprints:Response.json([row],{headers:{"content-range":"0-0/2"}})}});const response=await POST(p.request("/api/sprints","POST",payload));expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:"sprint_plan_incomplete"});expect(p.calls.some(call=>call.name==="create_sprint_plan_with_review_window_transaction")).toBe(false);});
