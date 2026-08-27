import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

async function loadUpdateModel() {
  const contract = await importTestModule(
    "src/features/planning-items/model/planning-items-contract.ts",
  );
  const deliverableSchedule = await importTestModule(
    "src/features/planning-items/model/deliverable-schedule.ts",
  );
  return importTestModule("src/features/planning-items/model/planning-item-update.ts", {
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
    "@/features/planning-items/model/planning-items-contract": contract,
    "@/features/planning-items/model/deliverable-schedule": deliverableSchedule,
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

test("Team revise accepts fixedDate and rejects legacy deliverable schedule fields", async () => {
  const model = await loadUpdateModel();
  const expectedUpdatedAt = "2026-08-12T10:00:00.000Z";
  const valid = model.parsePlanningItemPatchPayload({ expectedUpdatedAt, fixedDate: "2026-09-10" });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.presentFields, ["fixedDate"]);
  assert.deepEqual(
    model.planningItemReviseCommand("deliverable-one", "deliverable", expectedUpdatedAt, valid.raw).changes,
    { itemKind: "deliverable", fixedDate: "2026-09-10" },
  );

  for (const field of ["startDate", "endDate", "deadline"]) {
    const result = model.parsePlanningItemPatchPayload({ expectedUpdatedAt, [field]: "2026-09-10" });
    assert.equal(result.ok, false);
    assert.match(result.error, new RegExp(`unbekannte Feld ${field}`));
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
