import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const { mapTaskRow } = await loadTranspiledModule("src/lib/planning-task-mappers.ts", {
  "./planning-profile-mappers": {
    profileNameById: (_profiles, profileId) => profileId || "",
  },
  "./status": {
    normalizeSubIssueStatus: (status) => status === "Review" || status === "Nacharbeit" ? "In Arbeit" : status,
  },
});

test("task mapping projects ordered evidence links and linked pull request metadata", () => {
  const task = mapTaskRow(
    {
      id: "task-1",
      title: "Evidence task",
      evidence_link: "https://legacy.example/proof",
    },
    new Map(),
    {
      taskLinks: [
        {
          id: 3,
          task_id: "task-1",
          type: "github_pull_request",
          label: "Close the loop",
          url: "https://github.com/findmydoc-platform/management/pull/88",
          position: 0,
          metadata: {
            repository: "findmydoc-platform/management",
            number: 88,
            status: "merged",
            mergedAt: "2026-07-24T12:00:00Z",
          },
        },
        {
          id: 2,
          task_id: "task-1",
          type: "evidence",
          label: "Second",
          url: "https://notion.so/second",
          position: 1,
          metadata: {},
        },
        {
          id: 1,
          task_id: "task-1",
          type: "evidence",
          label: "First",
          url: "https://github.com/findmydoc-platform/management/issues/1",
          position: 0,
          metadata: {},
        },
      ],
    },
  );

  assert.deepEqual(task.evidenceLinks, [
    "https://github.com/findmydoc-platform/management/issues/1",
    "https://notion.so/second",
  ]);
  assert.equal(task.evidenceLink, task.evidenceLinks[0]);
  assert.deepEqual(task.linkedPullRequests, [{
    title: "Close the loop",
    repository: "findmydoc-platform/management",
    number: 88,
    url: "https://github.com/findmydoc-platform/management/pull/88",
    status: "merged",
    mergedAt: "2026-07-24T12:00:00Z",
  }]);
});

test("legacy single evidence URL remains visible until migrated", () => {
  const task = mapTaskRow({
    id: "task-legacy",
    evidence_link: "https://legacy.example/proof",
  }, new Map());
  assert.deepEqual(task.evidenceLinks, ["https://legacy.example/proof"]);
  assert.equal(task.evidenceLink, "https://legacy.example/proof");
});

test("Sub-Issue context falls back to the legacy description field", () => {
  const row = {
    id: "sub-legacy-context",
    task_type: "sub_issue",
    description: "",
    problem_statement: "Legacy Sub-Issue description",
    intended_outcome: "Legacy outcome",
    scope_constraints: "Legacy scope",
    acceptance_criteria: "Legacy acceptance",
    evidence_required: "Legacy evidence",
    definition_of_done: "Legacy completion",
  };
  const task = mapTaskRow(row, new Map());

  assert.equal(task.description, "Legacy Sub-Issue description");
  assert.equal(task.problemStatement, "Legacy Sub-Issue description");
  assert.equal(task.intendedOutcome, "Legacy outcome");
  assert.equal(task.scopeConstraints, "Legacy scope");
  assert.equal(task.acceptanceCriteria, "Legacy acceptance");
  assert.equal(task.evidenceRequired, "Legacy evidence");
  assert.equal(task.definitionOfDone, "Legacy completion");

  const taskWithParallelContext = mapTaskRow({
    ...row,
    description: "Parallel compact context",
  }, new Map());
  assert.equal(taskWithParallelContext.description, "Parallel compact context");
  assert.equal(taskWithParallelContext.problemStatement, "Legacy Sub-Issue description");
});

test("Sub-Issue read model restores the legacy brief while ignoring active review, score, and evidence links", () => {
  const task = mapTaskRow({
    id: "sub-legacy",
    task_type: "sub_issue",
    status: "Review",
    review_status: "requested",
    review_owner_profile_id: "reviewer",
    score_points: 8,
    score_final: true,
    score_relevant: true,
    evidence_link: "https://legacy.example/proof",
    problem_statement: "Legacy problem",
    evidence_required: "Legacy proof",
  }, new Map(), {
    taskLinks: [{
      id: 4,
      task_id: "sub-legacy",
      type: "github_pull_request",
      label: "Implement work step",
      url: "https://github.com/findmydoc-platform/management/pull/90",
      position: 0,
      metadata: {
        repository: "findmydoc-platform/management",
        number: 90,
        status: "open",
      },
    }],
  });

  assert.equal(task.status, "In Arbeit");
  assert.deepEqual(task.evidenceLinks, []);
  assert.equal(task.evidenceLink, "");
  assert.equal(task.evidenceRequired, "Legacy proof");
  assert.equal(task.reviewStatus, "not_requested");
  assert.equal(task.reviewOwnerProfileId, "");
  assert.equal(task.scorePoints, 0);
  assert.equal(task.scoreFinal, false);
  assert.equal(task.scoreRelevant, false);
  assert.equal(task.linkedPullRequests.length, 1);
  assert.equal(task.linkedPullRequests[0].status, "open");
});
