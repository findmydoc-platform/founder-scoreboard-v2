import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

async function githubModule(githubHttp = {}) {
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
      parseGitHubIssueUrl: (value) => {
        const match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
        return match ? { repository: match[1], number: Number(match[2]) } : null;
      },
      resolveGitHubIssueNumber: (task) => task.githubIssueNumber || null,
    },
    "./github-http": {
      githubJson: async () => ({}),
      githubRequest: async () => new Response(null, { status: 404 }),
      ...githubHttp,
    },
  });
}

test("preserves labels that are not managed by FounderOps", async () => {
  const github = await githubModule();

  assert.deepEqual(
    github.mergeGitHubIssueLabels(
      [{ name: "customer-reported" }, { name: "needs-design" }, { name: "P1-High" }],
      ["task", "P2-Medium"],
    ),
    ["customer-reported", "needs-design", "task", "P2-Medium"],
  );
});

test("replaces stale FounderOps status and priority labels", async () => {
  const github = await githubModule();

  assert.deepEqual(
    github.mergeGitHubIssueLabels(
      ["task", "deliverable", "blocked", "P0-Urgent", "manual-label"],
      ["task", "deliverable", "review:ready", "P3-Low"],
    ),
    ["manual-label", "task", "deliverable", "review:ready", "P3-Low"],
  );
});

test("matches and deduplicates labels case-insensitively while ignoring empty labels", async () => {
  const github = await githubModule();

  assert.deepEqual(
    github.mergeGitHubIssueLabels(
      [{ name: "BLOCKED" }, { name: "Manual-Label" }, { name: "manual-label" }, { name: null }],
      ["task", "changes-requested"],
    ),
    ["Manual-Label", "task", "changes-requested"],
  );
});

test("refuses to update when existing labels cannot be read safely", async () => {
  let patchCalls = 0;
  const github = await githubModule({
    githubJson: async (_url, options) => {
      if (options.method === "PATCH") patchCalls += 1;
      return {
        number: 42,
        html_url: "https://github.com/findmydoc-platform/management/issues/42",
        title: "[Deliverable] Keep labels safe",
        body: "<!-- founderops-task-id:task-label-safety -->",
      };
    },
  });

  await assert.rejects(
    () => github.upsertGitHubIssue({
      id: "task-label-safety",
      title: "Keep labels safe",
      taskType: "deliverable",
      status: "Offen",
      priority: "P2",
      githubIssueNumber: 42,
    }, "installation-token"),
    /nicht sicher gelesen/,
  );
  assert.equal(patchCalls, 0);
});
