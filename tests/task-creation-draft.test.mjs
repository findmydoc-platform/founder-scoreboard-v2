import assert from "node:assert/strict";
import test from "node:test";

import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const {
  resolveTaskCreationHierarchy,
  taskCreationRequestPayload,
  taskCreationParent,
  taskCreationTitleError,
  withSubIssueParentHierarchy,
  unsupportedSubIssueCreateField,
} = await loadTranspiledModule("src/features/tasks/model/task-creation-draft.ts");

const tasks = [
  {
    id: "deliverable-one",
    taskType: "deliverable",
    packageId: "initiative-one",
    milestoneId: "milestone-one",
  },
  {
    id: "child-one",
    taskType: "sub_issue",
    packageId: "initiative-one",
    milestoneId: "milestone-one",
  },
];

test("Sub-Issue parent selection updates its inherited hierarchy atomically", () => {
  const draft = {
    taskType: "sub_issue",
    parentTaskId: "",
    packageId: "stale-initiative",
    milestoneId: "stale-milestone",
    title: "Keep this value",
  };

  assert.deepEqual(withSubIssueParentHierarchy(draft, tasks, "deliverable-one"), {
    ...draft,
    parentTaskId: "deliverable-one",
    packageId: "initiative-one",
    milestoneId: "milestone-one",
  });
});

test("Sub-Issue hierarchy resolution clears stale context when the parent is unavailable", () => {
  const draft = {
    taskType: "sub_issue",
    parentTaskId: "missing-parent",
    packageId: "stale-initiative",
    milestoneId: "stale-milestone",
  };

  assert.deepEqual(resolveTaskCreationHierarchy(draft, tasks), {
    ...draft,
    packageId: "",
    milestoneId: "",
  });
  assert.equal(taskCreationParent(tasks, "child-one"), null);
});

test("Deliverable hierarchy remains independently editable", () => {
  const draft = {
    taskType: "deliverable",
    parentTaskId: "",
    packageId: "initiative-two",
    milestoneId: "milestone-independent",
  };

  assert.equal(resolveTaskCreationHierarchy(draft, tasks), draft);
});

test("task title validation stays quiet until the field is exposed", () => {
  assert.equal(taskCreationTitleError("", false), "");
  assert.equal(taskCreationTitleError("x", false), "");
  assert.equal(taskCreationTitleError("", true), "Bitte einen Titel eingeben.");
  assert.equal(taskCreationTitleError(" x ", true), "Der Titel benötigt mindestens 3 Zeichen.");
  assert.equal(taskCreationTitleError("Task title", true), "");
});

test("Sub-Issue create requests strip Deliverable-only planning, review, and evidence fields", () => {
  const payload = taskCreationRequestPayload({
    creationRequestId: "019fb484-68c2-7000-8000-000000000001",
    title: "Implement small work step",
    description: "Optional context",
    taskType: "sub_issue",
    parentTaskId: "deliverable-one",
    packageId: "initiative-one",
    milestoneId: "milestone-one",
    assignee: "founder-one",
    githubRepo: "findmydoc-platform/management",
    relationType: "blocked_by",
    relatedTaskId: "dependency-one",
    relationNote: "Wait for the API",
    priority: "P0",
    status: "Review",
    sprintId: "sprint-one",
    acceptanceCriteria: "Legacy acceptance",
    evidenceRequired: "Legacy evidence",
    definitionOfDone: "Legacy quality",
  });

  assert.deepEqual(payload, {
    creationRequestId: "019fb484-68c2-7000-8000-000000000001",
    title: "Implement small work step",
    description: "Optional context",
    taskType: "sub_issue",
    parentTaskId: "deliverable-one",
    assignee: "founder-one",
    githubRepo: "findmydoc-platform/management",
    relationType: "blocked_by",
    relatedTaskId: "dependency-one",
    relationNote: "Wait for the API",
  });
});

test("standard task API rejects every field outside the Sub-Issue create contract", () => {
  const allowed = {
    creationRequestId: "019fb484-68c2-7000-8000-000000000001",
    title: "Implement small work step",
    description: "Optional context",
    taskType: "sub_issue",
    parentTaskId: "deliverable-one",
    assignee: "founder-one",
    githubRepo: "findmydoc-platform/management",
    relationType: "blocked_by",
    relatedTaskId: "dependency-one",
    relationNote: "Wait for the API",
  };
  assert.equal(unsupportedSubIssueCreateField(allowed), "");
  for (const field of ["status", "priority", "acceptanceCriteria", "definitionOfDone", "evidenceLinks", "reviewStatus", "scorePoints"]) {
    assert.equal(unsupportedSubIssueCreateField({ ...allowed, [field]: "forbidden" }), field);
  }
});
