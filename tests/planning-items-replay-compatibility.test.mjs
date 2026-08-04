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
