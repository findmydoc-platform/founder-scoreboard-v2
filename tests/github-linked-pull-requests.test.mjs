import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

async function loadGitHub(githubJson) {
  return loadTranspiledModule("src/lib/github.ts", {
    "./github-repositories": {
      requireAllowedGitHubRepository: (value) => value || "findmydoc-platform/management",
      splitGitHubRepository: (value) => {
        const repository = value || "findmydoc-platform/management";
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
    "./github-issue-reference": {
      assertGitHubIssueRepository: () => {},
      parseGitHubIssueUrl: () => null,
      resolveGitHubIssueNumber: () => null,
    },
    "./github-http": {
      GITHUB_ISSUE_DEPENDENCY_API_VERSION: "2026-03-10",
      GitHubApiError: Error,
      githubJson,
      githubRequest: async () => new Response(null, { status: 204 }),
    },
  });
}

test("linked pull requests include open, merged, and closed native issue relationships", async () => {
  let request;
  const github = await loadGitHub(async (url, options) => {
    request = { url, options };
    return {
      data: {
        repository: {
          issue: {
            closedByPullRequestsReferences: {
              nodes: [
                {
                  title: "Open work",
                  number: 10,
                  url: "https://github.com/findmydoc-platform/management/pull/10",
                  state: "OPEN",
                  merged: false,
                  mergedAt: null,
                  repository: { nameWithOwner: "findmydoc-platform/management" },
                },
                {
                  title: "Merged work",
                  number: 11,
                  url: "https://github.com/findmydoc-platform/website/pull/11",
                  state: "CLOSED",
                  merged: true,
                  mergedAt: "2026-07-24T10:00:00Z",
                  repository: { nameWithOwner: "findmydoc-platform/website" },
                },
                {
                  title: "Closed work",
                  number: 12,
                  url: "https://github.com/findmydoc-platform/management/pull/12",
                  state: "CLOSED",
                  merged: false,
                  mergedAt: null,
                  repository: { nameWithOwner: "findmydoc-platform/management" },
                },
              ],
            },
          },
        },
      },
    };
  });

  const pullRequests = await github.listGitHubIssueLinkedPullRequests(
    42,
    "installation-token",
    "findmydoc-platform/management",
  );

  assert.equal(request.url, "https://api.github.com/graphql");
  assert.equal(request.options.operation, "read");
  assert.match(request.options.body.query, /includeClosedPrs: true/);
  assert.match(request.options.body.query, /userLinkedOnly: false/);
  assert.deepEqual(pullRequests.map((pullRequest) => pullRequest.status), ["open", "merged", "closed"]);
  assert.equal(pullRequests[1].repository, "findmydoc-platform/website");
  assert.equal(pullRequests[1].mergedAt, "2026-07-24T10:00:00Z");
});

test("linked pull request query fails closed when GitHub no longer returns the issue", async () => {
  const github = await loadGitHub(async () => ({ data: { repository: { issue: null } } }));
  await assert.rejects(
    () => github.listGitHubIssueLinkedPullRequests(42, "installation-token", "findmydoc-platform/management"),
    /wurde nicht gefunden/,
  );
});
