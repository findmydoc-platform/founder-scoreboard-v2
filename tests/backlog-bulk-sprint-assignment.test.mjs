import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

async function loadBulkRoute({ apiContext, rpc } = {}) {
  const operationalLeadGuard = () => ({ ok: true });
  let receivedGuard = null;
  const route = await loadTranspiledModule("src/app/api/tasks/bulk-sprint-assignment/route.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, headers: init.headers, status: init.status || 200 }),
      },
    },
    "@/lib/api-input": {
      auditRequestMetadata: () => ({ request_ip: "test-ip", user_agent: "test-agent" }),
    },
    "@/lib/api-response": {
      apiError: (error, status) => ({ body: { error }, status }),
      requireApiContext: async (_request, guard) => {
        receivedGuard = guard;
        return apiContext || {
          ok: true,
          permission: { profile: { id: "ceo", platformRole: "ceo" } },
          supabase: { rpc: rpc || (async () => ({ data: [], error: null })) },
        };
      },
    },
    "@/lib/authz": { requireOperationalLead: operationalLeadGuard },
  });
  return { ...route, operationalLeadGuard, receivedGuard: () => receivedGuard };
}

const validPayload = {
  assignments: [
    { taskId: "deliverable-one", expectedUpdatedAt: "2026-08-03T12:00:00.000Z" },
    { taskId: "deliverable-two", expectedUpdatedAt: "2026-08-03T12:01:00.000Z" },
  ],
  sprintId: "sprint-10",
};

test("bulk Sprint assignment parser accepts one target and unique current Deliverables", async () => {
  const { parseBulkSprintAssignment } = await loadBulkRoute();

  assert.deepEqual(parseBulkSprintAssignment(validPayload), validPayload);
  assert.equal(parseBulkSprintAssignment(null), "Sprint-Zuordnung ist ungültig.");
  assert.equal(parseBulkSprintAssignment({ assignments: [], sprintId: "sprint-10" }), "Wähle zwischen 1 und 100 Deliverables sowie einen Sprint aus.");
  assert.equal(parseBulkSprintAssignment({
    assignments: [validPayload.assignments[0], validPayload.assignments[0]],
    sprintId: "sprint-10",
  }), "Sprint-Zuordnung ist ungültig.");
  assert.equal(parseBulkSprintAssignment({
    assignments: [{ taskId: "deliverable-one", expectedUpdatedAt: "not-a-date" }],
    sprintId: "sprint-10",
  }), "Sprint-Zuordnung ist ungültig.");
});

test("bulk Sprint assignment API is operational-lead guarded and forwards one atomic command", async () => {
  const rpcCalls = [];
  const route = await loadBulkRoute({
    rpc: async (...args) => {
      rpcCalls.push(args);
      return {
        data: validPayload.assignments.map((assignment) => ({
          id: assignment.taskId,
          sprintId: validPayload.sprintId,
          scoreRelevant: true,
          updatedAt: "2026-08-03T12:02:00.000Z",
        })),
        error: null,
      };
    },
  });

  const response = await route.PATCH({ json: async () => validPayload });

  assert.equal(route.receivedGuard(), route.operationalLeadGuard);
  assert.equal(response.status, 200);
  assert.equal(response.body.updates.length, 2);
  assert.equal(rpcCalls.length, 1);
  assert.deepEqual(rpcCalls[0], ["assign_backlog_tasks_to_sprint_transaction", {
    p_assignments: validPayload.assignments,
    p_sprint_id: "sprint-10",
    p_actor_profile_id: "ceo",
    p_request_ip: "test-ip",
    p_user_agent: "test-agent",
  }]);
});

test("bulk Sprint assignment API preserves auth failures and maps stale or ineligible data safely", async () => {
  const denied = { ok: false, response: { body: { error: "Nicht erlaubt" }, status: 403 } };
  const deniedRoute = await loadBulkRoute({ apiContext: denied });
  assert.deepEqual(await deniedRoute.PATCH({ json: async () => validPayload }), denied.response);

  for (const [code, status, message] of [
    ["P0001", 409, "Mindestens ein Deliverable wurde zwischenzeitlich geändert. Bitte neu laden."],
    ["P0011", 409, "Nur freigegebene Deliverables können einem Sprint zugeordnet werden."],
    ["P0014", 409, "Für mindestens ein Deliverable fehlt eine freigegebene Initiative."],
    ["unexpected", 500, "Sprint-Zuordnungen konnten nicht gespeichert werden."],
  ]) {
    const route = await loadBulkRoute({ rpc: async () => ({ data: null, error: { code } }) });
    const response = await route.PATCH({ json: async () => validPayload });
    assert.equal(response.status, status);
    assert.equal(response.body.error, message);
  }
});

test("bulk Sprint assignment transaction validates every item before updating and is service-only", async () => {
  const [migration, route, apiClient, command, menu, table] = await Promise.all([
    readFile("supabase/migrations/20260803141929_bulk_sprint_assignment_transaction.sql", "utf8"),
    readFile("src/app/api/tasks/bulk-sprint-assignment/route.ts", "utf8"),
    readFile("src/features/tasks/model/task-api-client.ts", "utf8"),
    readFile("src/features/backlog/hooks/use-backlog-bulk-sprint-assignment.ts", "utf8"),
    readFile("src/features/backlog/molecules/backlog-sprint-actions.tsx", "utf8"),
    readFile("src/features/backlog/molecules/backlog-rank-table.tsx", "utf8"),
  ]);

  assert.match(migration, /create or replace function public\.assign_backlog_tasks_to_sprint_transaction/i);
  assert.match(migration, /v_assignment_count < 1 or v_assignment_count > 100/i);
  assert.match(migration, /cardinality\(v_task_ids\) <> v_assignment_count/i);
  assert.match(migration, /order by task\.id\s+for update/i);
  assert.match(migration, /v_task\.updated_at <> \(v_assignment ->> 'expectedUpdatedAt'\)::timestamptz/i);
  assert.match(migration, /v_task\.task_type <> 'deliverable'/i);
  assert.match(migration, /parent\.task_type = 'initiative'[\s\S]*parent\.approval_status = 'approved'/i);
  assert.match(migration, /v_target_sprint\.score_locked/i);
  assert.match(migration, /v_source_locked/i);
  assert.ok(migration.indexOf("for v_assignment in") < migration.indexOf("update public.tasks as task"), "All-item validation must begin before writes.");
  assert.match(migration, /task\.sprint\.bulk_assigned/i);
  assert.match(migration, /revoke all on function public\.assign_backlog_tasks_to_sprint_transaction[\s\S]*from authenticated/i);
  assert.match(migration, /grant execute on function public\.assign_backlog_tasks_to_sprint_transaction[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /github|outbox/i);

  assert.match(route, /requireOperationalLead/);
  assert.match(route, /assign_backlog_tasks_to_sprint_transaction/);
  assert.match(apiClient, /assignBacklogTasksToSprintRequest/);
  assert.match(command, /refreshPlanningData\(\)\.catch/);
  assert.match(command, /setData\(\(current\)/);
  assert.match(menu, /BacklogBulkSprintAssignmentMenu/);
  assert.match(table, /Mehrfachauswahl für Sprint-Zuordnung/);
  assert.match(table, /Die Sprint-Zuordnung wird gemeinsam oder gar nicht gespeichert/);
});
