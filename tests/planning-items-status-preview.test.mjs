import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule("src/features/planning-items/model/planning-items-contract.ts");
const deliverableSchedule = await loadTranspiledModule("src/features/planning-items/model/deliverable-schedule.ts");
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
    "@/features/tasks/model/planning-item-capabilities": {
      strategicPlanningStatuses: ["Offen", "In Arbeit", "Pausiert", "Blockiert", "Erledigt"],
    },
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
    "@/lib/status": status,
    "@/features/planning-items/model/planning-items-contract": contract,
    "@/features/planning-items/model/planning-item-normalization": normalization,
    "@/features/planning-items/model/deliverable-schedule": deliverableSchedule,
  },
);

const updatedAt = "2026-07-22T09:30:00.000Z";

test("ReviseItem maps every item type and keeps omitted fields absent", () => {
  const epic = updates.planningItemReviseCommand("epic-1", "epic", updatedAt, {
    title: "Updated Epic",
    status: "active",
    owner: "ceo",
    targetDate: "2026-12-31",
    parentTaskId: "must-not-leak",
  });
  assert.deepEqual(epic.changes, {
    itemKind: "epic",
    title: "Updated Epic",
    ownerId: "ceo",
    status: "In Arbeit",
    targetDate: "2026-12-31",
  });

  const initiative = updates.planningItemReviseCommand("initiative-1", "initiative", updatedAt, {
    goal: "Outcome",
    successCriteria: "Evidence",
    scopeConstraints: "Boundary",
    accountableProfileId: "ceo",
    responsibleProfileIds: ["owner"],
    priority: "P1",
  });
  assert.deepEqual(initiative.changes.strategy, { goal: "Outcome", successCriteria: "Evidence", scopeConstraints: "Boundary" });
  assert.deepEqual(initiative.changes.raciAssignments, [
    { profileId: "ceo", role: "accountable", sortOrder: 0 },
    { profileId: "owner", role: "responsible", sortOrder: 0 },
  ]);
  assert.equal(initiative.changes.priority, "P1");

  const deliverable = updates.planningItemReviseCommand("deliverable-1", "deliverable", updatedAt, {
    problemStatement: "Problem",
    intendedOutcome: "Outcome",
    ownerId: "owner",
    hours: 8,
  });
  assert.deepEqual(deliverable.changes.brief, { problemStatement: "Problem", intendedOutcome: "Outcome" });
  assert.equal(deliverable.changes.ownerId, "owner");
  assert.equal(deliverable.changes.hours, 8);

  const subIssue = updates.planningItemReviseCommand("sub-1", "sub_issue", updatedAt, {
    description: "Context",
    githubRepo: "findmydoc-platform/website",
  });
  assert.deepEqual(subIssue.changes.brief, { description: "Context" });
  assert.equal(subIssue.changes.githubRepository, "findmydoc-platform/website");
  assert.equal(Object.hasOwn(subIssue.changes, "ownerId"), false);
});

