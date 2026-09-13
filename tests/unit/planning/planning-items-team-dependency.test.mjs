import assert from "node:assert/strict";
import { test } from "vitest";

import { importTestModule } from "../../helpers/vitest-module.mjs";

const expectedUpdatedAt = "2026-09-12T10:00:00.000Z";
const actor = { profileId: "ceo", platformRole: "ceo" };

async function loadModule({ relationship, result, targets, rpc } = {}) {
  const loads = [];
  const dependencyModule = await importTestModule(
    "src/features/planning-items/model/planning-items-team-dependency.ts",
    {
      "server-only": {},
      "./planning-item-update": {
        loadPlanningItemUpdateTarget: async (_supabase, itemId) => {
          loads.push(itemId);
          return targets?.[itemId] || { ok: false, status: 404, error: "missing" };
        },
        mapPlanningItemDatabaseRow: (_itemType, row) => row,
      },
      "./planning-items-relationships": {
        addPlanningRelationshipCommand: (_itemId, payload) => ({ payload }),
        removePlanningRelationshipCommand: (_itemId, payload) => ({ payload }),
        createPlanningRelationshipPlanningItems: () => ({
          run: async () => result,
        }),
        planningRelationshipError: () => ({ status: 409, message: "relationship error" }),
        planningRelationshipFromResult: () => relationship,
      },
    },
  );
  return { dependencyModule, loads, supabase: { rpc: rpc || (async () => ({ data: null, error: null })) } };
}

test("dependency request hashes use the normalized command and distinguish real changes", async () => {
  const { dependencyModule } = await loadModule();
  const contract = await importTestModule(
    "src/features/planning-items/model/planning-items-team-dependency-contract.ts",
  );
  const omitted = contract.parseTeamPlanningDependency({
    operation: "add",
    direction: "blocked_by",
    relatedItemId: " blocker ",
  });
  const empty = contract.parseTeamPlanningDependency({
    note: "   ",
    relatedItemId: "blocker",
    direction: "blocked_by",
    operation: "add",
  });
  assert.equal(omitted.ok, true);
  assert.equal(empty.ok, true);
  const omittedHash = dependencyModule.planningDependencyUpdateHash("blocked", expectedUpdatedAt, omitted.dependency);
  const emptyHash = dependencyModule.planningDependencyUpdateHash("blocked", expectedUpdatedAt, empty.dependency);
  assert.equal(omittedHash, emptyHash);
  assert.equal(omittedHash, dependencyModule.planningDependencyUpdateHash("blocked", expectedUpdatedAt, {
    note: "",
    relatedItemId: "blocker",
    direction: "blocked_by",
    operation: "add",
  }));
  assert.notEqual(omittedHash, dependencyModule.planningDependencyUpdateHash("blocked", expectedUpdatedAt, {
    operation: "add",
    direction: "blocks",
    relatedItemId: "blocker",
    note: "",
  }));
  assert.notEqual(omittedHash, dependencyModule.planningDependencyUpdateHash("blocked", expectedUpdatedAt, {
    operation: "add",
    direction: "blocked_by",
    relatedItemId: "blocker",
    note: "Different",
  }));
});

test("new dependency preview exposes a placeholder ID and only real GitHub sync transitions", async () => {
  const relationship = {
    id: 0,
    taskId: "blocked",
    relatedTaskId: "blocker",
    relationType: "blocked_by",
    note: "Wait",
    createdBy: "ceo",
    createdAt: "",
  };
  const result = {
    ok: true,
    status: "previewed",
    changes: [{ field: "planningRelationship", before: null, after: relationship }],
    warnings: [],
  };
  const targets = {
    blocked: {
      ok: true,
      itemType: "deliverable",
      row: { id: "blocked", github_issue_sync_status: "synced" },
      strategy: undefined,
      raciAssignments: [],
    },
    blocker: {
      ok: true,
      itemType: "initiative",
      row: { id: "blocker", github_issue_sync_status: "not_applicable" },
      strategy: undefined,
      raciAssignments: [],
    },
  };
  const { dependencyModule, loads, supabase } = await loadModule({ relationship, result, targets });
  const preview = await dependencyModule.buildTeamPlanningDependencyPreview({
    actor,
    itemId: "blocked",
    expectedUpdatedAt,
    dependency: { operation: "add", direction: "blocked_by", relatedItemId: "blocker", note: "Wait" },
    supabase,
  });

  assert.equal(preview.ok, true);
  assert.deepEqual(preview.preview.dependencyChange, {
    operation: "add",
    changed: true,
    relationship: {
      relationshipId: null,
      blockedItemId: "blocked",
      blockingItemId: "blocker",
      note: "Wait",
    },
  });
  assert.deepEqual(preview.preview.systemEffects.map(({ field, before, after }) => ({ field, before, after })), [
    { field: "dependencies", before: null, after: preview.preview.dependencyChange.relationship },
    { field: "githubIssueSyncStatus:blocked", before: "synced", after: "not_synced" },
  ]);
  assert.deepEqual(loads, ["blocked", "blocker"]);
});

