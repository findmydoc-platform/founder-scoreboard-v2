import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const { taskDetailPermissions, taskStatusOptionsForPermissions } = await importTestModule(
  "src/features/tasks/model/task-detail-permissions.ts",
  {
    "@/lib/platform": {
      isOperationalLeadRole: (role) => role === "ceo" || role === "deputy",
    },
    "@/features/tasks/model/planning-item-capabilities": {
      strategicPlanningStatuses: ["Offen", "In Arbeit", "Pausiert", "Blockiert", "Erledigt"],
    },
    "@/lib/status": {
      normalizeStatus: (status) => status,
      normalizeSubIssueStatus: (status) => status === "Review" || status === "Nacharbeit" ? "In Arbeit" : status,
      SUB_ISSUE_STATUSES: ["Offen", "In Arbeit", "Blockiert", "Erledigt"],
      taskStatuses: ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"],
    },
    "@/features/reviews/model/task-review-state": {
      isTaskReviewFinal: (task) => task.scoreFinal && task.reviewStatus === "accepted",
      isTaskReviewLocked: (task) => task.reviewStatus === "requested" || Boolean(task.scoreFinal && task.reviewStatus === "accepted"),
    },
  },
);

const task = {
  assignee: "founder-1",
  assigneeId: "founder-1",
  owner: "founder-1",
  ownerId: "founder-1",
  reviewOwnerProfileId: "reviewer-1",
  reviewStatus: "not_requested",
  scoreFinal: false,
  status: "In Arbeit",
  taskType: "sub_issue",
};

const deliverableTask = { ...task, taskType: "deliverable" };

test("CEO keeps operational Sub-Issue rights without review, evidence, or nesting controls", () => {
  const permissions = taskDetailPermissions({ task, profile: { id: "ceo", name: "CEO", platformRole: "ceo" } });
  assert.equal(permissions.canEditBrief, true);
  assert.equal(permissions.canCompleteSubIssue, true);
  assert.equal(permissions.canReopenSubIssue, true);
  assert.equal(permissions.canCreateSubIssue, false);
  assert.equal(permissions.canEditChecklist, false);
  assert.equal(permissions.canEditEvidence, false);
  assert.equal(permissions.canOpenReview, false);
  assert.equal(permissions.canManageReviewOwner, false);
});

test("Deputy keeps operational rights but not CEO-only controls", () => {
  const permissions = taskDetailPermissions({ task, profile: { id: "deputy", name: "Deputy", platformRole: "deputy" } });
  assert.equal(permissions.canManageTaskMeta, true);
  assert.equal(permissions.canOpenReview, false);
  assert.equal(permissions.canManageFinalStatus, false);
  assert.equal(permissions.canManageReviewOwner, false);
  assert.equal(permissions.canCompleteSubIssue, true);
  assert.equal(permissions.canReopenSubIssue, true);
  assert.equal(permissions.canUpdateWorkingStatus, true);
});

test("assigned Founder can work on own task but cannot change planning metadata", () => {
  const permissions = taskDetailPermissions({ task, profile: { id: "founder-1", name: "Founder One", platformRole: "founder" } });
  assert.equal(permissions.canEditBrief, true);
  assert.equal(permissions.canEditEvidence, false);
  assert.equal(permissions.canEditNotes, false);
  assert.equal(permissions.canReportBlocker, true);
  assert.equal(permissions.canUpdateStatus, true);
  assert.equal(permissions.canManageTaskMeta, false);
  assert.equal(permissions.canReparentSubIssue, true);
});

test("assigned Founder cannot reparent a Deliverable", () => {
  const permissions = taskDetailPermissions({
    task: { ...task, taskType: "deliverable" },
    profile: { id: "founder-1", name: "Founder One", platformRole: "founder" },
  });
  assert.equal(permissions.canReparentSubIssue, false);
});

test("unrelated Founder can only close or reopen a Sub-Issue", () => {
  const permissions = taskDetailPermissions({ task, profile: { id: "founder-2", name: "Founder Two", platformRole: "founder" } });
  assert.equal(permissions.canComment, true);
  assert.equal(permissions.canEditBrief, false);
  assert.equal(permissions.canEditEvidence, false);
  assert.equal(permissions.canEditNotes, false);
  assert.equal(permissions.canReportBlocker, false);
  assert.equal(permissions.canCompleteSubIssue, true);
  assert.equal(permissions.canReopenSubIssue, true);
  assert.equal(permissions.canUpdateStatus, true);
  assert.equal(permissions.canUpdateWorkingStatus, false);
  assert.equal(permissions.canReparentSubIssue, false);
});

