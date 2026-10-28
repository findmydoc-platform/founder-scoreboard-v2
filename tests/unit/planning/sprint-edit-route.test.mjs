import { expect, test, afterEach, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { planningRouteProtocol } from "../../helpers/planning-route-protocol.mjs";
const { PATCH } = await importTestModule("src/app/api/sprints/[id]/route.ts", { "server-only": {} });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const current = { id: "sprint", project_id: "findmydoc-founder-execution", name: "Sprint shown", status: "planning", start_date: "2026-10-01", end_date: "2026-10-14", review_due_at: "2026-10-15T12:00:00Z", score_locked: false, updated_at: "opaque/current" };
function setup(options = {}) { return planningRouteProtocol({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null }, tables: { sprints: current }, responses: { update_sprint_schedule_transaction: { ...current, status: "active", updated_at: "opaque/saved" } }, ...options }); }
test("the Sprint route passes the original displayed basis to its transaction and returns the confirmed opaque basis", async () => {
  const protocol = setup();
  const response = await PATCH(protocol.request("/api/sprints/sprint", "PATCH", { status: "active", expectedUpdatedAt: "opaque/shown" }), { params: Promise.resolve({ id: "sprint" }) });
  expect(response.status).toBe(200);
  expect(protocol.calls.find(call => call.name === "update_sprint_schedule_transaction").body.p_expected_updated_at).toBe("opaque/shown");
  expect(await response.json()).toMatchObject({ sprint: { status: "active", updatedAt: "opaque/saved" } });
});

const context = { params: Promise.resolve({ id: "sprint" }) };
test.each(["ceo", "deputy"])("ordinary Sprint status edits preserve authorized role %s", async role => {
  const protocol = setup({ role });
  expect((await PATCH(protocol.request("/api/sprints/sprint", "PATCH", { status: "active", expectedUpdatedAt: current.updated_at }), context)).status).toBe(200);
});
test.each([{ role: "founder" }, { profile: false }])("Sprint edits deny unauthorized or unmapped callers before the transaction: %j", async options => {
  const protocol = setup(options);
  expect((await PATCH(protocol.request("/api/sprints/sprint", "PATCH", { status: "active", expectedUpdatedAt: current.updated_at }), context)).status).toBe(403);
  expect(protocol.calls.some(call => call.name === "update_sprint_schedule_transaction")).toBe(false);
});
test.each([{ status: "invalid", expectedUpdatedAt: current.updated_at }, { status: "active" }, { reviewDueAt: "2026-10-20T00:00:00Z", expectedUpdatedAt: current.updated_at }, { startDate: "2026-11-01", endDate: "2026-10-01", expectedUpdatedAt: current.updated_at }])("invalid Sprint input never reaches the schedule transaction: %j", async payload => {
  const protocol = setup();
  expect((await PATCH(protocol.request("/api/sprints/sprint", "PATCH", payload), context)).status).toBe(400);
  expect(protocol.calls.some(call => call.name === "update_sprint_schedule_transaction")).toBe(false);
});
test.each([["P0001", "sprint_revision_conflict"], ["P0003", "sprint_locked"], ["P0004", "sprint_protected"]])("transaction failure %s has the distinct Sprint conflict code %s", async (code, expected) => {
  const protocol = setup({ responses: { update_sprint_schedule_transaction: () => Response.json({ code, message: "Changed" }, { status: 400 }) } });
  const response = await PATCH(protocol.request("/api/sprints/sprint", "PATCH", { status: "active", expectedUpdatedAt: current.updated_at }), context);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: expected });
});
test("locked and missing Sprints retain their existing early guards", async () => {
  for (const [row, status] of [[{ ...current, score_locked: true }, 409], [null, 404]]) {
    const protocol = setup({ tables: { sprints: row } });
    expect((await PATCH(protocol.request("/api/sprints/sprint", "PATCH", { status: "active", expectedUpdatedAt: current.updated_at }), context)).status).toBe(status);
    expect(protocol.calls.some(call => call.name === "update_sprint_schedule_transaction")).toBe(false);
  }
});