test("inverse duplicate preview preserves the stored relationship and has no side effects", async () => {
  const relationship = {
    id: 41,
    taskId: "blocked",
    relatedTaskId: "blocker",
    relationType: "blocked_by",
    note: "Stored note",
    createdBy: "ceo",
    createdAt: expectedUpdatedAt,
  };
  const result = {
    ok: true,
    status: "previewed",
    changes: [{ field: "planningRelationship", before: relationship, after: relationship }],
    warnings: [{ message: "Die Aufgabenabhängigkeit besteht bereits und bleibt unverändert." }],
  };
  const targets = {
    blocker: {
      ok: true,
      itemType: "deliverable",
      row: { id: "blocker", github_issue_sync_status: "synced" },
      strategy: undefined,
      raciAssignments: [],
    },
  };
  const { dependencyModule, loads, supabase } = await loadModule({ relationship, result, targets });
  const preview = await dependencyModule.buildTeamPlanningDependencyPreview({
    actor,
    itemId: "blocker",
    expectedUpdatedAt,
    dependency: { operation: "add", direction: "blocks", relatedItemId: "blocked", note: "Replacement" },
    supabase,
  });

  assert.equal(preview.ok, true);
  assert.deepEqual(preview.preview.dependencyChange.relationship, {
    relationshipId: 41,
    blockedItemId: "blocked",
    blockingItemId: "blocker",
    note: "Stored note",
  });
  assert.equal(preview.preview.dependencyChange.changed, false);
  assert.deepEqual(preview.preview.systemEffects, []);
  assert.deepEqual(loads, ["blocker"]);
});

test("dependency commit calls the atomic receipt RPC directly and maps provider conflicts", async () => {
  const calls = [];
  const transaction = { commandKind: "dependency", itemType: "deliverable", item: { id: "blocked" } };
  const { dependencyModule, supabase } = await loadModule({
    rpc: async (name, params) => {
      calls.push([name, params]);
      return { data: transaction, error: null };
    },
  });
  const committed = await dependencyModule.commitTeamPlanningDependency({
    actor,
    itemId: "blocked",
    expectedUpdatedAt,
    dependency: { operation: "remove", relationshipId: 41 },
    supabase,
    tokenId: "token",
    requestHash: "a".repeat(64),
    idempotencyKey: "key",
    requestMetadata: { requestIp: "127.0.0.1", userAgent: "test" },
  });
  assert.deepEqual(committed, { ok: true, transaction });
  assert.equal(calls[0][0], "mutate_team_planning_dependency_transaction");
  assert.equal(calls[0][1].p_relation_id, 41);

  const conflict = await loadModule({ rpc: async () => ({ data: null, error: { code: "P0003", message: "conflict" } }) });
  const rejected = await conflict.dependencyModule.commitTeamPlanningDependency({
    actor,
    itemId: "blocked",
    expectedUpdatedAt,
    dependency: { operation: "remove", relationshipId: 41 },
    supabase: conflict.supabase,
    tokenId: "token",
    requestHash: "b".repeat(64),
    idempotencyKey: "key",
    requestMetadata: {},
  });
  assert.deepEqual(rejected, {
    ok: false,
    status: 409,
    error: "Idempotency-Key wurde mit anderen Daten wiederverwendet.",
  });
});
