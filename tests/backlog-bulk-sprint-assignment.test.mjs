import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const actor = { profileId: "ceo", platformRole: "ceo", credential: { kind: "session" } };
const validPayload = {
  assignments: [
    { taskId: "deliverable-one", expectedUpdatedAt: "2026-08-03T12:00:00.000Z" },
    { taskId: "deliverable-two", expectedUpdatedAt: "2026-08-03T12:01:00.000Z" },
  ],
  sprintId: "sprint-10",
};

async function loadModel() {
  const storeContract = await loadTranspiledModule("src/features/planning-items/model/planning-items-store.ts");
  const runner = await loadTranspiledModule("src/features/planning-items/model/planning-items-runner.ts");
  const supabaseStore = await loadTranspiledModule("src/features/planning-items/model/planning-items-store-supabase.ts", {
    "server-only": {}, "./planning-items-store": storeContract,
  });
  return loadTranspiledModule("src/features/planning-items/model/planning-items-sprint-assignment.ts", {
    "./planning-items-runner": runner,
    "./planning-items-store-supabase": supabaseStore,
  });
}

async function loadRoute(run, apiContext) {
  return loadTranspiledModule("src/app/api/tasks/bulk-sprint-assignment/route.ts", {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/api-input": { auditRequestMetadata: () => ({ request_ip: "test-ip", user_agent: "test-agent" }) },
    "@/lib/api-response": {
      apiError: (error, status) => ({ body: { error }, status }),
      requireApiContext: async () => apiContext || { ok: true, permission: { profile: { id: "ceo", platformRole: "ceo" } }, supabase: {} },
    },
    "@/lib/authz": { requireOperationalLead: () => ({}) },
    "@/features/planning-items/model/planning-actor-context-server": { actorContextFromSessionAuth: () => ({ ok: true, actor }) },
    "@/features/planning-items/model/planning-items-sprint-assignment": {
      parseSprintAssignmentRequest: (value) => value?.assignments ? value : "Sprint-Zuordnung ist ungültig.",
      sprintAssignmentCommand: (value) => ({ kind: "canonicalSprintAssignment", value }),
      createSprintAssignmentPlanningItems: () => ({ run }),
      sprintAssignmentUpdatesFromChanges: (changes) => changes[0]?.after || [],
      sprintAssignmentError: (error) => error.code === "conflict"
        ? { message: "Der Ziel-Sprint ist gesperrt.", status: 409 }
        : { message: "Sprint-Zuordnungen konnten nicht gespeichert werden.", status: 500 },
    },
  });
}

function item(id, revision, overrides = {}) {
  return { id, task_type: "deliverable", updated_at: revision, trashed_at: null, approval_status: "approved", status: "Offen", assignee: "owner", owner: "owner", parent_task_id: "initiative", sprint_id: null, ...overrides };
}

function fixture({ items, parents, sprints, rpcResult = { data: [], error: null } }) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) { return { select() { return { async in(_column, ids) {
        if (table === "tasks") return { data: ids.includes("initiative") ? parents : items, error: null };
        return { data: sprints, error: null };
      } }; } }; },
      async rpc(...args) { calls.push(args); return rpcResult; },
    },
  };
}

test("Sprint assignment parser covers single and bulk inputs", async () => {
  const model = await loadModel();
  assert.deepEqual(model.parseSprintAssignmentRequest(validPayload), validPayload);
  assert.deepEqual(model.parseSprintAssignmentRequest({ assignments: [validPayload.assignments[0]], sprintId: "sprint-10" }), { assignments: [validPayload.assignments[0]], sprintId: "sprint-10" });
  assert.equal(model.parseSprintAssignmentRequest(null), "Sprint-Zuordnung ist ungültig.");
  assert.equal(model.parseSprintAssignmentRequest({ assignments: [], sprintId: "sprint-10" }), "Wähle zwischen 1 und 100 Deliverables sowie einen Sprint aus.");
  assert.equal(model.parseSprintAssignmentRequest({ assignments: [validPayload.assignments[0], validPayload.assignments[0]], sprintId: "sprint-10" }), "Sprint-Zuordnung ist ungültig.");
});

