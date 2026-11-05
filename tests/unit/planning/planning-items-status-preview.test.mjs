import assert from "node:assert/strict";
import { test } from "vitest";
import * as repositories from "../../../src/lib/github-repositories";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const contract = await importTestModule("src/features/planning-items/model/planning-items-contract.ts");
const deliverableSchedule = await importTestModule("src/features/planning-items/model/deliverable-schedule.ts");
const status = await importTestModule("src/lib/status.ts");
const isOperationalLeadRole = (role) => role === "ceo" || role === "deputy";
const reviewState = {
  isReviewStateLocked: (reviewStatus, scoreFinal) => (reviewStatus === "requested" && !scoreFinal) || (reviewStatus === "accepted" && scoreFinal),
  reviewStateLockMessage: (_reviewStatus, scoreFinal) => scoreFinal ? "Final review locked" : "Active review locked",
  isTaskReviewFinal: (task) => task.reviewStatus === "accepted" && task.scoreFinal,
  isTaskReviewLocked: (task) => (task.reviewStatus === "requested" && !task.scoreFinal) || (task.reviewStatus === "accepted" && task.scoreFinal),
};
const permissions = await importTestModule(
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
const routeHelpers = await importTestModule(
  "src/features/tasks/model/task-route-update-helpers.ts",
  {
    "@/features/tasks/model/task-mutation-contract": {
      taskAssignedToProfile: (task, profile) => Boolean(profile && [task.assignee, task.owner].includes(profile.id)),
    },
    "@/lib/status": status,
  },
);
const normalization = await importTestModule(
  "src/features/planning-items/model/planning-item-normalization.ts",
  {
    "@/lib/api-input": { cleanText: (value, maxLength) => String(value || "").trim().slice(0, maxLength) },
    "@/lib/slug": { normalizeLookup: (value) => value, slugify: (value) => value },
    "@/features/planning-items/model/planning-items-contract": contract,
  },
);
const updates = await importTestModule(
  "src/features/planning-items/model/planning-item-update.ts",
  {
    "@/lib/planning-read-model": { ACTIVE_PACKAGES_TABLE: "active_packages", ACTIVE_TASKS_TABLE: "active_tasks" },
    "@/lib/github-repositories": repositories,
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
    review_evidence_exception_note: null,
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
    task_links: overrides.taskLinks === undefined
      ? [{ id: 1, task_id: target.id, type: "evidence", url: "https://example.com/evidence" }]
      : overrides.taskLinks,
  };

  return {
    async rpc(name, parameters) {
      if (name === "update_team_planning_item_with_review_evidence_transaction_v1" && overrides.commit) {
        return overrides.commit(parameters);
      }
      assert.equal(name, "has_valid_planning_review_evidence");
      return { data: overrides.hasValidReviewEvidence ?? Boolean(target.evidence_link || rows.task_links.length), error: null };
    },
    from(table) {
      return {
        select(columns) {
          const filters = [];
          const builder = {
            eq(column, value) { filters.push([column, value]); return this; },
            in(column, values) { filters.push([column, values]); return this; },
            order() { return this; },
            returns() { return this; },
            limit(count) { this.limitCount = count; return this; },
            async maybeSingle() {
              if (table === "active_tasks" && columns.includes("problem_statement")) {
                return { data: target, error: null };
              }
              if (table === "milestones" || table === "active_packages") return { data: null, error: null };
              return { data: null, error: null };
            },
            then(resolve, reject) {
              let data = (rows[table] || []).filter((row) => filters.every(([column, value]) => Array.isArray(value) ? value.includes(row[column]) : row[column] === value));
              if (this.limitCount) data = data.slice(0, this.limitCount);
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

test.each(["epic", "initiative", "deliverable", "sub_issue"])("prepared %s revision previews and saves the same normalized change", async (itemType) => {
  const writes = [];
  const target = taskRow({ task_type: itemType, parent_task_id: itemType === "epic" ? null : "parent-one" });
  const parentType = { initiative: "epic", deliverable: "initiative", sub_issue: "deliverable" }[itemType];
  const actor = {
    profileId: "ceo", platformRole: "ceo",
    credential: { kind: "planningToken", tokenId: "token-one", scopes: ["write:planning-items:update"] },
  };
  const parsed = updates.parsePlanningItemPatchPayload({ expectedUpdatedAt: updatedAt, title: "  Updated title  " });
  assert.equal(parsed.ok, true);
  const prepared = await updates.prepareTeamPlanningItemRevision({
    actor: { id: actor.profileId, platformRole: actor.platformRole }, tokenId: "token-one", itemId: target.id, parsed,
    supabase: supabaseFor(target, { parents: [taskRow({ id: "parent-one", task_type: parentType })], commit: async (parameters) => {
      writes.push(parameters);
      return { data: { itemType, item: { ...target, title: parameters.p_patch.title } }, error: null };
    } }),
  });
  assert.equal(prepared.ok, true);
  const previewed = await prepared.revision.run({ actor, mode: "preview" });
  assert.equal(previewed.status, "previewed");
  assert.equal(prepared.revision.preview.resultingItem.title, "Updated title");
  assert.deepEqual(writes, []);
  const committed = await prepared.revision.run({ actor, mode: "commit", idempotencyKey: "00000000-0000-4000-8000-000000000307" });
  assert.equal(committed.status, "committed");
  assert.deepEqual(writes[0].p_patch, { title: "Updated title" });
  if (itemType === "deliverable") {
    assert.equal(writes[0].p_request_hash, "b6c5c003b2675f54fb3b4f4de11e20cec57ec545eedfcaaacb44abbf25c6a9e6");
  }
  assert.equal(updates.teamReviseTransactionFromResult(committed).item.title, "Updated title");
});

test.each([
  ["P0004", { code: "forbidden", reason: "planningTokenInactive" }],
  ["P0017", { code: "conflict", reason: "state", details: { planningReviewReason: "evidenceRequired" } }],
])("prepared revision preserves late persistence failure %s", async (code, expectedError) => {
  const actor = { profileId: "ceo", platformRole: "ceo", credential: { kind: "planningToken", tokenId: "token-one", scopes: ["write:planning-items:update"] } };
  const prepared = await updates.prepareTeamPlanningItemRevision({
    actor: { id: actor.profileId, platformRole: actor.platformRole }, tokenId: "token-one", itemId: "task-1",
    parsed: updates.parsePlanningItemPatchPayload({ expectedUpdatedAt: updatedAt, status: "Review", evidenceExceptionNote: "Accepted without a link." }),
    supabase: supabaseFor(taskRow(), { commit: async (parameters) => {
      assert.equal(parameters.p_evidence_exception_note, "Accepted without a link.");
      return { data: null, error: { code } };
    } }),
  });
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.revision.preview.errors, []);
  const result = await prepared.revision.run({ actor, mode: "commit", idempotencyKey: "00000000-0000-4000-8000-000000000307" });
  assert.deepEqual(result, { ok: false, error: expectedError });
});

test("prepared initiative revision preserves omitted RACI roles and clears only requested text", async () => {
  const actor = { profileId: "ceo", platformRole: "ceo", credential: { kind: "planningToken", tokenId: "token-one", scopes: ["write:planning-items:update"] } };
  let savedPatch;
  const prepared = await updates.prepareTeamPlanningItemRevision({
    actor: { id: actor.profileId, platformRole: actor.platformRole }, tokenId: "token-one", itemId: "task-1",
    parsed: updates.parsePlanningItemPatchPayload({ expectedUpdatedAt: updatedAt, description: null, responsibleProfileIds: ["other"] }),
    supabase: supabaseFor(taskRow({ task_type: "initiative", description: "Previous", parent_task_id: "epic-1" }), {
      parents: [taskRow({ id: "epic-1", task_type: "epic" })],
      raciAssignments: [
        { task_id: "task-1", profile_id: "ceo", role: "accountable", sort_order: 0 },
        { task_id: "task-1", profile_id: "owner", role: "responsible", sort_order: 0 },
        { task_id: "task-1", profile_id: "reviewer", role: "consulted", sort_order: 0 },
      ],
      commit: async (parameters) => {
        savedPatch = parameters.p_patch;
        return { data: { itemType: "initiative", item: { id: "task-1" } }, error: null };
      },
    }),
  });
  assert.equal(prepared.ok, true);
  assert.deepEqual(prepared.revision.preview.errors, []);
  assert.equal(prepared.revision.preview.resultingItem.description, null);
  assert.equal(prepared.revision.preview.resultingItem.accountableProfileId, "ceo");
  assert.deepEqual(prepared.revision.preview.resultingItem.consultedProfileIds, ["reviewer"]);
  assert.deepEqual(prepared.revision.preview.resultingItem.responsibleProfileIds, ["other"]);
  const result = await prepared.revision.run({ actor, mode: "commit", idempotencyKey: "00000000-0000-4000-8000-000000000307" });
  assert.equal(result.status, "committed");
  assert.equal(savedPatch.description, null);
  assert.equal(Object.hasOwn(savedPatch, "title"), false);
});

test("prepared revision keeps its preview while a later request observes the changed revision", async () => {
  const actor = { profileId: "ceo", platformRole: "ceo", credential: { kind: "planningToken", tokenId: "token-one", scopes: ["write:planning-items:update"] } };
  const target = taskRow();
  const input = { actor: { id: actor.profileId, platformRole: actor.platformRole }, tokenId: "token-one", itemId: target.id, parsed: updates.parsePlanningItemPatchPayload({ expectedUpdatedAt: updatedAt, title: "Updated" }), supabase: supabaseFor(target) };
  const prepared = await updates.prepareTeamPlanningItemRevision(input);
  assert.equal(prepared.ok, true);
  target.updated_at = "2026-07-22T10:00:00.000Z";
  assert.equal((await prepared.revision.run({ actor, mode: "preview" })).status, "previewed");
  const later = await updates.prepareTeamPlanningItemRevision(input);
  assert.equal(later.ok, false);
  assert.equal(later.status, 409);
});

test.each(["actor", "idempotencyKey"])("prepared revision rejects an invalid %s before writing", async (invalidField) => {
  const actor = { profileId: "ceo", platformRole: "ceo", credential: { kind: "planningToken", tokenId: "token-one", scopes: ["write:planning-items:update"] } };
  const prepared = await updates.prepareTeamPlanningItemRevision({
    actor: { id: actor.profileId, platformRole: actor.platformRole }, tokenId: "token-one", itemId: "task-1",
    parsed: updates.parsePlanningItemPatchPayload({ expectedUpdatedAt: updatedAt, title: "Updated" }),
    supabase: supabaseFor(taskRow()),
  });
  assert.equal(prepared.ok, true);
  const result = await prepared.revision.run({ actor: invalidField === "actor" ? { ...actor, profileId: "other" } : actor, mode: "commit" });
  assert.deepEqual(result, { ok: false, error: invalidField === "actor"
    ? { code: "forbidden", reason: "actorMismatch" }
    : { code: "invalidCommand", issues: [{ path: "idempotencyKey", reason: "idempotencyKeyRequired" }] } });
});

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

test("Planning Items Review preview requires evidence or an explicit exception note", async () => {
  const actor = { id: "ceo", name: "CEO", platformRole: "ceo" };
  const withoutEvidence = await preview(actor, taskRow(), "Review", { taskLinks: [] });
  assert.equal(withoutEvidence.ok, true);
  assert.equal(withoutEvidence.preview.errors.some((error) => error.includes("Evidence-Link")), true);

  const parsed = updates.parsePlanningItemPatchPayload({
    expectedUpdatedAt: updatedAt,
    status: "Review",
    evidenceExceptionNote: "Ergebnis wurde im Founder-Meeting abgenommen.",
  });
  assert.equal(parsed.ok, true);
  const withException = await updates.buildPlanningItemUpdatePreview({
    actor,
    itemId: "task-1",
    parsed,
    supabase: supabaseFor(taskRow(), { taskLinks: [] }),
  });
  assert.equal(withException.ok, true);
  assert.deepEqual(withException.preview.errors, []);
  assert.equal(withException.preview.resultingItem.evidenceExceptionNote, "Ergebnis wurde im Founder-Meeting abgenommen.");
});

test("Planning Items Review preview accepts legacy evidence and a valid link in the same patch", async () => {
  const actor = { id: "ceo", name: "CEO", platformRole: "ceo" };
  const legacy = await preview(
    actor,
    taskRow({ evidence_link: "https://example.com/legacy-evidence" }),
    "Review",
    { taskLinks: [] },
  );
  assert.equal(legacy.ok, true);
  assert.deepEqual(legacy.preview.errors, []);

  const parsed = updates.parsePlanningItemPatchPayload({
    expectedUpdatedAt: updatedAt,
    status: "Review",
    evidenceLink: "https://example.com/current-evidence",
  });
  assert.equal(parsed.ok, true);
  const samePatch = await updates.buildPlanningItemUpdatePreview({
    actor,
    itemId: "task-1",
    parsed,
    supabase: supabaseFor(taskRow(), { taskLinks: [] }),
  });
  assert.equal(samePatch.ok, true);
  assert.deepEqual(samePatch.preview.errors, []);
  assert.equal(samePatch.preview.resultingItem.evidenceLink, "https://example.com/current-evidence");
});

test("Planning Items Review preview accepts inherited evidence without adding a parent link or exception", async () => {
  const result = await preview(
    { id: "ceo", name: "CEO", platformRole: "ceo" },
    taskRow(),
    "Review",
    { taskLinks: [], hasValidReviewEvidence: true },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.preview.errors, []);
  assert.equal(result.preview.resultingItem.evidenceLink, "");
  assert.equal(result.preview.resultingItem.evidenceExceptionNote, "");
  assert.equal(Object.hasOwn(result.preview.dbPatch, "evidence_link"), false);
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

test("Update preview validates the full merged brief and retains a long patch", async () => {
  const target = taskRow({ problem_statement: "p".repeat(40_000) });
  const parsed = updates.parsePlanningItemPatchPayload({ expectedUpdatedAt: updatedAt, intendedOutcome: "😀".repeat(30_000) });
  assert.equal(parsed.ok, true);
  const result = await updates.buildPlanningItemUpdatePreview({ actor: { id: "ceo", platformRole: "ceo" }, itemId: target.id, parsed, supabase: supabaseFor(target) });
  assert.equal(result.ok, true);
  assert.equal(Array.from(result.preview.normalizedPatch.intendedOutcome).length, 30_000);
  assert.equal(result.preview.resultingItem.problemStatement.length, 40_000);
  assert.equal(result.preview.lengthErrors[0].field, "githubBody");
  assert.ok(result.preview.errors.length > 0);
});

test("an invalid update preview retains the full input and exposes structured length errors", async () => {
  const target = taskRow();
  const intendedOutcome = "x".repeat(65_537);
  const parsed = updates.parsePlanningItemPatchPayload({ expectedUpdatedAt: updatedAt, intendedOutcome });
  const result = await updates.buildPlanningItemUpdatePreview({ actor: { id: "ceo", platformRole: "ceo" }, itemId: target.id, parsed, supabase: supabaseFor(target) });
  assert.equal(result.ok, true);
  assert.equal(result.preview.normalizedPatch.intendedOutcome?.length, 65_537);
  assert.equal(result.preview.lengthErrors.find((error) => error.field === "intendedOutcome").excess, 1);
});


test("update preview derives full linked brief from resulting item without adding stored changes", async () => {
  const text = "Änderung other-org/outside-repo#123";
  const target = taskRow({ description: text, problem_statement: text, intended_outcome: "Bestehendes Ziel" });
  const parsed = updates.parsePlanningItemPatchPayload({ expectedUpdatedAt: updatedAt, intendedOutcome: "Neues Ziel" });
  const result = await updates.buildPlanningItemUpdatePreview({
    actor: { id: "ceo", platformRole: "ceo" }, itemId: target.id, parsed, supabase: supabaseFor(target),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.preview.linkedBrief, {
    description: "Änderung [other-org/outside-repo#123](https://github.com/other-org/outside-repo/issues/123)",
    problemStatement: "Änderung [other-org/outside-repo#123](https://github.com/other-org/outside-repo/issues/123)",
    intendedOutcome: "Neues Ziel", scopeConstraints: "", acceptanceCriteria: "", evidenceRequired: "", definitionOfDone: "",
  });
  assert.equal(result.preview.resultingItem.description, text);
  assert.deepEqual(result.preview.changedFields, ["intendedOutcome"]);
  assert.deepEqual(result.preview.dbPatch, { intended_outcome: "Neues Ziel" });
  assert.equal(result.preview.normalizedPatch.linkedBrief, undefined);
});


test("update preview resolves approved repository references in the complete resulting brief", async () => {
  const text = "Prüfe website#12 und unknown#361";
  const target = taskRow({ github_repo: "findmydoc-platform/management", problem_statement: text });
  const parsed = updates.parsePlanningItemPatchPayload({ expectedUpdatedAt: updatedAt, intendedOutcome: "Management management#361" });
  const result = await updates.buildPlanningItemUpdatePreview({
    actor: { id: "ceo", platformRole: "ceo" }, itemId: target.id, parsed, supabase: supabaseFor(target),
  });
  assert.equal(result.ok, true);
  assert.equal(result.preview.linkedBrief.problemStatement, "Prüfe [website#12](https://github.com/findmydoc-platform/website/issues/12) und unknown#361");
  assert.equal(result.preview.linkedBrief.intendedOutcome, "Management [management#361](https://github.com/findmydoc-platform/management/issues/361)");
  assert.equal(result.preview.resultingItem.problemStatement, text);
  assert.deepEqual(result.preview.changedFields, ["intendedOutcome"]);
  assert.deepEqual(result.preview.dbPatch, { intended_outcome: "Management management#361" });
});