test("unrelated Founder receives no status right for a Deliverable", () => {
  const permissions = taskDetailPermissions({
    task: { ...task, taskType: "deliverable" },
    profile: { id: "founder-2", name: "Founder Two", platformRole: "founder" },
  });
  assert.equal(permissions.canCompleteSubIssue, false);
  assert.equal(permissions.canReopenSubIssue, false);
  assert.equal(permissions.canUpdateStatus, false);
});

test("review owner can open review without receiving task edit rights", () => {
  const permissions = taskDetailPermissions({ task: deliverableTask, profile: { id: "reviewer-1", name: "Reviewer", platformRole: "founder" } });
  assert.equal(permissions.canOpenReview, true);
  assert.equal(permissions.canEditBrief, false);
});

test("active and final reviews keep comments open while locking business mutations", () => {
  for (const reviewTask of [
    { ...task, reviewStatus: "requested", scoreFinal: false },
    { ...task, reviewStatus: "accepted", scoreFinal: true },
  ]) {
    const permissions = taskDetailPermissions({ task: { ...reviewTask, taskType: "deliverable" }, profile: { id: "founder-1", name: "Founder One", platformRole: "founder" } });
    assert.equal(permissions.canComment, true);
    assert.equal(permissions.canEditBrief, false);
    assert.equal(permissions.canCreateSubIssue, false);
    assert.equal(permissions.canUpdateStatus, false);
  }
});

test("minor rework unlocks the issue for the assignee", () => {
  const permissions = taskDetailPermissions({
    task: { ...deliverableTask, reviewStatus: "partial", scoreFinal: false },
    profile: { id: "founder-1", name: "Founder One", platformRole: "founder" },
  });
  assert.equal(permissions.canEditBrief, true);
  assert.equal(permissions.canUpdateWorkingStatus, true);
});

test("completed items keep comments and the explicit reopen transition but lock every content mutation", () => {
  const permissions = taskDetailPermissions({
    task: { ...deliverableTask, status: "Erledigt", reviewStatus: "accepted", scoreFinal: true },
    profile: { id: "ceo", name: "CEO", platformRole: "ceo" },
  });
  assert.equal(permissions.canComment, true);
  assert.equal(permissions.canEditBrief, false);
  assert.equal(permissions.canEditEvidence, false);
  assert.equal(permissions.canEditNotes, false);
  assert.equal(permissions.canManageTaskMeta, false);
  assert.equal(permissions.canReportBlocker, false);
  assert.equal(permissions.canCreateSubIssue, false);
  assert.equal(permissions.canUpdateStatus, true);
  assert.deepEqual(taskStatusOptionsForPermissions("Erledigt", permissions, "deliverable"), ["Erledigt", "Offen"]);
});

test("Viewer remains fully read-only", () => {
  const permissions = taskDetailPermissions({ task, profile: { id: "reviewer-1", name: "Viewer", platformRole: "viewer" } });
  assert.equal(Object.values(permissions).some(Boolean), false);
});

test("status options expose only the role-allowed Sub-Issue transitions", () => {
  const foreignFounder = taskDetailPermissions({ task, profile: { id: "founder-2", name: "Founder Two", platformRole: "founder" } });
  assert.deepEqual(taskStatusOptionsForPermissions("In Arbeit", foreignFounder, "sub_issue"), ["In Arbeit", "Erledigt"]);
  assert.deepEqual(taskStatusOptionsForPermissions("Erledigt", foreignFounder, "sub_issue"), ["Erledigt", "Offen"]);

  const ownFounder = taskDetailPermissions({ task, profile: { id: "founder-1", name: "Founder One", platformRole: "founder" } });
  assert.deepEqual(taskStatusOptionsForPermissions("Nacharbeit", ownFounder, "sub_issue"), ["Offen", "In Arbeit", "Blockiert", "Erledigt"]);

  const viewer = taskDetailPermissions({ task, profile: { id: "viewer", name: "Viewer", platformRole: "viewer" } });
  assert.deepEqual(taskStatusOptionsForPermissions("Offen", viewer, "sub_issue"), ["Offen"]);
});
