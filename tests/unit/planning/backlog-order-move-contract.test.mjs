import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { planningRouteProtocol } from "../../helpers/planning-route-protocol.mjs";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
import { importTestModule } from "../../helpers/vitest-module.mjs";

const actor = {
  profileId: "ceo",
  platformRole: "ceo",
  credential: { kind: "session" },
};

async function loadBacklogOrderRoute(fail = false) {
  const source = row("source", 10, "2026-08-12T10:00:00.000Z"), target = row("target", 20, "2026-08-12T10:01:00.000Z");
  const protocol = planningRouteProtocol({ role: "ceo", tables: { tasks: [source, target], active_tasks: [source, target] }, responses: {
    move_backlog_task_transaction: () => fail ? Response.json({ code: "P0001", message: "Conflict" }, { status: 409 })
      : Response.json([{ id: "source", sortOrder: 20, updatedAt: "2026-08-12T12:00:00.000Z" }]),
  } });
  const route = await importTestModule("src/app/api/tasks/backlog-order/route.ts", { "server-only": {} });
  return { ...protocol, PATCH: async payload => route.PATCH(protocol.request("/api/tasks/backlog-order", "PATCH", payload, { "x-forwarded-for": "192.0.2.1", "user-agent": "synthetic-agent" })) };
}

async function loadBacklogMoveModule() {
  const storeContract = await importTestModule("src/features/planning-items/model/planning-items-store.ts");
  const runner = await importTestModule("src/features/planning-items/model/planning-items-runner.ts");
  const supabaseStore = await importTestModule(
    "src/features/planning-items/model/planning-items-store-supabase.ts",
    { "server-only": {}, "./planning-items-store": storeContract },
  );
  return importTestModule(
    "src/features/planning-items/model/planning-items-backlog-move.ts",
    {
      "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
      "./planning-items-runner": runner,
      "./planning-items-store-supabase": supabaseStore,
    },
  );
}

function row(id, sortOrder, updatedAt, overrides = {}) {
  return {
    id,
    project_id: "project-1",
    task_type: "deliverable",
    status: "Offen",
    sort_order: sortOrder,
    updated_at: updatedAt,
    trashed_at: null,
    ...overrides,
  };
}

function supabaseFixture({ requested, active, rpcResult = { data: [], error: null } }) {
  const rpcCalls = [];
  return {
    rpcCalls,
    client: {
      from(table) {
        return {
          select() {
            if (table === "tasks") {
              return { async in() { return { data: requested, error: null }; } };
            }
            const orderedQuery = {
              eq() { return orderedQuery; },
              neq() { return orderedQuery; },
              async order() { return { data: active, error: null }; },
            };
            return orderedQuery;
          },
        };
      },
      async rpc(...args) {
        rpcCalls.push(args);
        return rpcResult;
      },
    },
  };
}



test("Browser adapter preserves validation, invocation metadata, and response shape", async () => {
  const protocol = await loadBacklogOrderRoute();
  const invalid = await protocol.PATCH({});
  assert.equal(invalid.status, 400);
  assert.equal(protocol.calls.length, 0);
  const move = { taskId: "source", targetTaskId: "target", placement: "after", expectedTaskUpdatedAt: "2026-08-12T10:00:00.000Z", expectedTargetUpdatedAt: "2026-08-12T10:01:00.000Z" };
  const response = await protocol.PATCH(move);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, updates: [{ id: "source", sortOrder: 20, updatedAt: "2026-08-12T12:00:00.000Z" }] });
  assert.deepEqual(protocol.calls[0], { name: "move_backlog_task_transaction", body: {
    p_task_id: "source", p_target_task_id: "target", p_placement: "after", p_expected_task_updated_at: move.expectedTaskUpdatedAt,
    p_expected_target_updated_at: move.expectedTargetUpdatedAt, p_actor_profile_id: "synthetic-profile", p_request_ip: "192.0.2.1", p_user_agent: "synthetic-agent",
  } });
});

