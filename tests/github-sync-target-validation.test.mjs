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
    githubIssueLastSyncedAt: "",
    issueNumber: "42",
    issueUrl: "https://github.com/findmydoc-platform/management/issues/42",
    ...overrides,
  };
}

async function loadGitHub(target) {
  const requests = [];
  const github = await loadTranspiledModule("src/lib/github-sync/issue-projection.ts", {
    "../github-repositories": {
      requireAllowedGitHubRepository: (value) => value || "findmydoc-platform/management",
      splitGitHubRepository: (value) => {
        const repository = value || "findmydoc-platform/management";
        const [owner, repo] = repository.split("/");
        return { owner, repo, repository };
      },
    },
    "../github-issue-reference": references,
    "../github-http": {
      GitHubApiError: class extends Error {},
      githubRequest: async () => new Response(null, { status: 404 }),
      githubJson: async (url, options) => {
        requests.push({ url, ...options });
        if (!options.method || options.method === "GET") return { labels: [], ...target };
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

  await github.projectTaskGitHubIssue({ task, token: "installation-token" });

  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET", "PATCH"]);
});

test("reconstructs a stored Sub-Issue work brief instead of preserving stale GitHub text", async () => {
  const task = sourceTask({
    taskType: "sub_issue",
    description: "Keep this established GitHub description.",
    problemStatement: "Keep this established GitHub description.",
    githubIssueLastSyncedAt: "2026-07-26T10:00:00.000Z",
  });
  const existingBody = [
    "## Problem Statement",
    "Keep this established GitHub description.",
    "",
    "## Acceptance Criteria",
    "- Existing detail remains available.",
    "",
    githubMarker(task.id),
  ].join("\n");
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: task.githubIssueUrl,
    title: "[Sub-Issue] Validate linked target",
    body: existingBody,
  });

  await github.projectTaskGitHubIssue({ task, token: "installation-token" });

  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET", "PATCH"]);
  assert.match(requests[1].body.body, /^## Context\nKeep this established GitHub description\./);
  assert.match(requests[1].body.body, /## Problem Statement\nKeep this established GitHub description\./);
  assert.doesNotMatch(requests[1].body.body, /Existing detail remains available/);
});

test("projects compact context when no optional work brief is stored", async () => {
  const task = sourceTask({
    taskType: "sub_issue",
    description: "New compact context.",
    problemStatement: "",
    githubIssueLastSyncedAt: "2026-07-26T10:00:00.000Z",
  });
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: task.githubIssueUrl,
    title: "[Sub-Issue] Validate linked target",
    body: [
      "## Problem Statement",
      "Legacy description.",
      "",
      githubMarker(task.id),
    ].join("\n"),
  });

  await github.projectTaskGitHubIssue({ task, token: "installation-token" });

  assert.match(requests[1].body.body, /^## Context\nNew compact context\./);
  assert.doesNotMatch(requests[1].body.body, /Legacy description/);
});

test("updates compact context containing a legacy-looking Markdown heading", async () => {
  const task = sourceTask({
    taskType: "sub_issue",
    description: "Updated context.\n\n## Acceptance Criteria\nThis heading is context, not a legacy brief.",
    problemStatement: "",
    githubIssueLastSyncedAt: "2026-07-26T10:00:00.000Z",
  });
  const existingBody = [
    "## Context",
    "Old context.",
    "",
    "## Acceptance Criteria",
    "This heading is context, not a legacy brief.",
    "",
    "---",
    "Source: FounderOps.",
    githubMarker(task.id),
  ].join("\n");
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: task.githubIssueUrl,
    title: "[Sub-Issue] Validate linked target",
    body: existingBody,
  });

  await github.projectTaskGitHubIssue({ task, token: "installation-token" });

  assert.match(requests[1].body.body, /^## Context\nUpdated context\./);
  assert.doesNotMatch(requests[1].body.body, /Old context/);
});

test("adds the durable marker without replacing a legacy Sub-Issue description", async () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://founder-ops.findmydoc.eu";

  try {
    const task = sourceTask({
      taskType: "sub_issue",
      description: "",
      githubIssueLastSyncedAt: "2026-07-26T10:00:00.000Z",
    });
    const existingBody = [
      "## Problem Statement",
      "Keep the legacy GitHub description.",
      "",
      `Source: [FounderOps](${process.env.APP_URL}/tasks/${task.id}).`,
    ].join("\n");
    const { github, requests } = await loadGitHub({
      number: 42,
      html_url: task.githubIssueUrl,
      title: "[Sub-Issue] Validate linked target",
      body: existingBody,
    });

    await github.projectTaskGitHubIssue({ task, token: "installation-token" });

    assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET", "PATCH"]);
    assert.equal(requests[1].body.body, `${existingBody}\n\n${githubMarker(task.id)}`);
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});

test("clears a managed Sub-Issue body after all optional context and work-brief fields are removed", async () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://founder-ops.findmydoc.eu";

  try {
    const task = sourceTask({
      taskType: "sub_issue",
      description: "",
      problemStatement: "",
      intendedOutcome: "",
      scopeConstraints: "",
      acceptanceCriteria: "",
      evidenceRequired: "",
      definitionOfDone: "",
      githubIssueLastSyncedAt: "2026-07-26T10:00:00.000Z",
    });
    const { github, requests } = await loadGitHub({
      number: 42,
      html_url: task.githubIssueUrl,
      title: "[Sub-Issue] Validate linked target",
      body: [
        "## Context",
        "Removed context.",
        "",
        "## Problem Statement",
        "Removed brief.",
        "",
        githubMarker(task.id),
      ].join("\n"),
    });

    await github.projectTaskGitHubIssue({ task, token: "installation-token" });

    assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET", "PATCH"]);
    assert.equal(requests[1].body.body, [
      "---",
      `Source: [FounderOps](${process.env.APP_URL}/tasks/${task.id}).`,
      githubMarker(task.id),
    ].join("\n"));
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});

test("rejects a loaded issue with a different number before patching", async () => {
  const task = sourceTask();
  const { github, requests } = await loadGitHub({
    number: 99,
    html_url: task.githubIssueUrl,
    title: "Validate linked target",
    body: githubMarker(task.id),
  });

  await assert.rejects(() => github.projectTaskGitHubIssue({ task, token: "installation-token" }), /stimmt nicht mit der lokalen Verknüpfung/);
  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET"]);
});

test("rejects contradictory local issue numbers and URLs without a GitHub write", async () => {
  const task = sourceTask({ githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/43" });
  const { github, requests } = await loadGitHub({});

  await assert.rejects(() => github.projectTaskGitHubIssue({ task, token: "installation-token" }), /widersprechen sich/);
  assert.equal(requests.length, 0);
});

test("rejects contradictory local issue number fields without a GitHub write", async () => {
  const task = sourceTask({ issueNumber: "43" });
  const { github, requests } = await loadGitHub({});

  await assert.rejects(() => github.projectTaskGitHubIssue({ task, token: "installation-token" }), /widersprechen sich/);
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

  await assert.rejects(() => github.projectTaskGitHubIssue({ task, token: "installation-token" }), /Pull Request statt auf ein Issue/);
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

  await github.projectTaskGitHubIssue({ task, token: "installation-token" });
  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET", "PATCH"]);
});

test("rejects a title-only legacy match after the task was synced before", async () => {
  const task = sourceTask({ githubIssueLastSyncedAt: "2026-07-13T12:00:00.000Z" });
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: task.githubIssueUrl,
    title: "[Deliverable] Validate linked target",
    body: "Issue without a FounderOps marker",
  });

  await assert.rejects(() => github.projectTaskGitHubIssue({ task, token: "installation-token" }), /gehört nicht zu dieser FounderOps-Aufgabe/);
  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET"]);
});

test("repairs a previously synced legacy issue carrying the exact FounderOps task link", async () => {
  const previousAppUrl = process.env.APP_URL;
  process.env.APP_URL = "https://founder-ops.findmydoc.eu";

  try {
    const task = sourceTask({ githubIssueLastSyncedAt: "2026-07-13T12:00:00.000Z" });
    const { github, requests } = await loadGitHub({
      number: 42,
      html_url: task.githubIssueUrl,
      title: "Title changed after the original sync",
      body: `Planning context: [Open in FounderOps](${process.env.APP_URL}/tasks/${task.id}). GitHub issue sync keeps the working issue aligned.`,
    });

    await github.projectTaskGitHubIssue({ task, token: "installation-token" });

    assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET", "PATCH"]);
    assert.equal(requests[1].body.body.includes(githubMarker(task.id)), true);
  } finally {
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  }
});

test("repairs a previously synced oldest-format issue carrying the exact Founder Scoreboard task id", async () => {
  const task = sourceTask({ githubIssueLastSyncedAt: "2026-05-26T23:53:21.000Z" });
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: task.githubIssueUrl,
    title: "[Deliverable] Validate linked target",
    body: [
      "## Source of Truth",
      `- Founder Scoreboard v2 Task ID: ${task.id}`,
      "- Sync-Ziel: findmydoc-platform/management",
    ].join("\n"),
  });

  await github.projectTaskGitHubIssue({ task, token: "installation-token" });

  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET", "PATCH"]);
  assert.equal(requests[1].body.body.includes(githubMarker(task.id)), true);
});

