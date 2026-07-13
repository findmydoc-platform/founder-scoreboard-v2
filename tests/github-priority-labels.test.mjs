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

test("github priority labels keep P4 distinct from P3", async () => {
  const { taskIssueLabels } = await githubModule();
  const task = { taskType: "deliverable", status: "Offen" };

  assert.deepEqual(taskIssueLabels({ ...task, priority: "P0" }), ["task", "deliverable", "P0-Urgent"]);
  assert.deepEqual(taskIssueLabels({ ...task, priority: "P1" }), ["task", "deliverable", "P1-High"]);
  assert.deepEqual(taskIssueLabels({ ...task, priority: "P2" }), ["task", "deliverable", "P2-Medium"]);
  assert.deepEqual(taskIssueLabels({ ...task, priority: "P3" }), ["task", "deliverable", "P3-Low"]);
  assert.deepEqual(taskIssueLabels({ ...task, priority: "P4" }), ["task", "deliverable"]);
});
