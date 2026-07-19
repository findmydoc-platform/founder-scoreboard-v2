import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const planningAppModelMock = {
  reviewOwnerForTask: () => "accountable",
  taskAssigneePatch: () => ({}),
};

const slugMock = {
  slugify: (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "-"),
};

test("review request payload omits protected score and review owner fields", async () => {
  const { buildClientTaskUpdatePatch, taskUpdateRequestPayload } = await loadTranspiledModule("src/features/tasks/model/task-mutation-contract.ts", {
    "@/features/planning/model/planning-app-model": planningAppModelMock,
    "@/lib/slug": slugMock,
  });

  const normalized = buildClientTaskUpdatePatch(
    { id: "task-1", status: "In Arbeit", scoreFinal: false, packageId: "initiative-1" },
    { status: "Review" },
    [],
    [{ id: "initiative-1", ownerId: "owner", accountableProfileId: "accountable" }],
    "2026-07-06T12:00:00.000Z",
  );

  assert.equal(normalized.ok, true);
  assert.equal(normalized.patch.status, "Review");
  assert.equal(normalized.patch.reviewStatus, "requested");
  assert.equal(normalized.patch.scoreFinal, false);
  assert.equal(normalized.patch.reviewOwnerProfileId, "accountable");

  const payload = taskUpdateRequestPayload(normalized.patch, "2026-07-06T11:00:00.000Z");

  assert.equal(payload.expectedUpdatedAt, "2026-07-06T11:00:00.000Z");
  assert.equal(payload.status, "Review");
  assert.equal(payload.reviewStatus, "requested");
  assert.equal(payload.scoreFinal, undefined);
  assert.equal(payload.reviewOwnerProfileId, undefined);
});

test("review requests require an assigned review owner", async () => {
  const { buildClientTaskUpdatePatch } = await loadTranspiledModule("src/features/tasks/model/task-mutation-contract.ts", {
    "@/features/planning/model/planning-app-model": {
      ...planningAppModelMock,
      reviewOwnerForTask: () => "",
    },
    "@/lib/slug": slugMock,
  });

  assert.deepEqual(
    buildClientTaskUpdatePatch(
      { id: "task-1", status: "In Arbeit", scoreFinal: false, packageId: "initiative-1" },
      { status: "Review" },
      [],
      [],
    ),
    { ok: false, error: "Lege vor der Review-Anfrage eine Review-Verantwortung fest." },
  );
});

test("score and review owner payload fields remain available outside review requests", async () => {
  const { taskUpdateRequestPayload } = await loadTranspiledModule("src/features/tasks/model/task-mutation-contract.ts", {
    "@/features/planning/model/planning-app-model": planningAppModelMock,
    "@/lib/slug": slugMock,
  });

  const payload = taskUpdateRequestPayload({
    reviewOwnerProfileId: "ceo",
    scoreFinal: true,
    scorePoints: 8,
  }, "2026-07-06T11:00:00.000Z");

  assert.equal(payload.reviewOwnerProfileId, "ceo");
  assert.equal(payload.scoreFinal, true);
  assert.equal(payload.scorePoints, 8);
});

test("normal task updates omit the server-owned GitHub sync status", async () => {
  const { taskUpdateRequestPayload } = await loadTranspiledModule("src/features/tasks/model/task-mutation-contract.ts", {
    "@/features/planning/model/planning-app-model": planningAppModelMock,
    "@/lib/slug": slugMock,
  });

  const payload = taskUpdateRequestPayload({
    title: "Updated title",
    githubIssueSyncStatus: "synced",
  }, "2026-07-06T11:00:00.000Z");

  assert.equal(payload.title, "Updated title");
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "githubIssueSyncStatus"), false);
});

