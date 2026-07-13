import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

function task() {
  return {
    id: "task-assignee-sync",
    title: "Keep GitHub assignee aligned",
    taskType: "deliverable",
    status: "Offen",
    priority: "P2",
    githubIssueNumber: 42,
    githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/42",
    issueNumber: "",
    issueUrl: "",
  };
}

async function githubModule(assigneeStatus) {
  let patchBody;
  const github = await loadTranspiledModule("src/lib/github.ts", {
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
      resolveGitHubIssueNumber: () => 42,
    },
    "./github-http": {
      githubRequest: async () => {
        if (assigneeStatus instanceof Error) throw assigneeStatus;
        return new Response(null, { status: assigneeStatus });
      },
      githubJson: async (_url, options) => {
        patchBody = options.body;
        return {
          number: 42,
          html_url: "https://github.com/findmydoc-platform/management/issues/42",
        };
      },
    },
  });
  return { ...github, patchBody: () => patchBody };
}

test("github sync assigns a verified login", async () => {
  const github = await githubModule(204);

  await github.upsertGitHubIssue(task(), "installation-token", { login: "founder" });

  assert.deepEqual(github.patchBody().assignees, ["founder"]);
});

test("github sync clears a stale assignee when the responsible profile has no login", async () => {
  const github = await githubModule(204);

  const result = await github.upsertGitHubIssue(task(), "installation-token");

  assert.deepEqual(github.patchBody().assignees, []);
  assert.match(result.warnings[0], /keinen GitHub-Login/);
});

test("github sync clears a stale assignee when the new login is not assignable", async () => {
  const github = await githubModule(404);

  const result = await github.upsertGitHubIssue(task(), "installation-token", { login: "outside-user" });

  assert.deepEqual(github.patchBody().assignees, []);
  assert.match(result.warnings[0], /nicht zuweisbar/);
});

test("github sync preserves the existing assignee when validation fails transiently", async () => {
  const github = await githubModule(503);

  const result = await github.upsertGitHubIssue(task(), "installation-token", { login: "founder" });

  assert.equal(Object.hasOwn(github.patchBody(), "assignees"), false);
  assert.match(result.warnings[0], /konnte nicht geprüft werden/);
});

test("github sync preserves the existing assignee when validation cannot reach GitHub", async () => {
  const github = await githubModule(new Error("network unavailable"));

  const result = await github.upsertGitHubIssue(task(), "installation-token", { login: "founder" });

  assert.equal(Object.hasOwn(github.patchBody(), "assignees"), false);
  assert.match(result.warnings[0], /konnte nicht geprüft werden/);
});
