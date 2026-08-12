import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

async function loadPlanningModels() {
  const contract = await loadTranspiledModule("src/features/planning-items/model/planning-items-contract.ts");
  const normalization = await loadTranspiledModule(
    "src/features/planning-items/model/planning-item-normalization.ts",
    {
      "@/lib/api-input": {
        cleanText: (value, maxLength) => String(value || "").trim().slice(0, maxLength),
      },
      "@/lib/slug": { normalizeLookup: (value) => value, slugify: (value) => value },
      "@/features/planning-items/model/planning-items-contract": contract,
    },
  );
  const create = await loadTranspiledModule(
    "src/features/planning-items/model/planning-items-create.ts",
    {
      "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
      "@/lib/github-repositories": {
        defaultGitHubRepository: "findmydoc-platform/management",
        resolveTaskGitHubRepository: () => ({ ok: true, repository: "findmydoc-platform/management" }),
      },
      "@/features/planning-items/model/planning-items-contract": contract,
      "@/features/planning-items/model/planning-item-normalization": normalization,
      "@/features/planning-items/model/planning-items-github-sync-preview": {
        previewPlanningItemGitHubSync: () => ({ status: "accepted" }),
      },
    },
  );
  const update = await loadTranspiledModule(
    "src/features/planning-items/model/planning-item-update.ts",
    {
      "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
      "@/lib/github-repositories": { resolveTaskGitHubRepository: () => ({ ok: true }) },
      "@/lib/platform": { isOperationalLeadRole: () => true },
      "@/features/tasks/model/task-detail-permissions": { taskDetailPermissions: () => ({}) },
      "@/features/tasks/model/task-route-update-helpers": {},
      "@/features/reviews/model/task-review-state": {},
      "@/lib/status": {
        isSubIssueStatus: () => true,
        normalizeSubIssueStatus: (value) => value || "Offen",
      },
      "@/features/planning-items/model/planning-items-contract": contract,
      "@/features/planning-items/model/planning-item-normalization": normalization,
    },
  );
  return { create, update };
}

test("legacy create hashes remain reproducible from immutable v1 snapshots", async () => {
  const { create } = await loadPlanningModels();
  const input = {
    itemType: "deliverable",
    title: " Legacy delivery ",
    description: " Existing snapshot ",
    packageId: "package-legacy",
    ownerId: "owner-1",
    priority: "P1",
  };
  const responses = [{
    itemType: "deliverable",
    item: { package_id: "package-legacy", milestone_id: "milestone-legacy" },
  }];
  const committed = [{
    clientId: "planning-items-create-1",
    itemType: "deliverable",
    title: "Legacy delivery",
    description: "Existing snapshot",
    problemStatement: "",
    intendedOutcome: "",
    scopeConstraints: "",
    acceptanceCriteria: "",
    evidenceRequired: "",
    definitionOfDone: "",
    parentTaskId: "",
    packageId: "package-legacy",
    milestoneId: "milestone-legacy",
    ownerId: "owner-1",
    accountableProfileId: "owner-1",
    responsibleProfileIds: [],
    consultedProfileIds: [],
    informedProfileIds: [],
    priority: "P1",
    workstream: "",
    startDate: "",
    endDate: "",
    deadline: "",
    hours: 0,
    githubRepo: "findmydoc-platform/management",
    approvalStatus: "proposed",
    scoreRelevant: false,
  }];
  const expected = createHash("sha256").update(JSON.stringify(committed), "utf8").digest("hex");

  assert.equal(create.planningItemLegacyCreateHash({
    items: [input],
    responses,
    actorProfileId: "owner-1",
    githubSyncMode: null,
  }), expected);
  assert.equal(create.planningItemLegacyCreateHash({
    items: [{ ...input, itemType: "epic" }],
    responses,
    actorProfileId: "owner-1",
    githubSyncMode: null,
  }), null);
});

test("v1 update snapshots keep their former public response shape", async () => {
  const { update } = await loadPlanningModels();
  const initiative = update.mapLegacyPlanningItemDatabaseRow("initiative", {
    id: "package-legacy",
    title: "Legacy initiative",
    goal: "Validated outcome",
    success_criteria: "Signed off",
    scope_constraints: "No rollout",
    milestone_id: "milestone-legacy",
    owner_id: "owner-1",
    accountable_profile_id: "owner-1",
    responsible_profile_ids: ["owner-1"],
    approval_status: "approved",
    updated_at: "2026-07-30T09:00:00.000Z",
  });
  assert.deepEqual(initiative, {
    id: "package-legacy",
    itemType: "initiative",
    title: "Legacy initiative",
    intendedOutcome: "Validated outcome",
    scopeConstraints: "No rollout",
    acceptanceCriteria: "Signed off",
    milestoneId: "milestone-legacy",
    ownerId: "owner-1",
    accountableProfileId: "owner-1",
    responsibleProfileIds: ["owner-1"],
    consultedProfileIds: [],
    informedProfileIds: [],
    priority: "P2",
    approvalStatus: "approved",
    approvalRevision: 1,
    updatedAt: "2026-07-30T09:00:00.000Z",
  });
  const expectedUpdatedAt = "2026-07-30T09:00:00.000Z";
  assert.notEqual(
    update.planningItemUpdateHash({ itemId: "milestone-legacy", itemType: "milestone", expectedUpdatedAt, patch: { title: "Launch" } }),
    update.planningItemUpdateHash({ itemId: "milestone-legacy", itemType: "epic", expectedUpdatedAt, patch: { title: "Launch" } }),
  );
});

