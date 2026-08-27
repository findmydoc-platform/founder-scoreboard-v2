import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

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
    status: "Offen",
    priority: "P2",
    githubRepo: "findmydoc-platform/management",
    githubIssueNumber: null,
    githubIssueUrl: "",
    issueNumber: "",
    issueUrl: "",
    githubIssueLastSyncedAt: "",
    evidenceLink: "",
    ...overrides,
  };
}

async function projectIssue(sourceTask) {
  let createdBody;
  let createdLabels;
  const issueProjection = await importTestModule("src/lib/github-sync/issue-projection.ts", {
    "../github-repositories": {
      splitGitHubRepository: () => ({
        owner: "findmydoc-platform",
        repo: "management",
        repository: "findmydoc-platform/management",
      }),
    },
    "../github-issue-reference": {
      assertGitHubIssueRepository: () => {},
      resolveGitHubIssueNumber: () => null,
    },
    "../github-http": {
      GitHubApiError: class extends Error {},
      githubRequest: async (url) => (
        url.includes("/search/issues")
          ? new Response(JSON.stringify({ incomplete_results: false, items: [] }), { status: 200 })
          : new Response(JSON.stringify([]), { status: 200 })
      ),
      githubJson: async (_url, options) => {
        if (options.method !== "POST") throw new Error("Unexpected GitHub request.");
        createdBody = options.body.body;
        createdLabels = options.body.labels;
        return {
          number: 42,
          html_url: "https://github.com/findmydoc-platform/management/issues/42",
        };
      },
    },
  });
  await issueProjection.projectTaskGitHubIssue({
    task: sourceTask,
    token: "installation-token",
  });
  return { body: createdBody, labels: createdLabels };
}

test("github issue body does not reuse definition of done as acceptance criteria", async () => {
  const { body } = await projectIssue(task());

  assert.match(body, /## Acceptance Criteria\n_Nicht gesetzt\._/);
  assert.match(body, /## Definition of Done\n- Document the result/);
  assert.equal(body.match(/Document the result/g)?.length, 1);
  assert.ok(body.indexOf("## Acceptance Criteria") < body.indexOf("## Definition of Done"));
});

test("github issue body keeps explicit acceptance criteria and definition of done separate", async () => {
  const { body } = await projectIssue(task({ acceptanceCriteria: "User sees the saved result" }));

  assert.match(body, /## Acceptance Criteria\n- User sees the saved result/);
  assert.match(body, /## Definition of Done\n- Document the result/);
});

test("Sub-Issue GitHub projection contains only optional context and the FounderOps source", async () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://founder-ops.findmydoc.eu";
  try {
    const { body, labels } = await projectIssue(task({
      taskType: "sub_issue",
      description: "Coordinate the rollout window.",
      problemStatement: "",
      intendedOutcome: "",
      scopeConstraints: "",
      acceptanceCriteria: "",
      evidenceRequired: "",
      definitionOfDone: "",
      status: "Review",
      priority: "P0",
    }));

    assert.match(body, /^## Context\nCoordinate the rollout window\.\n\n---\nSource: \[FounderOps\]\(https:\/\/founder-ops\.findmydoc\.eu\/tasks\/task-body-sections\)\./);
    assert.match(body, /<!-- founderops-task-id:task-body-sections -->$/);
    assert.doesNotMatch(body, /Problem Statement|Acceptance Criteria|Evidence Required|Definition of Done/);
    assert.deepEqual(labels, ["task", "sub-issue"]);
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});

test("Sub-Issue GitHub projection writes every populated optional work-brief section", async () => {
  const { body } = await projectIssue(task({
    taskType: "sub_issue",
    description: "Legacy problem",
    problemStatement: "Legacy problem",
    intendedOutcome: "Legacy outcome",
    scopeConstraints: "Legacy scope",
    acceptanceCriteria: "Legacy acceptance",
    evidenceRequired: "Legacy evidence",
    definitionOfDone: "Legacy completion",
  }));

  assert.match(body, /^## Context\nLegacy problem/);
  assert.match(body, /## Problem Statement\nLegacy problem/);
  assert.match(body, /## Intended Outcome\nLegacy outcome/);
  assert.match(body, /## Scope & Constraints\n- Legacy scope/);
  assert.match(body, /## Acceptance Criteria\n- Legacy acceptance/);
  assert.match(body, /## Evidence Required\nLegacy evidence/);
  assert.match(body, /## Definition of Done\n- Legacy completion/);
  assert.match(body, /<!-- founderops-task-id:task-body-sections -->$/);
});

test("Sub-Issue GitHub projection omits empty optional work-brief sections", async () => {
  const { body } = await projectIssue(task({
    taskType: "sub_issue",
    description: "",
    problemStatement: "Only this problem is useful.",
    intendedOutcome: "",
    scopeConstraints: "",
    acceptanceCriteria: "",
    evidenceRequired: "",
    definitionOfDone: "",
  }));

  assert.match(body, /^## Problem Statement\nOnly this problem is useful\./);
  assert.doesNotMatch(body, /## Context|## Intended Outcome|## Scope & Constraints|## Acceptance Criteria|## Evidence Required|## Definition of Done/);
  assert.doesNotMatch(body, /_Nicht gesetzt\._/);
});
