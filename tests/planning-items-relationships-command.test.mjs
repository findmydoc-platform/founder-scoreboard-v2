import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

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
    "src/features/planning-items/model/planning-items-relationships.ts",
    {
      "server-only": {},
      "./planning-items-runner": runner,
      "./planning-items-store-supabase": supabaseStore,
    },
  );
}

async function loadRoute(run, payload) {
  return loadTranspiledModule("src/app/api/tasks/[id]/relationships/route.ts", {
    "next/server": { NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) } },
    "@/lib/api-input": { auditRequestMetadata: () => ({ request_ip: "test-ip", user_agent: "test-agent" }) },
    "@/lib/api-response": {
      apiError: (error, status) => ({ body: { error }, status }),
      requireJsonApiContext: async () => ({
        ok: true,
        payload,
        permission: { profile: { id: "ceo", platformRole: "ceo" } },
        supabase: {},
      }),
    },
    "@/lib/authz": { requirePlanningContributor: () => ({}) },
    "@/features/planning-items/model/planning-actor-context-server": {
      actorContextFromSessionAuth: () => ({ ok: true, actor }),
    },
    "@/features/planning-items/model/planning-items-relationships": {
      parseAddPlanningRelationshipPayload: (value) => ({ ok: true, value }),
      parseRemovePlanningRelationshipPayload: (value) => ({ ok: true, value }),
      addPlanningRelationshipCommand: (itemId, value) => ({ kind: "addRelationship", itemId, ...value }),
      removePlanningRelationshipCommand: (itemId, value) => ({ kind: "removeRelationship", itemId, ...value }),
      createPlanningRelationshipPlanningItems: () => ({ run }),
      planningRelationshipError: () => ({ message: "Abhängigkeit konnte nicht gespeichert werden.", status: 500 }),
      planningRelationshipFromResult: (result) => result.items[0],
    },
  });
}

function task(id, overrides = {}) {
  return {
    id,
    task_type: "deliverable",
    updated_at: "2026-08-12T10:00:00.000Z",
    owner: "owner-one",
    assignee: "owner-one",
    parent_task_id: "initiative-one",
    trashed_at: null,
    review_status: "not_requested",
    score_final: false,
    ...overrides,
  };
}

function relation(overrides = {}) {
  return {
    id: 41,
    task_id: "source",
    related_task_id: "target",
    relation_type: "blocked_by",
    note: "Wait",
    created_by: "owner-one",
    created_at: "2026-08-12T10:05:00.000Z",
    ...overrides,
  };
}

function fixture({
  source = task("source"),
  related = task("target", { owner: "owner-two", assignee: "owner-two" }),
  currentRelation = null,
  existingRelation = null,
  actorName = "Owner One",
  initiative = { id: "initiative-one", ownerId: "initiative-owner", accountableProfileId: "accountable-one" },
  reviewLocked = false,
  finalReviewLocked = false,
  commitRelation = relation(),
  commitError = null,
} = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(name, params) {
        calls.push([name, params]);
        if (name === "prepare_planning_relationship_command") {
          return {
            data: {
              source,
              related,
              relation: currentRelation,
              existingRelation,
              actorName,
              initiative,
              reviewLocked,
              finalReviewLocked,
            },
            error: null,
          };
        }
        return commitError
          ? { data: null, error: commitError }
          : { data: { operation: params.p_operation, relation: commitRelation, affectedItemIds: [commitRelation.task_id, commitRelation.related_task_id] }, error: null };
      },
    },
  };
}

