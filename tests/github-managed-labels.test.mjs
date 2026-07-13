import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

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
    resolveGitHubIssueNumber: () => null,
  },
  "./github-http": {
    githubJson: async () => ({}),
    githubRequest: async () => new Response(null, { status: 404 }),
  },
});

test("preserves labels that are not managed by FounderOps", () => {
  assert.deepEqual(
    github.mergeGitHubIssueLabels(
      [{ name: "customer-reported" }, { name: "needs-design" }, { name: "P1-High" }],
      ["task", "P2-Medium"],
    ),
    ["customer-reported", "needs-design", "task", "P2-Medium"],
  );
});

test("replaces stale FounderOps status and priority labels", () => {
  assert.deepEqual(
    github.mergeGitHubIssueLabels(
      ["task", "deliverable", "blocked", "P0-Urgent", "manual-label"],
      ["task", "deliverable", "review:ready", "P3-Low"],
    ),
    ["manual-label", "task", "deliverable", "review:ready", "P3-Low"],
  );
});

test("matches managed labels case-insensitively and ignores empty labels", () => {
  assert.deepEqual(
    github.mergeGitHubIssueLabels(
      [{ name: "BLOCKED" }, { name: "Manual-Label" }, { name: "manual-label" }, { name: null }],
      ["task", "changes-requested"],
    ),
    ["Manual-Label", "manual-label", "task", "changes-requested"],
  );
});