test("context keeps canonical strategy and the flat v1 initiative projection", async () => {
  const context = await loadTranspiledModule(
    "src/features/planning-items/model/planning-items-context.ts",
    {
      "@/lib/status": { normalizeStatus: (value) => value, normalizeSubIssueStatus: (value) => value },
      "@/features/planning-items/model/planning-items-contract": {
        FOUNDEROPS_PLANNING_PROJECT_ID: "project",
        TEAM_PLANNING_ITEMS_FORBIDDEN_WRITES: [],
        TEAM_PLANNING_ITEMS_MAX_BATCH_SIZE: 30,
        TEAM_PLANNING_ITEM_TYPES: ["epic", "initiative", "deliverable", "sub_issue"],
      },
      "@/features/planning-items/model/supabase-pagination": {},
      "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
    },
  );
  const canonical = {
    id: "initiative-1",
    description: "Fallback goal",
    scopeConstraints: "",
    strategy: {
      goal: "Primary goal",
      successCriteria: "Measured outcome",
      scopeConstraints: "No migration",
    },
  };
  const projected = context.planningItemsInitiativeCompatibilityProjection(canonical);
  assert.equal(projected.goal, "Primary goal");
  assert.equal(projected.successCriteria, "Measured outcome");
  assert.equal(projected.scopeConstraints, "No migration");
  assert.deepEqual(projected.strategy, canonical.strategy);
  assert.equal(Object.hasOwn(canonical, "goal"), false);
});

