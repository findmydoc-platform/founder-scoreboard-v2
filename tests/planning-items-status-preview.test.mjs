import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule("src/features/planning-items/model/planning-items-contract.ts");
const status = await loadTranspiledModule("src/lib/status.ts");
const isOperationalLeadRole = (role) => role === "ceo" || role === "deputy";
const reviewState = {
  isReviewStateLocked: (reviewStatus, scoreFinal) => (reviewStatus === "requested" && !scoreFinal) || (reviewStatus === "accepted" && scoreFinal),
  reviewStateLockMessage: (_reviewStatus, scoreFinal) => scoreFinal ? "Final review locked" : "Active review locked",
  isTaskReviewFinal: (task) => task.reviewStatus === "accepted" && task.scoreFinal,
  isTaskReviewLocked: (task) => (task.reviewStatus === "requested" && !task.scoreFinal) || (task.reviewStatus === "accepted" && task.scoreFinal),
};
const permissions = await loadTranspiledModule(
  "src/features/tasks/model/task-detail-permissions.ts",
  {
    "@/lib/platform": { isOperationalLeadRole },
    "@/features/reviews/model/task-review-state": reviewState,
    "@/lib/status": status,
  },
);
const routeHelpers = await loadTranspiledModule(
  "src/features/tasks/model/task-route-update-helpers.ts",
  {
    "@/features/tasks/model/task-mutation-contract": {
      taskAssignedToProfile: (task, profile) => Boolean(profile && [task.assignee, task.owner].includes(profile.id)),
    },
    "@/lib/status": status,
  },
);
const normalization = await loadTranspiledModule(
  "src/features/planning-items/model/planning-item-normalization.ts",
  {
    "@/lib/api-input": { cleanText: (value, maxLength) => String(value || "").trim().slice(0, maxLength) },
    "@/lib/slug": { normalizeLookup: (value) => value, slugify: (value) => value },
    "@/features/planning-items/model/planning-items-contract": contract,
  },
);
const updates = await loadTranspiledModule(
  "src/features/planning-items/model/planning-item-update.ts",
  {
    "@/lib/planning-read-model": { ACTIVE_PACKAGES_TABLE: "active_packages", ACTIVE_TASKS_TABLE: "active_tasks" },
    "@/lib/github-repositories": { resolveTaskGitHubRepository: () => ({ ok: true }) },
    "@/features/tasks/model/task-detail-permissions": permissions,
    "@/features/reviews/model/task-review-state": reviewState,
    "@/features/tasks/model/task-route-update-helpers": routeHelpers,
    "@/lib/platform": { isOperationalLeadRole },
    "@/features/planning-items/model/planning-items-contract": contract,
    "@/features/planning-items/model/planning-item-normalization": normalization,
  },
);

const updatedAt = "2026-07-22T09:30:00.000Z";

function taskRow(overrides = {}) {
  return {
    id: "task-1",
    title: "Status API task",
    task_type: "deliverable",
    status: "In Arbeit",
    approval_status: "approved",
    approval_revision: 1,
    owner: "owner",
    assignee: "owner",
    package_id: "initiative-1",
    parent_task_id: null,
    review_status: "not_requested",
    review_owner_profile_id: "reviewer",
    review_requested_at: null,
    score_points: 4,
    score_final: false,
    score_relevant: false,
    github_issue_sync_status: "synced",
    updated_at: updatedAt,
    ...overrides,
  };
}

function supabaseFor(target, overrides = {}) {
  const profiles = overrides.profiles || [
    { id: "ceo", platform_role: "ceo" },
    { id: "deputy", platform_role: "deputy" },
    { id: "owner", platform_role: "founder" },
    { id: "other", platform_role: "founder" },
    { id: "reviewer", platform_role: "founder" },
  ];
  const initiatives = overrides.initiatives || [{
    id: "initiative-1",
    milestone_id: "milestone-1",
    approval_status: "approved",
    owner_id: "owner",
    accountable_profile_id: "reviewer",
  }];
  const parents = overrides.parents || [];
  const rows = {
    profiles,
    milestones: [{ id: "milestone-1" }],
    active_packages: initiatives,
    active_tasks: parents,
    sprints: overrides.sprints || [],
  };

  return {
    from(table) {
      return {
        select(columns) {
          const filters = [];
          const builder = {
            eq(column, value) { filters.push([column, value]); return this; },
            async maybeSingle() {
              if (table === "active_tasks" && columns.includes("problem_statement")) {
                return { data: target, error: null };
              }
              if (table === "milestones" || table === "active_packages") return { data: null, error: null };
              return { data: null, error: null };
            },
            then(resolve, reject) {
              const data = (rows[table] || []).filter((row) => filters.every(([column, value]) => row[column] === value));
              return Promise.resolve({ data, error: null }).then(resolve, reject);
            },
          };
          return builder;
        },
      };
    },
  };
}

async function preview(actor, target, nextStatus, options = {}) {
  const parsed = updates.parsePlanningItemPatchPayload({ expectedUpdatedAt: updatedAt, status: nextStatus });
  assert.equal(parsed.ok, true);
  return updates.buildPlanningItemUpdatePreview({
    actor,
    itemId: target.id,
    parsed,
    supabase: supabaseFor(target, options),
  });
}

