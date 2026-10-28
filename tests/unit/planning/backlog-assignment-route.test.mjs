import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { planningRouteProtocol } from "../../helpers/planning-route-protocol.mjs";
const handler = await importTestModule("src/features/planning-items/model/planning-items-browser-task-update.ts", { "server-only": {} });
const bulk = await importTestModule("src/app/api/tasks/bulk-sprint-assignment/route.ts", { "server-only": {} });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const revision = "2026-10-28T00:00:00.000Z", sprintRevision = "2026-10-28T00:01:00.000Z";
const task = { id: "a", title: "Deliverable", task_type: "deliverable", project_id: "findmydoc-founder-execution", updated_at: revision, status: "Offen", approval_status: "approved", approval_revision: 1, parent_task_id: "initiative", owner: "synthetic-profile", assignee: "synthetic-profile", review_status: "not_requested", score_final: false, sprint_id: null };
function setup(admin = false) { return planningRouteProtocol({ role: admin ? "viewer" : "ceo", snapshot: { eligible: admin, active: admin, expiresAt: admin ? new Date(Date.now() + 3600000).toISOString() : null }, tables: { tasks: (_request,url) => url.searchParams.get("id")?.includes("initiative") ? (url.searchParams.get("id")?.startsWith("eq.") ? { ...task, id: "initiative", task_type: "initiative" } : [{ ...task, id: "initiative", task_type: "initiative" }]) : (url.searchParams.get("id")?.startsWith("eq.") ? task : [task]), active_tasks: (_request,url) => url.searchParams.get("id")?.includes("initiative") ? { ...task, id: "initiative", task_type: "initiative" } : task, profiles: [], sprints: (_request,url) => url.searchParams.get("id")?.startsWith("eq.") ? { id: "sprint", score_locked: false, updated_at: sprintRevision } : [{ id: "sprint", score_locked: false, updated_at: sprintRevision }] }, responses: { update_browser_planning_task_transaction_v2: { task: { ...task, sprint_id: "sprint", score_relevant: true, updated_at: sprintRevision }, activities: [] }, update_administrator_planning_task_transaction_v2: { task: { ...task, sprint_id: "sprint", updated_at: sprintRevision }, activities: [] }, assign_backlog_tasks_to_sprint_transaction: [{ id: "a", sprintId: "sprint", scoreRelevant: true, updatedAt: sprintRevision }] } }); }
test.each([false,true])("single assignment forwards the displayed Sprint basis through the existing RPC (administrator %s)", async admin => {
 const protocol = setup(admin); const response = await handler.handleBrowserTaskUpdate(protocol.request("/api/tasks/a", "PATCH", { expectedUpdatedAt: revision, sprintId: "sprint", expectedSprintUpdatedAt: sprintRevision }), { params: Promise.resolve({ id: "a" }) });
 assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); const call = protocol.calls.find(call => call.name === (admin ? "update_administrator_planning_task_transaction_v2" : "update_browser_planning_task_transaction_v2")); assert.equal(call.body.p_task_patch.__expected_sprint_updated_at, sprintRevision);
});
test("bulk assignment retains its domain path and transfers the displayed target version without changing RPC signatures", async () => {
 const protocol = setup(); const response = await bulk.PATCH(protocol.request("/api/tasks/bulk-sprint-assignment", "PATCH", { assignments: [{ taskId: "a", expectedUpdatedAt: revision }], sprintId: "sprint", expectedSprintUpdatedAt: sprintRevision }));
 assert.equal(response.status, 200); assert.equal(protocol.calls.find(call => call.name === "assign_backlog_tasks_to_sprint_transaction").body.p_assignments[0].expectedSprintUpdatedAt, sprintRevision);
});
test.each(["single", "bulk"])("%s assignment identifies target-Sprint revision conflict separately from lock and session failure", async kind => {
 const protocol = setup(); const name = kind === "single" ? "update_browser_planning_task_transaction_v2" : "assign_backlog_tasks_to_sprint_transaction"; protocol.state.responses[name] = () => Response.json({ code: "P0018", message: "Sprint changed" }, { status: 400 });
 const payload = kind === "single" ? { expectedUpdatedAt: revision, sprintId: "sprint", expectedSprintUpdatedAt: sprintRevision } : { assignments: [{ taskId: "a", expectedUpdatedAt: revision }], sprintId: "sprint", expectedSprintUpdatedAt: sprintRevision };
 const response = kind === "single" ? await handler.handleBrowserTaskUpdate(protocol.request("/api/tasks/a", "PATCH", payload), { params: Promise.resolve({ id: "a" }) }) : await bulk.PATCH(protocol.request("/api/tasks/bulk-sprint-assignment", "PATCH", payload));
 assert.equal(response.status, 409, JSON.stringify(await response.clone().json())); assert.equal((await response.json()).code, "sprint_revision_conflict");
});
