import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const actor = {
  profileId: "ceo",
  platformRole: "ceo",
  credential: { kind: "session" },
};

async function loadModel() {
  const storeContract = await loadTranspiledModule("src/features/planning-items/model/planning-items-store.ts");
  const runner = await loadTranspiledModule("src/features/planning-items/model/planning-items-runner.ts");
  const supabaseStore = await loadTranspiledModule(
    "src/features/planning-items/model/planning-items-store-supabase.ts",
    { "server-only": {}, "./planning-items-store": storeContract },
  );
  return loadTranspiledModule(
    "src/features/planning-items/model/planning-items-empty-epic-delete.ts",
    {
      "server-only": {},
      "./planning-items-runner": runner,
      "./planning-items-store-supabase": supabaseStore,
    },
  );
}

function epic(overrides = {}) {
  return {
    id: "epic-one",
    project_id: "findmydoc-founder-execution",
    task_type: "epic",
    title: "Empty Epic",
    description: "Can be removed.",
    owner: "ceo",
    status: "Offen",
    target_date: "2026-12-31",
    sort_order: 20,
    created_at: "2026-08-12T09:00:00.000Z",
    updated_at: "2026-08-12T10:00:00.000Z",
    trashed_at: null,
    parent_task_id: null,
    ...overrides,
  };
}