test("relationship routes are transport adapters and direct authenticated writes are closed", async () => {
  const [route, model, migration, corpus] = await Promise.all([
    readFile("src/app/api/tasks/[id]/relationships/route.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-relationships.ts", "utf8"),
    readFile("supabase/migrations/20260812131418_planning_relationship_command_transaction.sql", "utf8"),
    readSupabaseSchemaContract(),
  ]);

  assert.match(route, /createPlanningRelationshipPlanningItems/);
  assert.match(route, /\.run\(/);
  assert.doesNotMatch(route, /taskRelationshipAccess|taskIdsHaveReviewLock|task_relationship_edges|github_issue_sync_status|audit_log|\.rpc\(/);
  assert.match(model, /prepare_planning_relationship_command/);
  assert.match(model, /mutate_planning_relationship_transaction/);
  assert.match(migration, /insert into public\.task_relationship_edges/i);
  assert.match(migration, /delete from public\.task_relationship_edges/i);
  assert.match(migration, /update public\.tasks[\s\S]*github_issue_sync_status = 'not_synced'/i);
  assert.match(migration, /insert into public\.audit_log/i);
  assert.match(migration, /revoke insert, update, delete on table public\.task_relationship_edges from authenticated/i);
  assert.match(migration, /grant execute on function public\.mutate_planning_relationship_transaction[^;]*to service_role/i);
  assert.match(corpus, /mutate_planning_relationship_transaction/i);
});

test("relationship transport preserves Browser POST and DELETE shapes", async () => {
  const relationResult = {
    id: 41,
    taskId: "source",
    relatedTaskId: "target",
    relationType: "blocked_by",
    note: "Wait",
    createdBy: "ceo",
    createdAt: "2026-08-12T10:05:00.000Z",
  };
  const calls = [];
  const run = async (invocation) => {
    calls.push(invocation);
    return { ok: true, status: "committed", items: [relationResult], changes: [], effects: [] };
  };

  const postRoute = await loadRoute(run, { relationType: "blocked_by", relatedTaskId: "target", note: "Wait" });
  const post = await postRoute.POST({}, { params: Promise.resolve({ id: "source" }) });
  assert.deepEqual(post, { status: 200, body: { ok: true, relation: relationResult } });

  const deleteRoute = await loadRoute(run, { relationId: 41 });
  const removed = await deleteRoute.DELETE({}, { params: Promise.resolve({ id: "source" }) });
  assert.deepEqual(removed, { status: 200, body: { ok: true, relationId: 41 } });
  assert.deepEqual(calls, [
    {
      actor,
      mode: "commit",
      command: { kind: "addRelationship", itemId: "source", relationType: "blocked_by", relatedTaskId: "target", note: "Wait" },
      requestMetadata: { requestIp: "test-ip", userAgent: "test-agent" },
    },
    {
      actor,
      mode: "commit",
      command: { kind: "removeRelationship", itemId: "source", relationId: 41 },
      requestMetadata: { requestIp: "test-ip", userAgent: "test-agent" },
    },
  ]);
});

test("payload parsing preserves relation types, trimming, optional revision, and validation messages", async () => {
  const model = await loadModel();
  const expectedUpdatedAt = "2026-08-12T10:00:00.000Z";
  assert.deepEqual(model.parseAddPlanningRelationshipPayload({
    relationType: "blocked_by",
    relatedTaskId: " target ",
    note: ` ${"x".repeat(600)} `,
    expectedUpdatedAt,
    ignored: true,
  }), {
    ok: true,
    value: { relationType: "blocked_by", relatedTaskId: "target", note: "x".repeat(500), expectedUpdatedAt },
  });
  assert.deepEqual(model.parseRemovePlanningRelationshipPayload({ relationId: "41" }), {
    ok: true,
    value: { relationId: 41 },
  });
  assert.equal(model.parseAddPlanningRelationshipPayload({ relationType: "depends", relatedTaskId: "target" }).error, "Ungültige Abhängigkeitsart.");
  assert.equal(model.parseAddPlanningRelationshipPayload({ relationType: "blocks" }).error, "Bitte eine andere Aufgabe auswählen.");
  assert.equal(model.parseRemovePlanningRelationshipPayload({ relationId: 0 }).error, "Abhängigkeit ist erforderlich.");
});

test("Preview and Commit use identical add policy and one atomic writer with deterministic effects", async () => {
  const model = await loadModel();
  for (const relationType of ["blocked_by", "blocks", "relates_to"]) {
    const current = fixture({ commitRelation: relation({ relation_type: relationType }) });
    const planning = model.createPlanningRelationshipPlanningItems(current.client);
    const command = model.addPlanningRelationshipCommand("source", {
      relationType,
      relatedTaskId: "target",
      note: "Wait",
      expectedUpdatedAt: "2026-08-12T10:00:00.000Z",
    });
    const preview = await planning.run({ actor, mode: "preview", command });
    const committed = await planning.run({
      actor,
      mode: "commit",
      command,
      requestMetadata: { requestIp: "test-ip", userAgent: "test-agent" },
    });
    assert.equal(preview.status, "previewed");
    assert.equal(committed.status, "committed");
    assert.deepEqual(preview.effects.map((effect) => effect.kind), ["audit", "githubProjection"]);
    assert.deepEqual(committed.effects.map((effect) => effect.kind), ["audit", "githubProjection"]);
    assert.equal(current.calls.filter(([name]) => name === "mutate_planning_relationship_transaction").length, 1);
    const commit = current.calls.at(-1);
    assert.deepEqual(commit, ["mutate_planning_relationship_transaction", {
      p_operation: "add",
      p_task_id: "source",
      p_related_task_id: "target",
      p_relation_type: relationType,
      p_relation_id: null,
      p_note: "Wait",
      p_expected_updated_at: "2026-08-12T10:00:00.000Z",
      p_actor_profile_id: "ceo",
      p_request_ip: "test-ip",
      p_user_agent: "test-agent",
    }]);
    assert.equal(model.planningRelationshipFromResult(committed).relationType, relationType);
  }
});

test("Founder ownership and Accountable rights stay limited to outgoing blocked_by", async () => {
  const model = await loadModel();
  const owner = { ...actor, profileId: "owner-one", platformRole: "founder" };
  const accountable = { ...actor, profileId: "accountable-one", platformRole: "founder" };
  const unrelated = { ...actor, profileId: "other-founder", platformRole: "founder" };
  const command = (relationType) => model.addPlanningRelationshipCommand("source", { relationType, relatedTaskId: "target", note: "" });

  for (const currentActor of [owner, accountable]) {
    const allowed = await model.createPlanningRelationshipPlanningItems(fixture().client).run({
      actor: currentActor,
      mode: "commit",
      command: command("blocked_by"),
    });
    assert.equal(allowed.status, "committed");
    const denied = await model.createPlanningRelationshipPlanningItems(fixture().client).run({
      actor: currentActor,
      mode: "commit",
      command: command("blocks"),
    });
    assert.equal(denied.error.code, "forbidden");
  }
  const denied = await model.createPlanningRelationshipPlanningItems(fixture().client).run({
    actor: unrelated,
    mode: "commit",
    command: command("blocked_by"),
  });
  assert.equal(denied.error.code, "forbidden");

  const outgoing = await model.createPlanningRelationshipPlanningItems(fixture({ currentRelation: relation() }).client).run({
    actor: owner,
    mode: "commit",
    command: model.removePlanningRelationshipCommand("source", { relationId: 41 }),
  });
  assert.equal(outgoing.status, "committed");
  const incoming = await model.createPlanningRelationshipPlanningItems(fixture({
    currentRelation: relation({ task_id: "target", related_task_id: "source" }),
    related: task("target"),
  }).client).run({
    actor: owner,
    mode: "commit",
    command: model.removePlanningRelationshipCommand("source", { relationId: 41 }),
  });
  assert.equal(incoming.error.code, "forbidden");
});

test("revision, duplicate, review, trash, not-found, and repeated request states stop before commit", async () => {
  const model = await loadModel();
  const add = model.addPlanningRelationshipCommand("source", {
    relationType: "blocked_by",
    relatedTaskId: "target",
    note: "",
    expectedUpdatedAt: "2026-08-12T09:00:00.000Z",
  });
  const cases = [
    [fixture(), add, "conflict", "revision"],
    [fixture({ existingRelation: relation() }), model.addPlanningRelationshipCommand("source", { relationType: "blocked_by", relatedTaskId: "target", note: "" }), "conflict", "state"],
    [fixture({ reviewLocked: true }), model.addPlanningRelationshipCommand("source", { relationType: "blocked_by", relatedTaskId: "target", note: "" }), "conflict", "state"],
    [fixture({ source: task("source", { trashed_at: "2026-08-12T11:00:00.000Z" }) }), model.addPlanningRelationshipCommand("source", { relationType: "blocked_by", relatedTaskId: "target", note: "" }), "conflict", "state"],
    [fixture({ related: null }), model.addPlanningRelationshipCommand("source", { relationType: "blocked_by", relatedTaskId: "target", note: "" }), "notFound", undefined],
    [fixture({ currentRelation: null }), model.removePlanningRelationshipCommand("source", { relationId: 41 }), "notFound", undefined],
  ];
  for (const [current, command, code, reason] of cases) {
    const result = await model.createPlanningRelationshipPlanningItems(current.client).run({ actor, mode: "commit", command });
    assert.equal(result.error.code, code);
    if (reason) assert.equal(result.error.reason, reason);
    assert.equal(current.calls.filter(([name]) => name === "mutate_planning_relationship_transaction").length, 0);
  }
});