function taskRow(overrides = {}) {
  return {
    id: "task-1",
    project_id: "findmydoc-founder-execution",
    title: "Status API task",
    task_type: "deliverable",
    status: "In Arbeit",
    approval_status: "approved",
    approval_revision: 1,
    owner: "owner",
    assignee: "owner",
    package_id: "initiative-1",
    parent_task_id: "initiative-1",
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
    project_id: "findmydoc-founder-execution",
    milestone_id: "milestone-1",
    approval_status: "approved",
    owner_id: "owner",
    accountable_profile_id: "reviewer",
  }];
  const parents = overrides.parents || [{
    id: "initiative-1",
    project_id: "findmydoc-founder-execution",
    task_type: "initiative",
    parent_task_id: "epic-1",
    approval_status: "approved",
    owner: "owner",
    review_status: "not_requested",
    score_final: false,
  }];
  const rows = {
    profiles,
    milestones: [{ id: "milestone-1" }],
    active_packages: initiatives,
    active_tasks: parents,
    sprints: overrides.sprints || [],
    planning_item_raci_assignments: overrides.raciAssignments || [],
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

test("Planning Item previews compare equivalent timestamp representations semantically", async () => {
  const target = taskRow();
  const parsed = updates.parsePlanningItemPatchPayload({
    expectedUpdatedAt: "2026-07-22T11:30:00.000+02:00",
    status: "In Arbeit",
  });
  assert.equal(parsed.ok, true);
  const result = await updates.buildPlanningItemUpdatePreview({
    actor: { id: "owner", name: "Owner", platformRole: "founder" },
    itemId: target.id,
    parsed,
    supabase: supabaseFor(target),
  });
  assert.equal(result.ok, true);
});

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
  assert.equal(result.preview.dbPatch.review_status, undefined);
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

test("Sub-Issue work brief fields are returned, previewed, and persisted without review effects", async () => {
  const parent = taskRow({ id: "parent-1", approval_status: "approved" });
  const subIssue = taskRow({
    task_type: "sub_issue",
    owner: "owner",
    assignee: "owner",
    parent_task_id: "parent-1",
    approval_status: null,
    problem_statement: "Existing problem",
    intended_outcome: "Existing outcome",
    scope_constraints: "Existing scope",
    acceptance_criteria: "Existing acceptance",
    evidence_required: "Existing evidence context",
    definition_of_done: "Existing quality standard",
  });
  const parsed = updates.parsePlanningItemPatchPayload({
    expectedUpdatedAt: updatedAt,
    description: "Updated context",
    problemStatement: "Updated problem",
    intendedOutcome: "Updated outcome",
    scopeConstraints: "Updated scope",
    acceptanceCriteria: "Updated acceptance",
    evidenceRequired: "Updated evidence context",
    definitionOfDone: "Updated quality standard",
  });
  assert.equal(parsed.ok, true);

  const result = await updates.buildPlanningItemUpdatePreview({
    actor: { id: "owner", name: "Owner", platformRole: "founder" },
    itemId: subIssue.id,
    parsed,
    supabase: supabaseFor(subIssue, { parents: [parent] }),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.preview.errors, []);
  assert.deepEqual(result.preview.changedFields, [
    "description",
    "problemStatement",
    "intendedOutcome",
    "scopeConstraints",
    "acceptanceCriteria",
    "evidenceRequired",
    "definitionOfDone",
  ]);
  assert.equal(result.preview.currentItem.problemStatement, "Existing problem");
  assert.equal(result.preview.resultingItem.definitionOfDone, "Updated quality standard");
  assert.deepEqual(result.preview.dbPatch, {
    description: "Updated context",
    problem_statement: "Updated problem",
    intended_outcome: "Updated outcome",
    scope_constraints: "Updated scope",
    acceptance_criteria: "Updated acceptance",
    evidence_required: "Updated evidence context",
    definition_of_done: "Updated quality standard",
  });
  assert.equal(result.preview.resultingItem.reviewStatus, "not_requested");
  assert.equal(result.preview.resultingItem.scorePoints, 0);
});

test("Sub-Issue status preview rejects review states and rewrites legacy review state only on explicit change", async () => {
  const parent = taskRow({ id: "parent-1", approval_status: "approved" });
  const subIssue = taskRow({
    task_type: "sub_issue",
    parent_task_id: "parent-1",
    approval_status: null,
    status: "Review",
    review_status: "requested",
    score_points: 8,
    score_final: true,
  });

  for (const invalidStatus of ["Review", "Nacharbeit"]) {
    const invalid = await preview(
      { id: "ceo", name: "CEO", platformRole: "ceo" },
      subIssue,
      invalidStatus,
      { parents: [parent] },
    );
    assert.equal(invalid.ok, true);
    assert.equal(invalid.preview.errors.some((error) => error.includes("Offen, In Arbeit, Blockiert oder Erledigt")), true);
  }

  const normalized = await preview(
    { id: "owner", name: "Owner", platformRole: "founder" },
    subIssue,
    "In Arbeit",
    { parents: [parent] },
  );
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.preview.errors, []);
  assert.deepEqual(normalized.preview.changedFields, ["status"]);
  assert.equal(normalized.preview.dbPatch.status, "In Arbeit");
  assert.equal(normalized.preview.resultingItem.reviewStatus, "not_requested");
  assert.equal(normalized.preview.resultingItem.scorePoints, 0);
  assert.equal(normalized.preview.resultingItem.scoreFinal, false);
});

test("Review preview rejects missing owners and locked Sprints", async () => {
  const noOwner = await preview(
    { id: "ceo", name: "CEO", platformRole: "ceo" },
    taskRow({ review_owner_profile_id: null, package_id: null, parent_task_id: null }),
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