function fixture({ item = epic(), descendants = [], stored = null, rpcResult } = {}) {
  const rpcCalls = [];
  const allTasks = item ? [item, ...descendants] : descendants;
  const descendantIds = new Set();
  let frontier = item ? [item.id] : [];
  while (frontier.length) {
    const parents = new Set(frontier);
    frontier = descendants
      .filter((row) => parents.has(row.parent_task_id) && !descendantIds.has(row.id))
      .map((row) => row.id);
    for (const id of frontier) descendantIds.add(id);
  }
  const children = {
    initiatives: descendants.filter((row) => descendantIds.has(row.id) && row.task_type === "initiative").length,
    tasks: descendants.filter((row) => descendantIds.has(row.id) && ["deliverable", "sub_issue"].includes(row.task_type)).length,
  };
  const client = {
    from(table) {
      let columns = "";
      const filters = new Map();
      const builder = {
        select(value) { columns = value; return builder; },
        eq(column, value) { filters.set(column, value); return builder; },
        is(column, value) { filters.set(column, value); return builder; },
        limit() { return builder; },
        async maybeSingle() {
          if (table === "team_planning_item_delete_requests") return { data: stored, error: null };
          if (table === "tasks" && filters.get("id") === item?.id) {
            return { data: columns === "id" ? { id: item.id } : item, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve, reject) {
          let data = [];
          if (table === "tasks") data = allTasks;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return builder;
    },
    async rpc(name, params) {
      if (name === "prepare_empty_epic_delete") {
        return { data: { item, children }, error: null };
      }
      const args = [name, params];
      rpcCalls.push(args);
      return rpcResult || {
        data: {
          replayed: false,
          itemType: "epic",
          item,
          children: { initiatives: 0, tasks: 0 },
        },
        error: null,
      };
    },
  };
  return { client, rpcCalls };
}



test("Preview and commit share policy while commit uses one atomic Browser RPC", async () => {
  const model = await loadModel();
  const source = epic();
  const state = fixture({ item: source });
  const planning = model.createEmptyEpicDeletePlanningItems(state.client);
  const command = model.emptyEpicDeleteCommand(source.id, source.updated_at);
  const preview = await planning.run({ actor, mode: "preview", command });
  const committed = await planning.run({
    actor,
    mode: "commit",
    command,
    requestMetadata: { requestIp: "test-ip", userAgent: "test-agent" },
  });

  assert.equal(preview.status, "previewed");
  assert.equal(model.emptyEpicDeletePreview(preview).canDelete, true);
  assert.equal(committed.status, "committed");
  assert.equal(state.rpcCalls.length, 1);
  assert.deepEqual(state.rpcCalls[0], ["delete_empty_epic_with_audit_transaction", {
    p_task_id: source.id,
    p_expected_updated_at: source.updated_at,
    p_actor_profile_id: "ceo",
    p_request_ip: "test-ip",
    p_user_agent: "test-agent",
  }]);
  assert.deepEqual(model.emptyEpicDeleteTeamItem(committed), {
    itemType: "epic",
    item: {
      id: source.id,
      itemType: "epic",
      title: source.title,
      description: source.description,
      targetDate: source.target_date,
      status: source.status,
      ownerId: source.owner,
      sortOrder: 20,
      approvalStatus: null,
      updatedAt: source.updated_at,
    },
    children: { initiatives: 0, tasks: 0 },
  });
});

test("non-empty Epics preview as invalid and never reach a writer", async () => {
  const model = await loadModel();
  const source = epic();
  const initiative = {
    id: "initiative-one",
    parent_task_id: source.id,
    task_type: "initiative",
    trashed_at: null,
  };
  const deliverable = {
    id: "deliverable-one",
    parent_task_id: initiative.id,
    task_type: "deliverable",
    trashed_at: null,
  };
  for (const current of [fixture({ item: source, descendants: [initiative, deliverable] })]) {
    const planning = model.createEmptyEpicDeletePlanningItems(current.client);
    const command = model.emptyEpicDeleteCommand(source.id, source.updated_at);
    const preview = await planning.run({ actor, mode: "preview", command });
    const committed = await planning.run({ actor, mode: "commit", command });
    assert.equal(preview.status, "previewed");
    assert.equal(model.emptyEpicDeletePreview(preview).canDelete, false);
    assert.equal(model.emptyEpicDeletePreview(preview).code, "EPIC_NOT_EMPTY");
    assert.equal(committed.ok, false);
    assert.equal(committed.error.code, "conflict");
    assert.equal(current.rpcCalls.length, 0);
  }
});

test("role, token scope, revision, idempotency, and replay boundaries fail closed", async () => {
  const model = await loadModel();
  const source = epic();
  const command = model.emptyEpicDeleteCommand(source.id, source.updated_at);
  const sessionFixture = fixture({ item: source });
  const planning = model.createEmptyEpicDeletePlanningItems(sessionFixture.client);

  const founder = await planning.run({ actor: { ...actor, platformRole: "founder" }, mode: "commit", command });
  const stale = await planning.run({ actor, mode: "commit", command: model.emptyEpicDeleteCommand(source.id, "2026-08-12T09:59:00.000Z") });
  assert.equal(founder.error.code, "forbidden");
  assert.equal(stale.error.reason, "revision");
  assert.equal(sessionFixture.rpcCalls.length, 0);

  const tokenActor = {
    ...actor,
    credential: { kind: "planningToken", tokenId: "11111111-1111-4111-8111-111111111111", scopes: [] },
  };
  const noScope = await planning.run({ actor: tokenActor, mode: "commit", command, idempotencyKey: "22222222-2222-4222-8222-222222222222" });
  assert.equal(noScope.error.code, "forbidden");

  const replayHash = model.emptyEpicDeleteHash({ itemId: source.id, expectedUpdatedAt: source.updated_at });
  const replayFixture = fixture({
    item: null,
    stored: {
      request_hash: replayHash,
      contract_version: 3,
      response: { itemType: "epic", item: source, children: { initiatives: 0, tasks: 0 } },
    },
  });
  const replayPlanning = model.createEmptyEpicDeletePlanningItems(replayFixture.client);
  const authorizedToken = {
    ...tokenActor,
    credential: { ...tokenActor.credential, scopes: ["write:planning-items:delete-empty"] },
  };
  const replay = await replayPlanning.run({
    actor: authorizedToken,
    mode: "commit",
    command,
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(replay.status, "committed");
  assert.equal(replay.replayed, true);
  assert.equal(replayFixture.rpcCalls.length, 0);

  const legacyReplayFixture = fixture({
    item: null,
    stored: {
      request_hash: replayHash,
      contract_version: 2,
      response: { itemType: "epic", item: source, children: { initiatives: 0, tasks: 0 } },
    },
  });
  const legacyReplay = await model.createEmptyEpicDeletePlanningItems(legacyReplayFixture.client).run({
    actor: authorizedToken,
    mode: "commit",
    command,
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(legacyReplay.error.reason, "idempotency");
  assert.equal(legacyReplayFixture.rpcCalls.length, 0);

  const inactiveFixture = fixture({
    item: source,
    rpcResult: { data: null, error: { code: "P0004", message: "planning items token is inactive" } },
  });
  const inactive = await model.createEmptyEpicDeletePlanningItems(inactiveFixture.client).run({
    actor: authorizedToken,
    mode: "commit",
    command,
    idempotencyKey: "22222222-2222-4222-8222-222222222223",
  });
  assert.deepEqual(inactive.error, { code: "forbidden", reason: "planningTokenInactive" });

  const conflictFixture = fixture({
    item: null,
    stored: { request_hash: "different", contract_version: 3, response: { itemType: "epic", item: source } },
  });
  const conflict = await model.createEmptyEpicDeletePlanningItems(conflictFixture.client).run({
    actor: authorizedToken,
    mode: "commit",
    command,
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(conflict.error.reason, "idempotency");
  assert.equal(conflictFixture.rpcCalls.length, 0);
});