test("unchanged status payloads become true no-ops before route guards", async () => {
  const { withoutUnchangedTaskStatus } = await loadTranspiledModule("src/features/tasks/model/task-route-update-helpers.ts", {
    "@/features/tasks/model/task-mutation-contract": { taskAssignedToProfile: () => false },
    "@/lib/status": {
      isTaskStatusChange: (current, next) => current !== next,
      normalizeStatus: (status) => status,
      taskStatuses: ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"],
    },
  });

  const unchanged = withoutUnchangedTaskStatus(
    { status: "Review", task_type: "sub_issue" },
    { expectedUpdatedAt: "2026-07-14T10:00:00.000Z", status: "Review" },
  );
  assert.equal(unchanged.statusNoop, true);
  assert.equal(unchanged.payload.status, undefined);
  assert.equal(unchanged.payload.expectedUpdatedAt, "2026-07-14T10:00:00.000Z");

  const invalid = withoutUnchangedTaskStatus(
    { status: "Offen", task_type: "sub_issue" },
    { expectedUpdatedAt: "2026-07-14T10:00:00.000Z", status: "invalid" },
  );
  assert.equal(invalid.statusNoop, false);
  assert.equal(invalid.payload.status, "invalid");
});

test("task brief fields stay together in the shared update payload", async () => {
  const { taskUpdateRequestPayload } = await loadTranspiledModule("src/features/tasks/model/task-mutation-contract.ts", {
    "@/features/planning/model/planning-app-model": planningAppModelMock,
    "@/lib/slug": slugMock,
  });

  const payload = taskUpdateRequestPayload({
    title: "Neuer Titel",
    problemStatement: "Problem",
    intendedOutcome: "Zielbild",
    scopeConstraints: "Umfang",
    acceptanceCriteria: "Kriterium",
    evidenceRequired: "Nachweis",
    definitionOfDone: "Qualitätsstandard",
  }, "2026-07-12T10:00:00.000Z");

  assert.equal(payload.title, "Neuer Titel");
  assert.equal(payload.problemStatement, "Problem");
  assert.equal(payload.intendedOutcome, "Zielbild");
  assert.equal(payload.scopeConstraints, "Umfang");
  assert.equal(payload.acceptanceCriteria, "Kriterium");
  assert.equal(payload.evidenceRequired, "Nachweis");
  assert.equal(payload.definitionOfDone, "Qualitätsstandard");
});

test("Sub-Issue parent updates keep CAS, activity, and sync state together", async () => {
  const { activityMessages, taskUpdateRequestPayload } = await loadTranspiledModule("src/features/tasks/model/task-mutation-contract.ts", {
    "@/features/planning/model/planning-app-model": planningAppModelMock,
    "@/lib/slug": slugMock,
  });
  const { markTaskGitHubSyncDirty } = await loadTranspiledModule("src/features/tasks/model/task-route-update-helpers.ts", {
    "@/features/tasks/model/task-mutation-contract": { taskAssignedToProfile: () => true },
    "@/lib/status": { normalizeStatus: (status) => status, taskStatuses: ["Offen"] },
  });

  const payload = taskUpdateRequestPayload(
    {
      parentTaskId: "deliverable-next",
      packageId: "derived-initiative",
      milestoneId: "derived-milestone",
    },
    "2026-07-13T08:00:00.000Z",
  );
  assert.equal(payload.expectedUpdatedAt, "2026-07-13T08:00:00.000Z");
  assert.equal(payload.parentTaskId, "deliverable-next");
  assert.equal(payload.packageId, undefined);
  assert.equal(payload.milestoneId, undefined);
  assert.deepEqual(activityMessages(payload, { parent_task_id: "deliverable-old" }), [
    "Parent-Deliverable geändert: deliverable-old → deliverable-next",
  ]);

  const update = { parent_task_id: "deliverable-next" };
  markTaskGitHubSyncDirty(update);
  assert.equal(update.github_issue_sync_status, "not_synced");
  assert.equal(update.github_issue_sync_error, null);
});