test("route is transport-only and preserves Browser invocation and response", async () => {
  const calls = [];
  const route = await loadRoute(async (invocation) => {
    calls.push(invocation);
    return { ok: true, status: "committed", changes: [{ field: "sprintAssignment", after: [{ id: "deliverable-one", sprintId: "sprint-10", scoreRelevant: true, updatedAt: "2026-08-03T12:02:00.000Z" }] }] };
  });
  const response = await route.PATCH({ json: async () => validPayload });
  assert.equal(response.status, 200);
  assert.equal(response.body.updates.length, 1);
  assert.deepEqual(calls, [{ actor, mode: "commit", command: { kind: "canonicalSprintAssignment", value: validPayload }, requestMetadata: { requestIp: "test-ip", userAgent: "test-agent" } }]);

  const source = await readFile("src/app/api/tasks/bulk-sprint-assignment/route.ts", "utf8");
  assert.match(source, /createSprintAssignmentPlanningItems/);
  assert.match(source, /\.run\(/);
  assert.match(source, /requireOperationalLead/);
  assert.doesNotMatch(source, /\.rpc\(|assign_backlog_tasks_to_sprint_transaction/);
});

test("module shares Preview and Commit policy and issues one atomic writer call", async () => {
  const model = await loadModel();
  const rows = validPayload.assignments.map((entry) => item(entry.taskId, entry.expectedUpdatedAt));
  const parent = item("initiative", "2026-08-03T11:00:00.000Z", { task_type: "initiative" });
  const updates = rows.map((row) => ({ id: row.id, sprintId: "sprint-10", scoreRelevant: true, updatedAt: "2026-08-03T12:02:00.000Z" }));
  const db = fixture({ items: rows, parents: [parent], sprints: [{ id: "sprint-10", score_locked: false }], rpcResult: { data: updates, error: null } });
  const planning = model.createSprintAssignmentPlanningItems(db.client);
  const command = model.sprintAssignmentCommand(validPayload);
  const preview = await planning.run({ actor, mode: "preview", command });
  const commit = await planning.run({ actor, mode: "commit", command });
  assert.equal(preview.status, "previewed");
  assert.equal(commit.status, "committed");
  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0][1].p_assignments, [...validPayload.assignments].sort((a, b) => a.taskId.localeCompare(b.taskId)));
});

test("role, stale revision, and locked Sprint stop before writes", async () => {
  const model = await loadModel();
  const rows = validPayload.assignments.map((entry) => item(entry.taskId, entry.expectedUpdatedAt));
  const parent = item("initiative", "2026-08-03T11:00:00.000Z", { task_type: "initiative" });
  const command = model.sprintAssignmentCommand(validPayload);
  for (const [actorValue, itemRows, sprintRows, expected] of [
    [{ ...actor, platformRole: "founder" }, rows, [{ id: "sprint-10", score_locked: false }], "forbidden"],
    [actor, [{ ...rows[0], updated_at: "stale" }, rows[1]], [{ id: "sprint-10", score_locked: false }], "conflict"],
    [actor, rows, [{ id: "sprint-10", score_locked: true }], "conflict"],
  ]) {
    const db = fixture({ items: itemRows, parents: [parent], sprints: sprintRows });
    const result = await model.createSprintAssignmentPlanningItems(db.client).run({ actor: actorValue, mode: "commit", command });
    assert.equal(result.error.code, expected);
    assert.equal(db.calls.length, 0);
  }
});

test("transaction remains service-only, actor-guarded, ordered, and atomic", async () => {
  const migration = await readFile("supabase/migrations/20260812123345_authorize_sprint_assignment_transaction.sql", "utf8");
  const moduleSource = await readFile("src/features/planning-items/model/planning-items-sprint-assignment.ts", "utf8");
  assert.match(migration, /v_actor_role not in \('ceo', 'deputy'\)/i);
  assert.match(migration, /raise exception using errcode = 'P0015'/i);
  assert.match(migration, /order by task\.id\s+for update/i);
  assert.ok(migration.indexOf("for v_assignment in") < migration.indexOf("update public.tasks as task"));
  assert.match(migration, /revoke all on function public\.assign_backlog_tasks_to_sprint_transaction[^;]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.assign_backlog_tasks_to_sprint_transaction[^;]*to service_role/i);
  assert.match(moduleSource, /assign_backlog_tasks_to_sprint_transaction/);
  assert.doesNotMatch(moduleSource, /github|outbox/i);
});

test("route preserves upstream auth failure and mapped errors", async () => {
  const denied = { ok: false, response: { body: { error: "Nicht erlaubt" }, status: 403 } };
  assert.deepEqual(await (await loadRoute(async () => ({}), denied)).PATCH({ json: async () => validPayload }), denied.response);
  const route = await loadRoute(async () => ({ ok: false, error: { code: "conflict", reason: "state" } }));
  const response = await route.PATCH({ json: async () => validPayload });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, "Der Ziel-Sprint ist gesperrt.");
});