test("rejects an oldest-format issue carrying a different Founder Scoreboard task id", async () => {
  const task = sourceTask({ githubIssueLastSyncedAt: "2026-05-26T23:53:21.000Z" });
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: task.githubIssueUrl,
    title: "[Deliverable] Validate linked target",
    body: [
      "## Source of Truth",
      "- Founder Scoreboard v2 Task ID: another-task",
      "- Sync-Ziel: findmydoc-platform/management",
    ].join("\n"),
  });

  await assert.rejects(() => github.projectTaskGitHubIssue({ task, token: "installation-token" }), /gehört nicht zu dieser FounderOps-Aufgabe/);
  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET"]);
});

test("rejects an oldest-format issue carrying matching and conflicting Founder Scoreboard task ids", async () => {
  const task = sourceTask({ githubIssueLastSyncedAt: "2026-05-26T23:53:21.000Z" });
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: task.githubIssueUrl,
    title: "[Deliverable] Validate linked target",
    body: [
      "## Source of Truth",
      `- Founder Scoreboard v2 Task ID: ${task.id}`,
      "- Founder Scoreboard v2 Task ID: another-task",
      "- Sync-Ziel: findmydoc-platform/management",
    ].join("\n"),
  });

  await assert.rejects(() => github.projectTaskGitHubIssue({ task, token: "installation-token" }), /gehört nicht zu dieser FounderOps-Aufgabe/);
  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET"]);
});

test("rejects a loaded issue from another repository before patching", async () => {
  const task = sourceTask();
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: "https://github.com/findmydoc-platform/website/issues/42",
    title: "[Deliverable] Validate linked target",
    body: githubMarker(task.id),
  });

  await assert.rejects(() => github.projectTaskGitHubIssue({ task, token: "installation-token" }), /stimmt nicht mit der lokalen Verknüpfung/);
  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET"]);
});

test("rejects an unrelated issue even when its number and repository match", async () => {
  const task = sourceTask();
  const { github, requests } = await loadGitHub({
    number: 42,
    html_url: task.githubIssueUrl,
    title: "[Deliverable] Validate linked target",
    body: githubMarker("another-task"),
  });

  await assert.rejects(() => github.projectTaskGitHubIssue({ task, token: "installation-token" }), /gehört nicht zu dieser FounderOps-Aufgabe/);
  assert.deepEqual(requests.map((request) => request.method || "GET"), ["GET"]);
});

function githubMarker(taskId) {
  return `<!-- founderops-task-id:${taskId} -->`;
}
