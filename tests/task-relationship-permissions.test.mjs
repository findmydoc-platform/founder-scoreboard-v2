import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const { taskRelationshipAccess } = await loadTranspiledModule(
  "src/features/tasks/model/task-relationship-permissions.ts",
  {
    "@/lib/platform": {
      isOperationalLeadRole: (role) => role === "ceo" || role === "deputy",
    },
  },
);

const deliverable = {
  id: "cm-tool",
  taskType: "deliverable",
  assignee: "owner-1",
  owner: "owner-1",
};
const blockedBy = {
  id: 1,
  taskId: deliverable.id,
  relatedTaskId: "requirements",
  relationType: "blocked_by",
};

test("owner can manage only outgoing blocked_by relations on own deliverable", () => {
  const access = taskRelationshipAccess({
    task: deliverable,
    profile: { id: "owner-1", name: "Owner", platformRole: "founder" },
  });

  assert.deepEqual(access.allowedRelationTypes, ["blocked_by"]);
  assert.equal(access.canRemoveRelation(blockedBy), true);
  assert.equal(access.canRemoveRelation({ ...blockedBy, taskId: "requirements", relatedTaskId: deliverable.id }), false);
  assert.equal(access.canRemoveRelation({ ...blockedBy, relationType: "relates_to" }), false);
});

test("initiative accountable can manage blocked_by without owning either task", () => {
  const access = taskRelationshipAccess({
    task: deliverable,
    initiative: { accountableProfileId: "accountable-1" },
    profile: { id: "accountable-1", name: "Accountable", platformRole: "founder" },
  });

  assert.deepEqual(access.allowedRelationTypes, ["blocked_by"]);
  assert.equal(access.canRemoveRelation(blockedBy), true);
});

test("founder can manage blocked_by on an owned sub-issue but not on a proposal", () => {
  const profile = { id: "owner-1", name: "Owner", platformRole: "founder" };
  const subIssueAccess = taskRelationshipAccess({ task: { ...deliverable, taskType: "sub_issue" }, profile });
  const proposalAccess = taskRelationshipAccess({ task: { ...deliverable, taskType: "proposal" }, profile });

  assert.deepEqual(subIssueAccess.allowedRelationTypes, ["blocked_by"]);
  assert.deepEqual(proposalAccess.allowedRelationTypes, []);
});

test("unrelated founders and viewers remain read-only", () => {
  const unrelated = taskRelationshipAccess({
    task: deliverable,
    profile: { id: "founder-2", name: "Other", platformRole: "founder" },
  });
  const viewer = taskRelationshipAccess({
    task: { ...deliverable, assignee: "viewer-1", owner: "viewer-1" },
    profile: { id: "viewer-1", name: "Viewer", platformRole: "viewer" },
  });

  assert.deepEqual(unrelated.allowedRelationTypes, []);
  assert.deepEqual(viewer.allowedRelationTypes, []);
});

test("CEO and Deputy keep full relationship management", () => {
  for (const platformRole of ["ceo", "deputy"]) {
    const access = taskRelationshipAccess({
      task: deliverable,
      profile: { id: platformRole, name: platformRole, platformRole },
    });

    assert.deepEqual(access.allowedRelationTypes, ["blocked_by", "blocks", "relates_to"]);
    assert.equal(access.canRemoveRelation({ ...blockedBy, taskId: "another-task" }), true);
  }
});
