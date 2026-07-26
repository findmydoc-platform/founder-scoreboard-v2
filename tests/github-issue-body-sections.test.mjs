import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

async function githubModule() {
  return loadTranspiledModule("src/lib/github.ts", {
    "./github-repositories": {
      requireAllowedGitHubRepository: (value) => value || "findmydoc-platform/management",
      splitGitHubRepository: () => ({
        owner: "findmydoc-platform",
        repo: "management",
        repository: "findmydoc-platform/management",
      }),
    },
    "./github-issue-reference": {
      assertGitHubIssueRepository: () => {},
      resolveGitHubIssueNumber: () => null,
    },
    "./github-http": {
      githubJson: async () => ({}),
      githubRequest: async () => new Response(null, { status: 404 }),
    },
  });
}

function task(overrides = {}) {
  return {
    id: "task-body-sections",
    taskType: "deliverable",
    title: "Keep task brief sections separate",
    description: "Problem",
    problemStatement: "Problem",
    intendedOutcome: "Outcome",
    scopeConstraints: "Constraint",
    acceptanceCriteria: "",
    evidenceRequired: "Evidence",
    definitionOfDone: "Document the result",
    ...overrides,
  };
}

test("github issue body does not reuse definition of done as acceptance criteria", async () => {
  const { taskIssueBody } = await githubModule();
  const body = taskIssueBody(task());

  assert.match(body, /## Acceptance Criteria\n_Nicht gesetzt\._/);
  assert.match(body, /## Definition of Done\n- Document the result/);
  assert.equal(body.match(/Document the result/g)?.length, 1);
  assert.ok(body.indexOf("## Acceptance Criteria") < body.indexOf("## Definition of Done"));
});

test("github issue body keeps explicit acceptance criteria and definition of done separate", async () => {
  const { taskIssueBody } = await githubModule();
  const body = taskIssueBody(task({ acceptanceCriteria: "User sees the saved result" }));

  assert.match(body, /## Acceptance Criteria\n- User sees the saved result/);
  assert.match(body, /## Definition of Done\n- Document the result/);
});

test("Sub-Issue GitHub projection contains only optional context and the FounderOps source", async () => {
  const { taskIssueBody, taskIssueLabels } = await githubModule();
  const subIssue = task({
    taskType: "sub_issue",
    description: "Coordinate the rollout window.",
    status: "Review",
    priority: "P0",
  });
  const body = taskIssueBody(subIssue);

  assert.match(body, /^## Context\nCoordinate the rollout window\.\n\n---\nSource: FounderOps\./);
  assert.match(body, /<!-- founderops-task-id:task-body-sections -->$/);
  assert.doesNotMatch(body, /Problem Statement|Acceptance Criteria|Evidence Required|Definition of Done/);
  assert.deepEqual(taskIssueLabels(subIssue), ["task", "sub-issue"]);
});
