import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const { taskDetailPermissions } = await loadTranspiledModule(
  "src/features/tasks/model/task-detail-permissions.ts",
  {
    "@/lib/platform": {
      isOperationalLeadRole: (role) => role === "ceo" || role === "deputy",
    },
  },
);

const task = {
  assignee: "founder-1",
  assigneeId: "founder-1",
  owner: "founder-1",
  ownerId: "founder-1",
  reviewOwnerProfileId: "reviewer-1",
  taskType: "sub_issue",
};

test("CEO receives full task detail permissions", () => {
  const permissions = taskDetailPermissions({ task, profile: { id: "ceo", name: "CEO", platformRole: "ceo" } });
  assert.equal(Object.values(permissions).every(Boolean), true);
});

test("Deputy keeps operational rights but not CEO-only controls", () => {
  const permissions = taskDetailPermissions({ task, profile: { id: "deputy", name: "Deputy", platformRole: "deputy" } });
  assert.equal(permissions.canManageTaskMeta, true);
  assert.equal(permissions.canDeleteTask, true);
  assert.equal(permissions.canOpenReview, true);
  assert.equal(permissions.canManageFinalStatus, false);
  assert.equal(permissions.canManageReviewOwner, false);
});

test("assigned Founder can work on own task but cannot change planning metadata", () => {
  const permissions = taskDetailPermissions({ task, profile: { id: "founder-1", name: "Founder One", platformRole: "founder" } });
  assert.equal(permissions.canEditBrief, true);
  assert.equal(permissions.canEditEvidence, true);
  assert.equal(permissions.canEditNotes, true);
  assert.equal(permissions.canReportBlocker, true);
  assert.equal(permissions.canUpdateStatus, true);
  assert.equal(permissions.canManageTaskMeta, false);
  assert.equal(permissions.canDeleteTask, false);
  assert.equal(permissions.canReparentSubIssue, true);
});

test("assigned Founder cannot reparent a Deliverable", () => {
  const permissions = taskDetailPermissions({
    task: { ...task, taskType: "deliverable" },
    profile: { id: "founder-1", name: "Founder One", platformRole: "founder" },
  });
  assert.equal(permissions.canReparentSubIssue, false);
});

test("unrelated Founder can collaborate but cannot mutate task fields", () => {
  const permissions = taskDetailPermissions({ task, profile: { id: "founder-2", name: "Founder Two", platformRole: "founder" } });
  assert.equal(permissions.canComment, true);
  assert.equal(permissions.canEditBrief, false);
  assert.equal(permissions.canEditEvidence, false);
  assert.equal(permissions.canEditNotes, false);
  assert.equal(permissions.canReportBlocker, false);
  assert.equal(permissions.canUpdateStatus, false);
  assert.equal(permissions.canReparentSubIssue, false);
});

test("review owner can open review without receiving task edit rights", () => {
  const permissions = taskDetailPermissions({ task, profile: { id: "reviewer-1", name: "Reviewer", platformRole: "founder" } });
  assert.equal(permissions.canOpenReview, true);
  assert.equal(permissions.canEditBrief, false);
});

test("Viewer remains fully read-only", () => {
  const permissions = taskDetailPermissions({ task, profile: { id: "viewer", name: "Viewer", platformRole: "viewer" } });
  assert.equal(Object.values(permissions).some(Boolean), false);
});
