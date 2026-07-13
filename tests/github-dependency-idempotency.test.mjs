import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

class MockGitHubApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

async function loadGitHub({ githubJson, githubRequest = async () => new Response(null, { status: 204 }) }) {
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
      GitHubApiError: MockGitHubApiError,
      githubJson,
      githubRequest,
    },
  });
}

test("a lost dependency-add response is reconciled before another POST", async () => {
  let relationshipExists = false;
  let addCalls = 0;
  const github = await loadGitHub({
    githubJson: async (url, options) => {
      if (url.includes("/dependencies/blocked_by?")) {
        return relationshipExists ? [{
          id: 200,
          number: 20,
          html_url: "https://github.com/findmydoc-platform/management/issues/20",
        }] : [];
      }
      if (url.endsWith("/issues/20") && (!options.method || options.method === "GET")) {
        return {
          id: 200,
          number: 20,
          html_url: "https://github.com/findmydoc-platform/management/issues/20",
        };
      }
      if (options.method === "POST") {
        addCalls += 1;
        relationshipExists = true;
        throw new Error("response lost after dependency creation");
      }
      throw new Error(`Unexpected GitHub request: ${options.method || "GET"} ${url}`);
    },
  });
  const input = {
    currentIssueNumber: 10,
    desiredDependencies: [{ blockedIssueNumber: 10, blockingIssueNumber: 20 }],
    managedIssueNumbers: [20],
    repository: "findmydoc-platform/management",
  };

  await assert.rejects(
    () => github.syncGitHubIssueDependencies(input, "installation-token"),
    /response lost/,
  );
  await github.syncGitHubIssueDependencies(input, "installation-token");

  assert.equal(addCalls, 1);
});

test("dependency removal accepts only the requested resource's 404", async () => {
  let request;
  const github = await loadGitHub({
    githubJson: async () => [],
    githubRequest: async (url, options) => {
      request = { url, options };
      return new Response(null, { status: 404 });
    },
  });

  await github.removeGitHubIssueBlockedBy(10, 200, "installation-token", "findmydoc-platform/management");

  assert.match(request.url, /\/issues\/10\/dependencies\/blocked_by\/200$/);
  assert.equal(request.options.method, "DELETE");
  assert.equal(request.options.operation, "mutation");
  assert.deepEqual(request.options.allowedStatuses, [404]);
});

test("dependency removal does not suppress permission failures", async () => {
  const github = await loadGitHub({
    githubJson: async () => [],
    githubRequest: async () => {
      throw new MockGitHubApiError("forbidden", 403);
    },
  });

  await assert.rejects(
    () => github.removeGitHubIssueBlockedBy(10, 200, "installation-token", "findmydoc-platform/management"),
    (error) => error.status === 403,
  );
});

test("dependency sync removes only stale relationships from the managed set", async () => {
  const removed = [];
  const github = await loadGitHub({
    githubJson: async (url) => {
      if (url.includes("/dependencies/blocked_by?")) {
        return [
          { id: 200, number: 20, html_url: "managed" },
          { id: 990, number: 99, html_url: "unmanaged" },
        ];
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    },
    githubRequest: async (url) => {
      removed.push(url);
      return new Response(null, { status: 204 });
    },
  });

  await github.syncGitHubIssueDependencies({
    currentIssueNumber: 10,
    desiredDependencies: [],
    managedIssueNumbers: [20],
    repository: "findmydoc-platform/management",
  }, "installation-token");

  assert.equal(removed.length, 1);
  assert.match(removed[0], /\/blocked_by\/200$/);
});