test("replay versioning and package preference translation are additive", async () => {
  const [migration, createRoute, updateRoute, documentation] = await Promise.all([
    read("supabase/migrations/20260804093935_planning_items_replay_and_preferences_compatibility.sql"),
    read("src/app/api/team/planning-items/v1/items/route.ts"),
    read("src/app/api/team/planning-items/v1/items/[id]/route.ts"),
    read("docs/team-planning-items-api.md"),
  ]);
  for (const table of [
    "team_task_intake_batches",
    "team_planning_item_update_requests",
    "team_planning_milestone_delete_requests",
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table}[^]*contract_version`, "i"));
  }
  assert.match(migration, /alter column contract_version set default 2/i);
  assert.match(migration, /planning_filters->>'packageId'/);
  assert.match(migration, /coalesce\(legacy\.task_id, expanded\.package_id\)/);
  assert.match(createRoute, /planningItemLegacyCreateHash/);
  assert.match(createRoute, /contract_version/);
  assert.match(updateRoute, /mapLegacyPlanningItemDatabaseRow/);
  assert.match(updateRoute, /contract_version/);
  assert.match(documentation, /flat `goal`, `successCriteria`, and `scopeConstraints` fields/);
});

test("v1 create replays return the immutable snapshot before canonical preview validation", async () => {
  let rpcCalls = 0;
  let previewCalls = 0;
  const stored = {
    id: "batch-v1",
    request_hash: "legacy-hash",
    response_tasks: [{ itemType: "milestone", item: { id: "milestone-v1", title: "Legacy" } }],
    contract_version: 1,
  };
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: stored, error: null }; },
  };
  const route = await loadTranspiledModule(
    "src/app/api/team/planning-items/v1/items/route.ts",
    {
      "next/server": { after: () => undefined },
      "@/lib/api-input": { auditRequestMetadata: () => ({}) },
      "@/features/planning-items/model/planning-items-contract": { isUuid: () => true },
      "@/features/planning-items/model/planning-items-route": {
        handlePlanningItemsRequest: async (_request, _scope, _message, handler) => handler({
          tokenId: "token-v1",
          scopes: [],
          profile: { id: "ceo", platformRole: "ceo" },
          supabase: {
            from: () => query,
            rpc: async () => { rpcCalls += 1; return { data: null, error: null }; },
          },
        }),
        planningItemsError: (error, status) => ({ body: { error }, status }),
        planningItemsJson: (body, status = 200) => ({ body, status }),
      },
      "@/features/planning-items/model/planning-items-create": {
        parsePlanningItemCreatePayload: () => ({
          ok: true,
          items: [{ itemType: "milestone", title: "Legacy" }],
          githubSyncMode: null,
        }),
        planningItemCreateRequiresOperationalLead: () => true,
        planningItemLegacyCreateHash: () => "legacy-hash",
        buildPlanningItemCreatePreview: async () => { previewCalls += 1; return []; },
        planningItemCreateGitHubSyncCommands: () => [],
        planningItemCreateHash: () => "canonical-hash",
        planningItemCreateCommitItem: (item) => item,
      },
      "@/features/planning-items/model/planning-items-github-sync": {},
    },
  );
  const response = await route.POST({
    headers: { get: () => "idempotency-key" },
    json: async () => ({}),
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.replayed, true);
  assert.equal(response.body.items[0].itemType, "milestone");
  assert.equal(previewCalls, 0);
  assert.equal(rpcCalls, 0);
});

test("v1 update and delete replays use legacy response mapping", async () => {
  const storedUpdate = {
    request_hash: "legacy-update-hash",
    contract_version: 1,
    response: {
      itemType: "initiative",
      item: { id: "package-v1", goal: "Legacy goal" },
      changedFields: ["intendedOutcome"],
      systemEffects: [],
    },
  };
  const storedDelete = {
    request_hash: "legacy-delete-hash",
    contract_version: 1,
    response: {
      itemType: "milestone",
      item: { id: "milestone-v1", title: "Legacy" },
      children: { initiatives: 0, tasks: 0 },
    },
  };
  let deleteRpcCalls = 0;
  const query = (data) => ({
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data, error: null }; },
  });
  const route = await loadTranspiledModule(
    "src/app/api/team/planning-items/v1/items/[id]/route.ts",
    {
      "next/server": { after: () => undefined },
      "@/lib/api-input": { auditRequestMetadata: () => ({}) },
      "@/features/planning-items/model/planning-items-contract": { isUuid: () => true },
      "@/features/planning-items/model/planning-actor-context-server": {},
      "@/features/planning-items/model/planning-items-empty-epic-delete": {
        parseEmptyEpicDeletePayload: () => ({ ok: true, expectedUpdatedAt: "2026-07-01T08:00:00.000Z" }),
        emptyEpicDeleteHash: () => "legacy-delete-hash",
        createEmptyEpicDeletePlanningItems: () => { throw new Error("legacy replay must bypass PlanningItems.run"); },
      },
      "@/features/planning-items/model/planning-items-reparent": {
        planningReparentHash: () => "reparent-hash",
        createPlanningReparentPlanningItems: () => { throw new Error("legacy replay must bypass reparent PlanningItems.run"); },
      },
      "@/features/planning-items/model/planning-item-update": {
        parsePlanningItemPatchPayload: () => ({
          ok: true,
          expectedUpdatedAt: "2026-07-01T08:00:00.000Z",
          presentFields: ["intendedOutcome"],
          raw: { intendedOutcome: "Legacy goal" },
          githubSync: null,
          githubSyncMode: null,
        }),
        planningItemUpdateHash: () => "legacy-update-hash",
        mapLegacyPlanningItemDatabaseRow: (itemType, item) => ({ id: item.id, itemType, mapped: "legacy" }),
        mapPlanningItemDatabaseRow: () => { throw new Error("canonical mapper must not handle v1 replay"); },
        buildPlanningItemUpdatePreview: async () => { throw new Error("preview must not run for v1 replay"); },
      },
      "@/features/planning-items/model/planning-items-route": {
        handlePlanningItemsRequest: async (_request, _scope, _message, handler) => handler({
          tokenId: "token-v1",
          scopes: [],
          profile: { id: "ceo", platformRole: "ceo" },
          supabase: {
            from: (table) => table === "team_planning_milestone_delete_requests"
              ? query(storedDelete)
              : query(storedUpdate),
            rpc: async () => {
              deleteRpcCalls += 1;
              return {
                data: {
                  replayed: true,
                  itemType: "milestone",
                  item: { id: "milestone-v1", title: "Legacy" },
                  children: { initiatives: 0, tasks: 0 },
                },
                error: null,
              };
            },
          },
        }),
        planningItemsError: (error, status) => ({ body: { error }, status }),
        planningItemsJson: (body, status = 200) => ({ body, status }),
      },
      "@/features/planning-items/model/planning-items-github-sync": {},
    },
  );
  const request = {
    headers: { get: () => "idempotency-key" },
    json: async () => ({}),
    nextUrl: { origin: "http://localhost:3000" },
  };
  const updateResponse = await route.PATCH(request, { params: Promise.resolve({ id: "package-v1" }) });
  assert.equal(updateResponse.status, 200);
  assert.equal(updateResponse.body.itemType, "initiative");
  assert.equal(updateResponse.body.item.mapped, "legacy");

  const deleteResponse = await route.DELETE(request, { params: Promise.resolve({ id: "milestone-v1" }) });
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteResponse.body.itemType, "milestone");
  assert.equal(deleteResponse.body.item.mapped, "legacy");
  assert.equal(deleteRpcCalls, 0);
});
