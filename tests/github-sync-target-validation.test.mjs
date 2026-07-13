import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const references = await loadTranspiledModule("src/lib/github-issue-reference.ts");

function sourceTask(overrides = {}) {
  return {
    id: "task-target-validation",
    title: "Validate linked target",
    taskType: "deliverable",
    status: "Offen",
    priority: "P2",
    githubRepo: "findmydoc-platform/management",
    githubIssueNumber: 42,
    githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/42",
    issueNumber: "42",
    issueUrl: "https://github.com/findmydoc-platform/management/issues/42",
    ...overrides,
  };
}

async function loadGitHub(target) {
  const requests = [];
  const github = await loadTranspiledModule("src/lib/github.ts", {
    "./github-repositories": {
      requireAllowedGitHubRepository: (value) => value || "findmydoc-platform/management",
      splitGitHubRepository: (value) => {
        const repository = value || "findmydoc-platform/management";
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
    "./github-issue-reference": references,
    "./github-http": {
      githubRequest: async () => new Response(null, { status: 404 }),
      githubJson: async (url, options) => {
        requests.push({ url, ...options });
        if (!options.method || options.method === "GET") return target;
        return { number: 42, html_url: "https://github.com/findmydoc-platform/management/issues/42" };
      },
    },
  });
  return { github, requests };
}

test("updates a linked issue carrying the matching FounderOps marker", async () => {
  const task = sourceTask();
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: task.githubIssueUrl,
    title: "Title may have changed in GitHub",
    body: `Existing body\n${githubMarker(task.id)}`,
  });

  await github.upsertGitHubIssue(task, "installation-token");

  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET", "PATCH"]);
});

test("rejects a loaded issue with a different number before patching", async () => {
  const task = sourceTask();
  const { github, requests } = await loadGitHub({
    number: 99,
    html_url: task.githubIssueUrl,
    title: "Validate linked target",
    body: githubMarker(task.id),
  });

  await assert.rejects(() => github.upsertGitHubIssue(task, "installation-token"), /stimmt nicht mit der lokalen Verknüpfung/);
  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET"]);
});

test("rejects contradictory local issue numbers and URLs without a GitHub write", async () => {
  const task = sourceTask({ githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/43" });
  const { github, requests } = await loadGitHub({});

  await assert.rejects(() => github.upsertGitHubIssue(task, "installation-token"), /widersprechen sich/);
  assert.equal(requests.length, 0);
});

test("rejects pull requests before patching", async () => {
  const task = sourceTask();
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: "https://github.com/findmydoc-platform/management/pull/42",
    title: "Validate linked target",
    body: githubMarker(task.id),
    pull_request: {},
  });

  await assert.rejects(() => github.upsertGitHubIssue(task, "installation-token"), /Pull Request statt auf ein Issue/);
  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET"]);
});

test("allows a legacy link only when the issue title matches exactly", async () => {
  const task = sourceTask();
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: task.githubIssueUrl,
    title: "[Deliverable] Validate linked target",
    body: "Legacy issue without a FounderOps marker",
  });

  await github.upsertGitHubIssue(task, "installation-token");
  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET", "PATCH"]);
});

test("rejects an unrelated issue even when its number and repository match", async () => {
  const task = sourceTask();
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: task.githubIssueUrl,
    title: "[Deliverable] Validate linked target",
    body: githubMarker("another-task"),
  });

  await assert.rejects(() => github.upsertGitHubIssue(task, "installation-token"), /gehört nicht zu dieser FounderOps-Aufgabe/);
  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET"]);
});

function githubMarker(taskId) {
  return `<!-- founderops-task-id:${taskId} -->`;
}