test("Planning Items Review preview exposes the complete server-owned transition", async () => {
  const result = await preview({ id: "ceo", name: "CEO", platformRole: "ceo" }, taskRow(), "Review");

  assert.equal(result.ok, true);
  assert.deepEqual(result.preview.errors, []);
  assert.deepEqual(result.preview.changedFields, ["status"]);
  assert.equal(result.preview.resultingItem.reviewStatus, "requested");
  assert.equal(result.preview.resultingItem.scorePoints, 0);
  assert.equal(result.preview.resultingItem.scoreFinal, false);
  assert.equal(result.preview.resultingItem.reviewOwnerProfileId, "reviewer");
  assert.equal(Number.isNaN(Date.parse(result.preview.resultingItem.reviewRequestedAt)), false);
  assert.equal(result.preview.dbPatch.status, "Review");
  assert.equal(result.preview.dbPatch.review_status, "requested");
  assert.equal(result.preview.dbPatch.github_issue_sync_status, undefined);
  assert.equal(result.preview.systemEffects.some((effect) => effect.field === "notification"), true);
  assert.equal(result.preview.systemEffects.some((effect) => effect.field === "activity"), true);
  assert.equal(result.preview.systemEffects.some((effect) => effect.field === "audit"), true);
  assert.equal(result.preview.systemEffects.some((effect) => effect.field === "githubIssueSyncStatus"), true);
});

test("identical status remains a successful no-op even while review is active", async () => {
  const target = taskRow({ status: "Review", review_status: "requested", review_requested_at: updatedAt });
  const result = await preview({ id: "ceo", name: "CEO", platformRole: "ceo" }, target, "Review");

  assert.equal(result.ok, true);
  assert.deepEqual(result.preview.errors, []);
  assert.deepEqual(result.preview.changedFields, []);
  assert.deepEqual(result.preview.dbPatch, {});
  assert.equal(result.preview.warnings.length, 1);
});

test("role matrix matches UI status permissions", async () => {
  const deputyFinal = await preview({ id: "deputy", name: "Deputy", platformRole: "deputy" }, taskRow(), "Erledigt");
  assert.equal(deputyFinal.ok, true);
  assert.equal(deputyFinal.preview.errors.some((error) => error.includes("Final erledigt")), true);

  const unrelatedDeliverable = await preview({ id: "other", name: "Other", platformRole: "founder" }, taskRow(), "Blockiert");
  assert.equal(unrelatedDeliverable.ok, true);
  assert.equal(unrelatedDeliverable.preview.errors.some((error) => error.includes("eigenen Aufgaben")), true);

  const rework = await preview(
    { id: "owner", name: "Owner", platformRole: "founder" },
    taskRow({ status: "Nacharbeit" }),
    "Offen",
  );
  assert.equal(rework.ok, true);
  assert.equal(rework.preview.errors.some((error) => error.includes("Nacharbeit")), true);
});

test("every contributor may complete or reopen a Sub-Issue under an approved parent", async () => {
  const parent = taskRow({ id: "parent-1", task_type: "deliverable", owner: "owner", assignee: "owner" });
  const subIssue = taskRow({
    task_type: "sub_issue",
    owner: "owner",
    assignee: "owner",
    parent_task_id: "parent-1",
    approval_status: null,
    status: "Offen",
  });
  const actor = { id: "other", name: "Other", platformRole: "founder" };
  const completed = await preview(actor, subIssue, "Erledigt", { parents: [parent] });
  assert.equal(completed.ok, true);
  assert.deepEqual(completed.preview.errors, []);

  const reopened = await preview(actor, { ...subIssue, status: "Erledigt" }, "Offen", { parents: [parent] });
  assert.equal(reopened.ok, true);
  assert.deepEqual(reopened.preview.errors, []);
  assert.equal(reopened.preview.resultingItem.scoreFinal, false);
});

test("Sub-Issue status changes fail when the parent is not approved", async () => {
  const parent = taskRow({ id: "parent-1", approval_status: "proposed" });
  const subIssue = taskRow({ task_type: "sub_issue", parent_task_id: "parent-1", approval_status: null, status: "Offen" });
  const result = await preview(
    { id: "owner", name: "Owner", platformRole: "founder" },
    subIssue,
    "In Arbeit",
    { parents: [parent] },
  );
  assert.equal(result.ok, true);
  assert.equal(result.preview.errors.some((error) => error.includes("nicht freigegebenen Deliverable")), true);
});

test("Review preview rejects missing owners and locked Sprints", async () => {
  const noOwner = await preview(
    { id: "ceo", name: "CEO", platformRole: "ceo" },
    taskRow({ review_owner_profile_id: null, package_id: null }),
    "Review",
    { initiatives: [] },
  );
  assert.equal(noOwner.ok, true);
  assert.equal(noOwner.preview.errors.some((error) => error.includes("Review-Verantwortung")), true);

  const lockedSprint = await preview(
    { id: "ceo", name: "CEO", platformRole: "ceo" },
    taskRow({ sprint_id: "sprint-1" }),
    "Review",
    { sprints: [{ id: "sprint-1", score_locked: true }] },
  );
  assert.equal(lockedSprint.ok, true);
  assert.equal(lockedSprint.preview.errors.some((error) => error.includes("gelockt")), true);
});
