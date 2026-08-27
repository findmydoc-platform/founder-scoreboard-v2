import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("approval domain keeps client affordances and optimistic state aligned", async () => {
  const approval = await importTestModule("src/features/planning/model/approval-domain.ts");
  const initiative = { approvalStatus: "proposed", approvalRevision: 2 };
  const deliverable = {
    taskType: "deliverable",
    approvalStatus: "proposed",
    approvalRevision: 2,
    sprintId: "sprint-1",
    scoreRelevant: true,
  };

  assert.equal(approval.approvalStatusForAction("approve"), "approved");
  assert.equal(approval.approvalStatusForAction("return_to_draft"), "draft");
  assert.deepEqual(approval.applyOptimisticApprovalDecision(initiative, "reject", "Nicht jetzt"), {
    approvalStatus: "rejected",
    approvalRevision: 3,
    decisionNote: "Nicht jetzt",
  });
  assert.deepEqual(approval.applyOptimisticDeliverableApprovalDecision(deliverable, "reject"), {
    ...deliverable,
    approvalStatus: "rejected",
    approvalRevision: 3,
    decisionNote: "",
    sprintId: "",
    scoreRelevant: false,
  });
  const planningData = {
    tasks: [
      { ...deliverable, id: "deliverable-1" },
      { id: "child-1", taskType: "sub_issue", parentTaskId: "deliverable-1", parentApprovalStatus: "proposed" },
      { id: "child-2", taskType: "sub_issue", parentTaskId: "deliverable-2", parentApprovalStatus: "approved" },
    ],
  };
  const approved = approval.applyDeliverableApprovalPatch(planningData, {
    id: "deliverable-1",
    approvalStatus: "approved",
  });
  assert.equal(approved.tasks[0].approvalStatus, "approved");
  assert.equal(approved.tasks[1].parentApprovalStatus, "approved");
  assert.equal(approved.tasks[2].parentApprovalStatus, "approved");
  const reset = approval.applyDeliverableApprovalPatch(approved, {
    id: "deliverable-1",
    approvalStatus: "proposed",
  });
  assert.equal(reset.tasks[1].parentApprovalStatus, "proposed");
  assert.equal(reset.tasks[2].parentApprovalStatus, "approved");
  assert.equal(approval.isTaskPlanningActive({ taskType: "sub_issue", approvalStatus: null, parentApprovalStatus: "approved" }), true);
  assert.equal(approval.canApproveDeliverableApproval(deliverable, { accountableProfileId: "owner-1", approvalStatus: "approved" }, { id: "owner-1", platformRole: "founder" }), true);
  assert.equal(approval.canRejectDeliverableApproval(deliverable, { accountableProfileId: "owner-1", approvalStatus: "proposed" }, { id: "owner-1", platformRole: "founder" }), true);
  assert.equal(approval.canApproveDeliverableApproval(deliverable, { accountableProfileId: "owner-1", approvalStatus: "approved" }, { id: "deputy-1", platformRole: "deputy" }), true);
  assert.equal(approval.canRejectDeliverableApproval(deliverable, { accountableProfileId: "owner-1", approvalStatus: "proposed" }, { id: "deputy-1", platformRole: "deputy" }), true);
  assert.equal(approval.canDecideInitiativeApproval(initiative, { platformRole: "deputy" }), true);
  assert.equal(approval.canDecideInitiativeApproval(initiative, { platformRole: "founder" }), false);
});

test("github issue references preserve repository matching before reuse", async () => {
  const references = await importTestModule("src/lib/github-issue-reference.ts");

  assert.deepEqual(references.parseGitHubIssueUrl("https://github.com/findmydoc-platform/management/issues/42"), {
    repository: "findmydoc-platform/management",
    number: 42,
  });
  assert.equal(references.resolveGitHubIssueNumber({ issue_url: "https://github.com/findmydoc-platform/website/issues/7" }, {
    repository: "findmydoc-platform/management",
  }), null);
  assert.equal(references.resolveGitHubIssueNumber({ github_issue_number: 12 }, {
    repository: "findmydoc-platform/management",
  }), 12);
});

test("deliverables always use management while sub issues may choose an allowed repository", async () => {
  const repositories = await importTestModule("src/lib/github-repositories.ts");

  assert.deepEqual(repositories.resolveTaskGitHubRepository("deliverable", "findmydoc-platform/management"), {
    ok: true,
    repository: "findmydoc-platform/management",
  });
  assert.deepEqual(repositories.resolveTaskGitHubRepository("sub_issue", "findmydoc-platform/website"), {
    ok: true,
    repository: "findmydoc-platform/website",
  });
  assert.deepEqual(repositories.resolveTaskGitHubRepository("deliverable", "findmydoc-platform/website"), {
    ok: false,
    error: "Deliverables werden ausschließlich nach findmydoc-platform/management projiziert.",
  });
});
