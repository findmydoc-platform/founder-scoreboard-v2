import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { planningRouteProtocol } from "../../helpers/planning-route-protocol.mjs";

const handler = await importTestModule("src/features/planning-items/model/planning-items-browser-task-update.ts", { "server-only": {} });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const task = { id: "task", title: "Planning revision", task_type: "deliverable", project_id: "findmydoc-founder-execution", trashed_at: null, status: "In Arbeit", approval_status: "approved", approval_revision: 2, owner: "synthetic-profile", assignee: "synthetic-profile", parent_task_id: null, review_status: "not_requested", review_owner_profile_id: "reviewer", score_final: false, sprint_id: null, score_relevant: false, updated_at: "2026-09-24T10:00:00.000Z" };
function setup(options = {}) {
  return planningRouteProtocol({ tables: { tasks: task, active_tasks: task, profiles: [], sprints: [] }, snapshot: { eligible: false, active: false, expiresAt: null }, responses: { update_browser_planning_task_transaction_v2: { task: { ...task, updated_at: "2026-09-24T11:00:00.000Z" }, activities: [] } }, ...options });
}
function update(protocol, payload = { expectedUpdatedAt: task.updated_at, title: "Changed title" }) {
  return handler.handleBrowserTaskUpdate(protocol.request("/api/tasks/task", "PATCH", payload), { params: Promise.resolve({ id: "task" }) });
}
test("Browser adapter commits the authenticated revision and maps its result", async () => {
  const protocol = setup(), response = await update(protocol), body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.task.id, "task");
  assert.equal(body.task.updatedAt, "2026-09-24T11:00:00.000Z");
  assert.deepEqual(body.activities, []);
  const call = protocol.calls.find(call => call.name === "update_browser_planning_task_transaction_v2");
  assert.equal(call.body.p_task_id, "task");
  assert.equal(call.body.p_actor_profile_id, "synthetic-profile");
  assert.equal(call.body.p_expected_updated_at, task.updated_at);
  assert.equal(call.body.p_task_patch.title, "Changed title");
});
test.each([
  ["22023", 400, "Aufgabenänderung ist ungültig."], ["42501", 403, "Aufgabenänderung ist nicht erlaubt."],
  ["P0002", 404, "Aufgabe wurde nicht gefunden."], ["P0001", 409, "Aufgabe wurde zwischenzeitlich geändert. Bitte neu laden."],
  ["XX000", 500, "Aufgabe konnte nicht gespeichert werden."],
])("Browser adapter maps transaction %s to HTTP %i", async (code, status, message) => {
  const protocol = setup({ responses: { update_browser_planning_task_transaction_v2: () => Response.json({ code, message: code === "P0001" ? "task revision conflict" : "Rejected" }, { status: 400 }) } });
  const response = await update(protocol);
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), { error: message });
});
test("Browser adapter preserves structured length errors", async () => {
  const protocol = setup(), response = await update(protocol, { expectedUpdatedAt: task.updated_at, title: "x".repeat(241) }), body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.lengthErrors[0].field, "title");
  assert.equal(body.lengthErrors[0].maximum, 240);
  assert.equal(body.lengthErrors[0].actual, 241);
  assert.equal(body.lengthErrors[0].excess, 1);
  assert.equal(body.error, body.lengthErrors[0].message);
  assert.equal(protocol.calls.some(call => call.name.includes("transaction")), false);
});
test("Browser adapter preserves expired administrator codes", async () => {
  const protocol = setup({ role: "viewer", snapshot: { eligible: true, active: true, expiresAt: new Date(Date.now()+3600000).toISOString() } });
  protocol.state.responses.update_administrator_planning_task_transaction_v2 = () => {
    protocol.state.snapshot = { eligible: true, active: false, expiresAt: null };
    return Response.json({ code: "42501", message: "active administrator access required" }, { status: 403 });
  };
  const response = await update(protocol);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "administrator_access_expired");
});
test("Browser adapter stops before revision when authorization fails", async () => {
  const protocol = setup({ profile: false });
  assert.equal((await update(protocol)).status, 403);
  assert.equal(protocol.calls.some(call => call.name.includes("transaction")), false);
});
test.each([[null, 400], [[], 400], [{ unknownField: true }, 400], [{ githubIssueSyncStatus: "synced" }, 403]])("Browser adapter rejects unsupported transport payload %j", async (payload, status) => {
  const protocol = setup();
  assert.equal((await update(protocol, payload)).status, status);
  assert.equal(protocol.calls.some(call => call.name.includes("transaction")), false);
});
test.each([{ status: "Review" }, { parentTaskId: "parent" }])("Browser adapter routes special action %j outside ordinary revision", async payload => {
  const protocol = setup();
  assert.equal((await update(protocol, payload)).status, 400);
  assert.equal(protocol.calls.some(call => call.name.includes("transaction")), false);
});
