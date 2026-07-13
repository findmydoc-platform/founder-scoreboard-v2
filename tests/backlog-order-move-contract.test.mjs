import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

async function loadBacklogOrderRoute(rpc = async () => ({ data: [], error: null })) {
  return loadTranspiledModule("src/app/api/tasks/backlog-order/route.ts", {
    "next/server": {
      NextResponse: {
        json: (body, init = {}) => ({ body, status: init.status || 200 }),
      },
    },
    "@/lib/api-input": {
      auditRequestMetadata: () => ({ request_ip: "test-ip", user_agent: "test" }),
    },
    "@/lib/api-response": {
      apiError: (error, status) => ({ body: { error }, status }),
      requireApiContext: async () => ({
        ok: true,
        permission: { profile: { id: "ceo", platformRole: "ceo" } },
        supabase: { rpc },
      }),
    },
    "@/lib/authz": { requirePlanningContributor: () => ({}) },
    "@/lib/platform": { isOperationalLeadRole: (role) => role === "ceo" },
  });
}

test("backlog moves use a guarded single-command transaction without GitHub side effects", async () => {
  const [route, apiClient, ordering, migrationCorpus, migration] = await Promise.all([
    readFile("src/app/api/tasks/backlog-order/route.ts", "utf8"),
    readFile("src/features/tasks/model/task-api-client.ts", "utf8"),
    readFile("src/features/backlog/hooks/use-backlog-ordering.ts", "utf8"),
    readSupabaseSchemaContract(),
    readFile("supabase/migrations/20260713175214_backlog_move_transaction.sql", "utf8"),
  ]);

  assert.match(route, /requirePlanningContributor/);
  assert.match(route, /isOperationalLeadRole/);
  assert.match(route, /move_backlog_task_transaction/);
  assert.match(route, /p_expected_task_updated_at/);
  assert.match(route, /p_expected_target_updated_at/);
  assert.match(route, /P0001/);
  assert.match(route, /P0003/);
  assert.doesNotMatch(route, /github_issue_sync_status|github_issue_sync_error|task_activity/);

  assert.match(apiClient, /export type BacklogMoveRequest/);
  assert.match(apiClient, /moveBacklogTaskRequest/);
  assert.match(apiClient, /expectedTaskUpdatedAt/);
  assert.match(apiClient, /expectedTargetUpdatedAt/);

  assert.match(ordering, /export type BacklogPlacement/);
  assert.match(ordering, /export type BacklogMoveAction = "up" \| "down" \| "top" \| "bottom"/);
  assert.match(ordering, /reorderTask = \(taskId: string, targetTaskId: string, placement: BacklogPlacement\)/);
  assert.match(ordering, /moveTask = \(taskId: string, action: BacklogMoveAction\)/);
  assert.match(ordering, /reorderInFlightRef/);
  assert.match(ordering, /moveBacklogTaskRequest/);

  assert.match(migrationCorpus, /create or replace function public\.move_backlog_task_transaction/i);
  assert.match(migration, /create or replace function public\.move_backlog_task_transaction/i);
  assert.match(migration, /task\.project_id = v_project_id[\s\S]*for update of task/i);
  assert.match(migration, /p_expected_task_updated_at/i);
  assert.match(migration, /p_expected_target_updated_at/i);
  assert.match(migration, /task\.backlog_reorder/i);
  assert.match(migration, /revoke all on function public\.move_backlog_task_transaction/i);
  assert.match(migration, /grant all on function public\.move_backlog_task_transaction[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /github_issue_sync_status|github_issue_sync_error|task_activity/i);
});

test("backlog move API validates both revisions and forwards one relative move", async () => {
  const rpcCalls = [];
  const { PATCH } = await loadBacklogOrderRoute(async (...args) => {
    rpcCalls.push(args);
    return { data: [{ id: "source", sortOrder: 20, updatedAt: "2026-07-13T12:00:00.000Z" }], error: null };
  });

  const invalid = await PATCH({ json: async () => ({ taskId: "source" }) });
  assert.equal(invalid.status, 400);
  assert.equal(rpcCalls.length, 0);

  const response = await PATCH({
    json: async () => ({
      taskId: "source",
      targetTaskId: "target",
      placement: "after",
      expectedTaskUpdatedAt: "2026-07-13T12:00:00.000Z",
      expectedTargetUpdatedAt: "2026-07-13T12:00:01.000Z",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0][0], "move_backlog_task_transaction");
  assert.deepEqual(rpcCalls[0][1], {
    p_task_id: "source",
    p_target_task_id: "target",
    p_placement: "after",
    p_expected_task_updated_at: "2026-07-13T12:00:00.000Z",
    p_expected_target_updated_at: "2026-07-13T12:00:01.000Z",
    p_actor_profile_id: "ceo",
    p_request_ip: "test-ip",
    p_user_agent: "test",
  });
});

test("backlog move API turns a stale active-backlog state into a conflict", async () => {
  const { PATCH } = await loadBacklogOrderRoute(async () => ({
    data: null,
    error: { code: "P0003", message: "backlog target is not active" },
  }));

  const response = await PATCH({
    json: async () => ({
      taskId: "source",
      targetTaskId: "target",
      placement: "before",
      expectedTaskUpdatedAt: "2026-07-13T12:00:00.000Z",
      expectedTargetUpdatedAt: "2026-07-13T12:00:01.000Z",
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error, "Backlog hat sich geändert. Bitte neu laden.");
});
