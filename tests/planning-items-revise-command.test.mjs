import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const read = (path) => readFile(path, "utf8");

async function loadUpdateModel() {
  return loadTranspiledModule("src/features/planning-items/model/planning-item-update.ts", {
    "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
    "@/lib/github-repositories": { resolveTaskGitHubRepository: () => ({ ok: true, repository: "findmydoc-platform/management" }) },
    "@/lib/platform": { isOperationalLeadRole: () => true },
    "@/features/tasks/model/task-detail-permissions": { taskDetailPermissions: () => ({}) },
    "@/features/tasks/model/task-route-update-helpers": {
      applyFinalStatusReopen: () => undefined,
      startsTaskReviewRequest: () => false,
      validateSubIssueStatusParentApproval: () => null,
      validateTaskStatusUpdate: () => null,
    },
    "@/features/reviews/model/task-review-state": {
      isReviewStateLocked: () => false,
      reviewStateLockMessage: () => "",
      TASK_COMPLETED_LOCKED_MESSAGE: "",
    },
    "@/lib/status": { isSubIssueStatus: () => true, normalizeSubIssueStatus: (value) => value },
    "@/features/planning-items/model/planning-items-contract": {
      FOUNDEROPS_PLANNING_PROJECT_ID: "findmydoc-founder-execution",
      TEAM_PLANNING_ITEM_PATCH_FIELDS: [],
      TEAM_PLANNING_STRATEGIC_STATUSES: [],
      isStrategicPlanningItemType: () => false,
      parsePlanningItemGitHubSyncCommand: () => ({ ok: true, command: null }),
      parsePlanningItemGitHubSyncMode: () => null,
    },
    "@/features/planning-items/model/planning-item-normalization": {
      normalizePatchAcceptanceCriteria: (value) => value,
      normalizePatchDate: (value) => value,
      normalizePatchHours: (value) => value,
      normalizePatchId: (value) => value,
      normalizePatchPriority: (value) => value,
      normalizePatchStringList: (value) => value,
      normalizePatchTaskStatus: (value) => value,
      normalizePatchText: (value) => value,
    },
  });
}

test("ReviseItem owns the four canonical field matrices and excludes workflow parent fields", async () => {
  const [contract, update] = await Promise.all([
    read("src/features/planning-items/model/planning-items.ts"),
    read("src/features/planning-items/model/planning-item-update.ts"),
  ]);

  assert.match(contract, /type EpicChanges[^]*itemKind: "epic"[^]*targetDate\?: string \| null/);
  assert.match(contract, /type InitiativeChanges[^]*strategy\?: Partial<PlanningStrategy>[^]*raciAssignments\?: readonly PlanningRaciAssignment\[\][^]*priority\?: string/);
  assert.match(contract, /type DeliverableChanges[^]*brief\?: Partial<PlanningBrief>[^]*workstream\?: string[^]*hours\?: number/);
  assert.match(contract, /type SubIssueChanges[^]*brief\?: Partial<PlanningBrief>[^]*githubRepository\?: string/);
  assert.doesNotMatch(contract.slice(contract.indexOf("export type PlanningItemChanges"), contract.indexOf("export type ReviseItem")), /parentId|sprintId|approvalStatus|reviewStatus/);

  assert.match(update, /const fieldsByType: Record<TeamPlanningItemType/);
  assert.match(update, /epic: new Set\(\["title", "description", "ownerId", "targetDate", "status"\]\)/);
  assert.match(update, /initiative: new Set\(\[[^]*"accountableProfileId"[^]*"informedProfileIds"/);
  assert.match(update, /deliverable: new Set\(\[[^]*"problemStatement"[^]*"definitionOfDone"/);
  assert.match(update, /sub_issue: new Set\(\[[^]*"githubRepo"/);
  assert.match(update, /reason: "useChangeParentAction"/);
});

test("Browser and Team transports delegate Revise writes to one deep module", async () => {
  const [taskAdapter, teamAdapter, teamPreviewAdapter, update, appTask, appTeam, appTeamPreview] = await Promise.all([
    read("src/features/planning-items/model/planning-items-browser-task-update.ts"),
    read("src/features/planning-items/model/planning-items-team-update-route.ts"),
    read("src/features/planning-items/model/planning-items-team-update-preview.ts"),
    read("src/features/planning-items/model/planning-item-update.ts"),
    read("src/app/api/tasks/[id]/route.ts"),
    read("src/app/api/team/planning-items/v2/items/[id]/route.ts"),
    read("src/app/api/team/planning-items/v2/items/[id]/preview/route.ts"),
  ]);

  assert.match(taskAdapter, /createBrowserRevisePlanningItems/);
  assert.match(teamAdapter, /createTeamRevisePlanningItems/);
  assert.match(teamPreviewAdapter, /createTeamRevisePlanningItems/);
  assert.match(update, /update_browser_planning_item_transaction/);
  assert.match(update, /update_browser_planning_task_transaction/);
  assert.match(update, /update_team_planning_item_with_projection_transaction/);
  for (const route of [appTask, appTeam, appTeamPreview]) {
    assert.doesNotMatch(route, /\.rpc\(|\.from\(/);
  }
  for (const adapter of [taskAdapter, teamAdapter, teamPreviewAdapter]) {
    assert.doesNotMatch(adapter, /\.rpc\("update_(?:browser|team|planning)/);
  }
});



test("Team revise preserves a late inactive-token decision", async () => {
  const model = await loadUpdateModel();
  const query = {
    select() { return query; },
    eq() { return query; },
    async maybeSingle() { return { data: null, error: null }; },
  };
  const supabase = {
    from: () => query,
    rpc: async () => ({ data: null, error: { code: "P0004", message: "planning items token is inactive" } }),
  };
  const actor = {
    profileId: "ceo",
    platformRole: "ceo",
    credential: { kind: "planningToken", tokenId: "token-one", scopes: ["write:planning-items:update"] },
  };
  const parsed = {
    ok: true,
    expectedUpdatedAt: "2026-08-12T10:00:00.000Z",
    raw: { title: "Updated" },
    githubSync: null,
    githubSyncMode: null,
  };
  const preview = {
    itemId: "deliverable-one",
    itemType: "deliverable",
    expectedUpdatedAt: parsed.expectedUpdatedAt,
    currentItem: { id: "deliverable-one", title: "Current" },
    normalizedPatch: parsed.raw,
    resultingItem: { id: "deliverable-one", title: "Updated" },
    changedFields: ["title"],
    systemEffects: [],
    warnings: [],
    errors: [],
    dbPatch: { title: "Updated" },
  };
  const result = await model.createTeamRevisePlanningItems({
    supabase,
    actor,
    tokenId: "token-one",
    itemId: "deliverable-one",
    parsed,
    preparedPreview: preview,
  }).run({
    actor,
    mode: "commit",
    command: model.planningItemReviseCommand("deliverable-one", "deliverable", parsed.expectedUpdatedAt, parsed.raw),
    idempotencyKey: "00000000-0000-4000-8000-000000000307",
  });
  assert.deepEqual(result.error, { code: "forbidden", reason: "planningTokenInactive" });
});
