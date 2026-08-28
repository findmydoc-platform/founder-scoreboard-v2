import assert from "node:assert/strict";
import { test } from "vitest";

import { importTestModule } from "../../helpers/vitest-module.mjs";

const {
  resolveTaskCreationHierarchy,
  taskCreationRequestPayload,
  taskCreationParent,
  taskCreationTitleError,
  withSubIssueParentHierarchy,
  unsupportedSubIssueCreateField,
} = await importTestModule("src/features/tasks/model/task-creation-draft.ts");

const tasks = [
  {
    id: "deliverable-one",
    taskType: "deliverable",
    parentTaskId: "initiative-one",
  },
  {
    id: "child-one",
    taskType: "sub_issue",
    parentTaskId: "deliverable-one",
  },
];

test("Sub-Issue parent selection updates its inherited hierarchy atomically", () => {
  const draft = {
    taskType: "sub_issue",
    parentTaskId: "",
    title: "Keep this value",
  };

  assert.deepEqual(withSubIssueParentHierarchy(draft, tasks, "deliverable-one"), {
    ...draft,
    parentTaskId: "deliverable-one",
  });
});

test("Sub-Issue hierarchy resolution clears stale context when the parent is unavailable", () => {
  const draft = {
    taskType: "sub_issue",
    parentTaskId: "missing-parent",
  };

  assert.deepEqual(resolveTaskCreationHierarchy(draft, tasks), draft);
  assert.equal(taskCreationParent(tasks, "child-one"), null);
});

test("Deliverable hierarchy remains independently editable", () => {
  const draft = {
    taskType: "deliverable",
    parentTaskId: "initiative-two",
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

test("compact Sub-Issue creation keeps optional work brief fields for the edit form", () => {
  const payload = taskCreationRequestPayload({
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
    ownerId: "founder-one",
    githubRepo: "findmydoc-platform/management",
    relationType: "blocked_by",
    relatedTaskId: "dependency-one",
    relationNote: "Wait for the API",
  });
});

test("manual Deliverable creation excludes the client-only GitHub flag from the API payload", () => {
  const payload = taskCreationRequestPayload({
    creationRequestId: "019fb484-68c2-7000-8000-000000000002",
    title: "Create policy for AI content",
    description: "Optional context",
    problemStatement: "The policy is missing.",
    intendedOutcome: "The policy is approved.",
    scopeConstraints: "Website content only.",
    acceptanceCriteria: "Labels are documented.",
    evidenceRequired: "Link the approved policy.",
    taskType: "deliverable",
    parentTaskId: "initiative-one",
    assignee: "founder-one",
    priority: "P2",
    status: "Offen",
    workstream: "Legal",
    fixedDate: "2026-09-06",
    targetDate: "",
    hours: 4,
    definitionOfDone: "The policy is published.",
    createGitHubIssue: true,
    approveNow: false,
    githubRepo: "findmydoc-platform/management",
    relationType: "blocked_by",
    relatedTaskId: "",
    relationNote: "",
  });

  assert.deepEqual(payload, {
    creationRequestId: "019fb484-68c2-7000-8000-000000000002",
    title: "Create policy for AI content",
    description: "Optional context",
    problemStatement: "The policy is missing.",
    intendedOutcome: "The policy is approved.",
    scopeConstraints: "Website content only.",
    acceptanceCriteria: "Labels are documented.",
    evidenceRequired: "Link the approved policy.",
    taskType: "deliverable",
    parentTaskId: "initiative-one",
    ownerId: "founder-one",
    priority: "P2",
    status: "Offen",
    workstream: "Legal",
    fixedDate: "2026-09-06",
    targetDate: "",
    hours: 4,
    definitionOfDone: "The policy is published.",
    approveNow: false,
    githubRepo: "findmydoc-platform/management",
    relationType: "blocked_by",
    relatedTaskId: "",
    relationNote: "",
  });
});

test("standard task API accepts optional Sub-Issue work brief fields but rejects operational fields", () => {
  const allowed = {
    creationRequestId: "019fb484-68c2-7000-8000-000000000001",
    title: "Implement small work step",
    description: "Optional context",
    taskType: "sub_issue",
    parentTaskId: "deliverable-one",
    ownerId: "founder-one",
    githubRepo: "findmydoc-platform/management",
    relationType: "blocked_by",
    relatedTaskId: "dependency-one",
    relationNote: "Wait for the API",
  };
  const withBrief = {
    ...allowed,
    problemStatement: "Problem",
    intendedOutcome: "Outcome",
    scopeConstraints: "Scope",
    acceptanceCriteria: "Acceptance",
    evidenceRequired: "Evidence context",
    definitionOfDone: "Quality standard",
  };
  assert.equal(unsupportedSubIssueCreateField(withBrief), "");
  for (const field of ["status", "priority", "evidenceLinks", "reviewStatus", "scorePoints", "assignee", "owner"]) {
    assert.equal(unsupportedSubIssueCreateField({ ...withBrief, [field]: "forbidden" }), field);
  }
});