test("module uses identical Preview and Commit policy and commits through one RPC", async () => {
  const model = await loadBacklogMoveModule();
  const sourceRevision = "2026-08-12T10:00:00.000Z";
  const targetRevision = "2026-08-12T10:01:00.000Z";
  const source = row("source", 10, sourceRevision);
  const targetRow = row("target", 20, targetRevision);
  const other = row("other", 30, "2026-08-12T10:02:00.000Z");
  const fixture = supabaseFixture({
    requested: [source, targetRow],
    active: [source, targetRow, other],
    rpcResult: {
      data: [
        { id: "target", sortOrder: 10, updatedAt: "2026-08-12T12:00:00.000Z" },
        { id: "source", sortOrder: 20, updatedAt: "2026-08-12T12:00:00.000Z" },
      ],
      error: null,
    },
  });
  const planning = model.createBacklogMovePlanningItems(fixture.client);
  const move = {
    taskId: "source",
    targetTaskId: "target",
    placement: "after",
    expectedTaskUpdatedAt: sourceRevision,
    expectedTargetUpdatedAt: targetRevision,
  };
  const command = model.backlogMoveCommand(move);
  const preview = await planning.run({ actor, mode: "preview", command });
  const committed = await planning.run({
    actor,
    mode: "commit",
    command,
    requestMetadata: { requestIp: "test-ip", userAgent: "test" },
  });

  assert.equal(preview.status, "previewed");
  assert.equal(committed.status, "committed");
  assert.equal(fixture.rpcCalls.length, 1);
  assert.deepEqual(fixture.rpcCalls[0], ["move_backlog_task_transaction", {
    p_task_id: "source",
    p_target_task_id: "target",
    p_placement: "after",
    p_expected_task_updated_at: sourceRevision,
    p_expected_target_updated_at: targetRevision,
    p_actor_profile_id: "ceo",
    p_request_ip: "test-ip",
    p_user_agent: "test",
  }]);
  assert.deepEqual(model.backlogMoveUpdatesFromChanges(committed.changes), fixture.rpcCalls.length ? [
    { id: "target", sortOrder: 10, updatedAt: "2026-08-12T12:00:00.000Z" },
    { id: "source", sortOrder: 20, updatedAt: "2026-08-12T12:00:00.000Z" },
  ] : []);
});

test("module denies role, stale revision, and inactive state before the writer", async () => {
  const model = await loadBacklogMoveModule();
  const source = row("source", 10, "2026-08-12T10:00:00.000Z");
  const targetRow = row("target", 20, "2026-08-12T10:01:00.000Z");
  const fixture = supabaseFixture({ requested: [source, targetRow], active: [source, targetRow] });
  const planning = model.createBacklogMovePlanningItems(fixture.client);
  const valid = model.backlogMoveCommand({
    taskId: "source",
    targetTaskId: "target",
    placement: "before",
    expectedTaskUpdatedAt: source.updated_at,
    expectedTargetUpdatedAt: targetRow.updated_at,
  });

  const forbidden = await planning.run({ actor: { ...actor, platformRole: "founder" }, mode: "commit", command: valid });
  const stale = await planning.run({
    actor,
    mode: "commit",
    command: { ...valid, action: { ...valid.action, expectedRevision: "stale" } },
  });
  const inactiveFixture = supabaseFixture({
    requested: [source, row("target", 20, targetRow.updated_at, { status: "Erledigt" })],
    active: [source],
  });
  const inactive = await model.createBacklogMovePlanningItems(inactiveFixture.client)
    .run({ actor, mode: "commit", command: valid });

  assert.deepEqual(forbidden, { ok: false, error: { code: "forbidden", reason: "backlogOrderRequiresOperationalLead" } });
  assert.deepEqual(stale, { ok: false, error: { code: "conflict", reason: "revision" } });
  assert.deepEqual(inactive, { ok: false, error: { code: "conflict", reason: "state" } });
  assert.equal(fixture.rpcCalls.length, 0);
  assert.equal(inactiveFixture.rpcCalls.length, 0);
});

test("Browser error mapping remains stable", async () => {
  const protocol = await loadBacklogOrderRoute(true);
  const response = await protocol.PATCH({ taskId: "source", targetTaskId: "target", placement: "after", expectedTaskUpdatedAt: "2026-08-12T10:00:00.000Z", expectedTargetUpdatedAt: "2026-08-12T10:01:00.000Z" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "Backlog wurde parallel geändert. Bitte neu laden.");
});
