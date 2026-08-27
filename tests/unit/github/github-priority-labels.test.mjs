import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("github priority labels keep P4 distinct from P3", async () => {
  const createdLabels = [];
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
        createdLabels.push(options.body.labels);
        return { number: 42, html_url: "https://github.com/findmydoc-platform/management/issues/42" };
      },
    },
  });
  const baseTask = {
    id: "task-priority",
    taskType: "deliverable",
    title: "Priority",
    status: "Offen",
    githubRepo: "findmydoc-platform/management",
    githubIssueNumber: null,
    githubIssueUrl: "",
    issueNumber: "",
    issueUrl: "",
    githubIssueLastSyncedAt: "",
  };
  for (const priority of ["P0", "P1", "P2", "P3", "P4"]) {
    await issueProjection.projectTaskGitHubIssue({
      task: { ...baseTask, id: `task-${priority}`, priority },
      token: "installation-token",
    });
  }

  assert.deepEqual(createdLabels, [
    ["task", "deliverable", "P0-Urgent"],
    ["task", "deliverable", "P1-High"],
    ["task", "deliverable", "P2-Medium"],
    ["task", "deliverable", "P3-Low"],
    ["task", "deliverable"],
  ]);
});
