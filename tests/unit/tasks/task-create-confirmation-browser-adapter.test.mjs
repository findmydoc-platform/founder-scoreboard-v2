import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { planningRouteProtocol } from "../../helpers/planning-route-protocol.mjs";

const { handleBrowserTaskCreate } = await importTestModule("src/features/planning-items/model/planning-items-browser-task-create.ts", { "server-only": {} });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const parent = { id: "initiative", task_type: "initiative", approval_status: "approved", owner: "synthetic-profile" };
const created = { id: "created", title: "New proposal", task_type: "deliverable", parent_task_id: parent.id, approval_status: "proposed", approval_revision: 1, review_status: "not_requested", score_final: false, updated_at: "opaque/created", sprint_id: null };
const payload = { creationRequestId: "11111111-1111-4111-8111-111111111111", title: "New proposal", taskType: "deliverable", parentTaskId: parent.id, ownerId: "synthetic-profile", githubRepo: "findmydoc-platform/management" };
function setup({ approvalFails = false, ...options } = {}) {
  return planningRouteProtocol({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null },
    tables: { tasks: parent, active_tasks: parent, profiles: [], planning_item_raci_assignments: null }, responses: {
      create_planning_task_transaction: { task: created, relation: null, relatedTask: null },
      prepare_planning_approval_command: { task: created, parent, actorRole: "ceo", profiles: [] },
      mutate_planning_approval_command_transaction: approvalFails ? () => Response.json({ code: "P0001", message: "Changed approval basis" }, { status: 400 }) : { task: { ...created, approval_status: "approved", approval_revision: 2, updated_at: "opaque/approved" } },
    }, ...options,
  });
}

test("ordinary task creation remains proposed without a Sprint", async () => {
  const protocol = setup();
  const response = await handleBrowserTaskCreate(protocol.request("/api/tasks", "POST", payload));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.task.approvalStatus, "proposed");
  assert.equal(body.task.sprintId, "");
  assert.equal(protocol.calls.some(call => call.name === "mutate_planning_approval_command_transaction"), false);
});
test("the existing explicit CEO create-and-approve path preserves its confirmed approval", async () => {
  const protocol = setup();
  const response = await handleBrowserTaskCreate(protocol.request("/api/tasks", "POST", { ...payload, approveNow: true }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.task.approvalStatus, "approved");
  assert.equal(body.task.updatedAt, "opaque/approved");
  assert.equal(body.task.sprintId, "");
});
test("an approval failure returns the already committed creation while preserving the existing error and HTTP status", async () => {
  const protocol = setup({ approvalFails: true });
  const response = await handleBrowserTaskCreate(protocol.request("/api/tasks", "POST", { ...payload, approveNow: true }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.error, "Deliverable konnte nicht freigegeben werden.");
  assert.equal(body.code, "task_created_approval_failed");
  assert.equal(body.task.id, created.id);
  assert.equal(body.task.approvalStatus, "proposed");
  assert.equal(body.task.updatedAt, "opaque/created");
  assert.equal(protocol.calls.filter(call => call.name === "create_planning_task_transaction").length, 1);
});
test.each([{ role: "founder" }, { profile: false }])("unauthorized create-and-approve never dispatches creation: %j", async options => {
  const protocol = setup(options);
  const response = await handleBrowserTaskCreate(protocol.request("/api/tasks", "POST", { ...payload, approveNow: true }));
  assert.equal(response.status, 403);
  assert.equal(protocol.calls.some(call => call.name === "create_planning_task_transaction"), false);
});
test("a disallowed repository is rejected before creation", async () => {
  const protocol = setup();
  const response = await handleBrowserTaskCreate(protocol.request("/api/tasks", "POST", { ...payload, githubRepo: "unapproved/example" }));
  assert.equal(response.status, 400);
  assert.equal(protocol.calls.some(call => call.name === "create_planning_task_transaction"), false);
});