test("parent Deliverable options include Initiative and inactive approval context", async () => {
  const { parentDeliverableOptions } = await loadTranspiledModule("src/features/tasks/model/task-form-options.ts", {
    "@/lib/display": {
      initiativeOptionLabel: (initiative) => initiative.title,
      taskAssigneeLabel: () => "Owner",
      taskAssigneeOptions: () => [],
    },
    "@/lib/status": { taskStatuses: ["Offen"] },
  });

  assert.deepEqual(parentDeliverableOptions([
    { id: "approved", title: "Approved work", taskType: "deliverable", packageId: "initiative", approvalStatus: "approved" },
    { id: "proposed", title: "Proposed work", taskType: "deliverable", packageId: "initiative", approvalStatus: "proposed" },
    { id: "child", title: "Child", taskType: "sub_issue", packageId: "initiative", approvalStatus: null },
  ], [{ id: "initiative", title: "Growth" }]), [
    { value: "approved", label: "Approved work · Growth" },
    { value: "proposed", label: "Proposed work · Growth · wartet auf Freigabe" },
  ]);
});

test("task route guard allows only the implicit score reset for review requests", async () => {
  const { restrictedTaskUpdateFields } = await loadTranspiledModule("src/features/tasks/model/task-route-update-helpers.ts", {
    "@/features/tasks/model/task-mutation-contract": { taskAssignedToProfile: () => true },
    "@/lib/status": { taskStatuses: ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"] },
  });

  assert.deepEqual(restrictedTaskUpdateFields({ status: "Review", reviewStatus: "requested", scoreFinal: false }), []);
  assert.deepEqual(restrictedTaskUpdateFields({ status: "Review", scoreFinal: true }), ["Score"]);
  assert.deepEqual(restrictedTaskUpdateFields({ status: "Review", scorePoints: 8 }), ["Score"]);
  assert.deepEqual(restrictedTaskUpdateFields({ scoreFinal: false }), ["Score"]);
});

test("generic task updates may request a review but cannot write review outcomes", async () => {
  const { applyReviewStatusUpdate } = await loadTranspiledModule("src/features/tasks/model/task-route-update-helpers.ts", {
    "@/features/tasks/model/task-mutation-contract": { taskAssignedToProfile: () => true },
    "@/lib/status": { taskStatuses: ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"] },
  });

  const update = {};
  assert.deepEqual(applyReviewStatusUpdate(update, { reviewStatus: "requested" }), { ok: true });
  assert.deepEqual(update, { review_status: "requested", score_final: false });

  for (const reviewStatus of ["accepted", "partial", "changes_requested", "not_requested"]) {
    assert.deepEqual(
      applyReviewStatusUpdate({}, { reviewStatus }),
      {
        ok: false,
        error: "Review-Entscheidungen und Übergänge müssen über den jeweiligen Review-Vorgang erfolgen.",
        status: 409,
      },
    );
  }
});

test("task route guard limits role-based final transitions to Sub-Issues", async () => {
  const { applyFinalStatusReopen, validateSubIssueStatusParentApproval, validateTaskStatusUpdate } = await loadTranspiledModule("src/features/tasks/model/task-route-update-helpers.ts", {
    "@/features/tasks/model/task-mutation-contract": {
      taskAssignedToProfile: (task, profile) => task.assignee === profile?.id,
    },
    "@/lib/status": {
      normalizeStatus: (status) => status,
      taskStatuses: ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"],
    },
  });

  const contributorActors = [
    { label: "CEO", id: "ceo", isOperationalLead: true, isCeo: true },
    { label: "Deputy", id: "deputy", isOperationalLead: true, isCeo: false },
    { label: "Founder", id: "founder-2", isOperationalLead: false, isCeo: false },
  ];
  const activeSubIssueStatuses = ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert"];

  for (const actor of contributorActors) {
    for (const status of activeSubIssueStatuses) {
      assert.deepEqual(
        validateTaskStatusUpdate({
          canCompleteSubIssue: true,
          canReopenSubIssue: true,
          currentTask: { status, assignee: "founder-1", task_type: "sub_issue" },
          isOperationalLead: actor.isOperationalLead,
          isCeo: actor.isCeo,
          payload: { status: "Erledigt" },
          profile: { id: actor.id },
        }),
        { ok: true },
        `${actor.label} should complete a foreign Sub-Issue from ${status}`,
      );
    }

    assert.deepEqual(
      validateTaskStatusUpdate({
        canCompleteSubIssue: true,
        canReopenSubIssue: true,
        currentTask: { status: "Erledigt", assignee: "founder-1", task_type: "sub_issue" },
        isOperationalLead: actor.isOperationalLead,
        isCeo: actor.isCeo,
        payload: { status: "Offen" },
        profile: { id: actor.id },
      }),
      { ok: true },
      `${actor.label} should reopen a foreign Sub-Issue`,
    );
  }

  assert.deepEqual(
    validateTaskStatusUpdate({
      canCompleteSubIssue: true,
      canReopenSubIssue: true,
      currentTask: { status: "Offen", assignee: "founder-1", task_type: "sub_issue" },
      isOperationalLead: false,
      isCeo: false,
      payload: { status: "In Arbeit" },
      profile: { id: "founder-2" },
    }),
    { ok: false, error: "Founder können nur den Status ihrer eigenen Aufgaben ändern.", status: 403 },
  );

  assert.deepEqual(
    validateTaskStatusUpdate({
      currentTask: { status: "Offen", assignee: "deputy", task_type: "deliverable" },
      isOperationalLead: true,
      isCeo: false,
      payload: { status: "Erledigt" },
      profile: { id: "deputy" },
    }),
    { ok: false, error: "Founder können Aufgaben nur in Review geben. Final erledigt wird im CEO-Review gesetzt.", status: 403 },
  );

  assert.deepEqual(
    validateTaskStatusUpdate({
      currentTask: { status: "Erledigt", assignee: "founder-1", task_type: "deliverable" },
      isOperationalLead: true,
      isCeo: true,
      payload: { status: "Review" },
      profile: { id: "ceo" },
    }),
    { ok: true },
  );

  assert.deepEqual(
    validateSubIssueStatusParentApproval({
      currentTask: { task_type: "sub_issue" },
      parentApprovalStatus: "approved",
      payload: { status: "Erledigt" },
    }),
    { ok: true },
  );
  assert.deepEqual(
    validateSubIssueStatusParentApproval({
      currentTask: { task_type: "sub_issue" },
      parentApprovalStatus: "proposed",
      payload: { status: "Erledigt" },
    }),
    {
      ok: false,
      error: "Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv.",
      status: 409,
    },
  );
  assert.deepEqual(
    validateSubIssueStatusParentApproval({
      currentTask: { task_type: "deliverable" },
      parentApprovalStatus: "proposed",
      payload: { status: "Erledigt" },
    }),
    { ok: true },
  );

  const founderReopen = {};
  applyFinalStatusReopen(
    founderReopen,
    { status: "Erledigt", task_type: "sub_issue" },
    { status: "Offen" },
    false,
    true,
  );
  assert.deepEqual(founderReopen, {
    score_final: false,
    review_status: "not_requested",
    review_requested_at: null,
  });

  const ceoReopen = {};
  applyFinalStatusReopen(ceoReopen, { status: "Erledigt", task_type: "deliverable" }, { status: "Review" }, true);
  assert.equal(ceoReopen.score_final, false);
  assert.equal(ceoReopen.review_status, "requested");
  assert.equal(typeof ceoReopen.review_requested_at, "string");
});

test("reopen response returns the reset review fields without clearing the review owner", async () => {
  const { buildTaskUpdateResponsePatch } = await loadTranspiledModule("src/features/tasks/model/task-mutation-contract.ts", {
    "@/features/planning/model/planning-app-model": planningAppModelMock,
    "@/lib/slug": slugMock,
  });

  const patch = buildTaskUpdateResponsePatch("sub-issue", {
    status: "Offen",
    score_final: false,
    review_status: "not_requested",
    review_requested_at: null,
  }, false);

  assert.equal(patch.status, "Offen");
  assert.equal(patch.scoreFinal, false);
  assert.equal(patch.reviewStatus, "not_requested");
  assert.equal(patch.reviewRequestedAt, "");
  assert.equal(Object.prototype.hasOwnProperty.call(patch, "reviewOwnerProfileId"), false);
});
