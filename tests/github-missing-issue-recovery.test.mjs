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

function sourceTask() {
  return {
    id: "task-missing-issue",
    title: "Recover a deleted issue",
    taskType: "deliverable",
    status: "Offen",
    priority: "P2",
    githubRepo: "findmydoc-platform/management",
    githubIssueNumber: 42,
    githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/42",
  };
}

async function loadGitHub({
  updateStatus = 404,
  searchStatus = 200,
  searchItems = [],
  searchIncomplete = false,
  fallbackStatus = 200,
} = {}) {
  const requests = [];
  const task = sourceTask();
  const github = await loadTranspiledModule("src/lib/github.ts", {
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
      parseGitHubIssueUrl: (value) => {
        const match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
        return match ? { repository: match[1], number: Number(match[2]) } : null;
      },
      resolveGitHubIssueNumber: (value) => value.githubIssueNumber || null,
    },
    "./github-http": {
      GitHubApiError: MockGitHubApiError,
      githubJson: async (url, options) => {
        requests.push({ kind: "json", url, ...options });
        if ((!options.method || options.method === "GET") && url.endsWith("/issues/42")) {
          throw new MockGitHubApiError("missing", updateStatus);
        }
        if ((!options.method || options.method === "GET") && url.endsWith("/issues/77")) {
          return {
            number: 77,
            html_url: "https://github.com/findmydoc-platform/management/issues/77",
            title: "Recovered marker issue",
            body: "<!-- founderops-task-id:task-missing-issue -->",
            labels: [],
          };
        }
        if (options.method === "PATCH") {
          return { number: 77, html_url: "https://github.com/findmydoc-platform/management/issues/77" };
        }
        if (options.method === "POST") {
          return { number: 88, html_url: "https://github.com/findmydoc-platform/management/issues/88" };
        }
        throw new Error(`Unexpected JSON request: ${options.method || "GET"} ${url}`);
      },
      githubRequest: async (url) => {
        requests.push({ kind: "request", url, method: "GET" });
        if (url.includes("/search/issues")) {
          return new Response(JSON.stringify({ incomplete_results: searchIncomplete, items: searchItems }), { status: searchStatus });
        }
        return new Response(JSON.stringify([]), { status: fallbackStatus });
      },
    },
  });
  return { github, requests, task };
}

test("reuses a marker-owned issue after the linked issue returns 404", async () => {
  const marker = "<!-- founderops-task-id:task-missing-issue -->";
  const { github, requests, task } = await loadGitHub({
    searchItems: [{
      number: 77,
      html_url: "https://github.com/findmydoc-platform/management/issues/77",
      body: marker,
    }],
  });

  const issue = await github.upsertGitHubIssue(task, "installation-token");

  assert.equal(issue.number, 77);
  assert.equal(issue.recovered, true);
  assert.equal(issue.recreated, false);
  assert.equal(requests.some((request) => request.method === "POST"), false);
});

test("creates one replacement only after a successful marker lookup confirms absence", async () => {
  const { github, requests, task } = await loadGitHub();

  const issue = await github.upsertGitHubIssue(task, "installation-token");

  assert.equal(issue.number, 88);
  assert.equal(issue.recovered, false);
  assert.equal(issue.recreated, true);
  assert.equal(requests.filter((request) => request.method === "POST").length, 1);
});

test("does not create a replacement when every marker lookup fails", async () => {
  const { github, requests, task } = await loadGitHub({ searchStatus: 503, fallbackStatus: 503 });

  await assert.rejects(() => github.upsertGitHubIssue(task, "installation-token"), /Abwesenheit eines FounderOps-Issues konnte nicht bestätigt/);
  assert.equal(requests.some((request) => request.method === "POST"), false);
});

for (const scenario of [
  { name: "the search endpoint fails", options: { searchStatus: 503 } },
  { name: "the repository fallback fails", options: { fallbackStatus: 503 } },
  { name: "GitHub reports incomplete search results", options: { searchIncomplete: true } },
]) {
  test(`does not create a replacement when ${scenario.name}`, async () => {
    const { github, requests, task } = await loadGitHub(scenario.options);

    await assert.rejects(
      () => github.upsertGitHubIssue(task, "installation-token"),
      /Abwesenheit eines FounderOps-Issues konnte nicht bestätigt/,
    );
    assert.equal(requests.some((request) => request.method === "POST"), false);
  });
}

test("does not search or create when the linked issue update fails with a non-404 error", async () => {
  const { github, requests, task } = await loadGitHub({ updateStatus: 500 });

  await assert.rejects(() => github.upsertGitHubIssue(task, "installation-token"), /missing/);
  assert.equal(requests.some((request) => request.kind === "request"), false);
  assert.equal(requests.some((request) => request.method === "POST"), false);
});
