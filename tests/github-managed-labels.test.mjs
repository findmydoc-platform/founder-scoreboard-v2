import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

async function projectWithLabels(existingLabels, taskOverrides = {}) {
  let patchBody;
  let patchCalls = 0;
  const issueProjection = await loadTranspiledModule("src/lib/github-sync/issue-projection.ts", {
    "../github-repositories": {
      splitGitHubRepository: () => ({
        owner: "findmydoc-platform",
        repo: "management",
        repository: "findmydoc-platform/management",
      }),
    },
    "../github-issue-reference": {
      assertGitHubIssueRepository: () => {},
      parseGitHubIssueUrl: (value) => {
        const match = value.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
        return match ? { repository: match[1], number: Number(match[2]) } : null;
      },
      resolveGitHubIssueNumber: () => 42,
    },
    "../github-http": {
      GitHubApiError: class extends Error {},
      githubRequest: async () => new Response(null, { status: 204 }),
      githubJson: async (_url, options) => {
        if (!options.method || options.method === "GET") {
          return {
            number: 42,
            html_url: "https://github.com/findmydoc-platform/management/issues/42",
            title: "[Deliverable] Keep labels safe",
            body: "<!-- founderops-task-id:task-label-safety -->",
            ...(existingLabels === undefined ? {} : { labels: existingLabels }),
          };
        }
        patchCalls += 1;
        patchBody = options.body;
        return {
          number: 42,
          html_url: "https://github.com/findmydoc-platform/management/issues/42",
        };
      },
    },
  });
  const task = {
    id: "task-label-safety",
    title: "Keep labels safe",
    taskType: "deliverable",
    status: "Offen",
    priority: "P2",
    githubRepo: "findmydoc-platform/management",
    githubIssueNumber: 42,
    githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/42",
    githubIssueLastSyncedAt: "2026-07-01T10:00:00.000Z",
    ...taskOverrides,
  };
  const project = () => issueProjection.projectTaskGitHubIssue({
    task,
    token: "installation-token",
  });
  return { patchBody: () => patchBody, patchCalls: () => patchCalls, project };
}

test("preserves labels that are not managed by FounderOps", async () => {
  const fixture = await projectWithLabels([
    { name: "customer-reported" },
    { name: "needs-design" },
    { name: "P1-High" },
  ]);
  await fixture.project();
  assert.deepEqual(
    fixture.patchBody().labels,
    ["customer-reported", "needs-design", "task", "deliverable", "P2-Medium"],
  );
});

test("replaces stale FounderOps status and priority labels", async () => {
  const fixture = await projectWithLabels(
    ["task", "deliverable", "blocked", "P0-Urgent", "manual-label"],
    { status: "Review", priority: "P3" },
  );
  await fixture.project();
  assert.deepEqual(
    fixture.patchBody().labels,
    ["manual-label", "task", "deliverable", "review:ready", "P3-Low"],
  );
});

test("matches and deduplicates labels case-insensitively while ignoring empty labels", async () => {
  const fixture = await projectWithLabels(
    [{ name: "BLOCKED" }, { name: "Manual-Label" }, { name: "manual-label" }, { name: null }],
    { status: "Nacharbeit", priority: "P4" },
  );
  await fixture.project();
  assert.deepEqual(
    fixture.patchBody().labels,
    ["Manual-Label", "task", "deliverable", "changes-requested"],
  );
});

test("refuses to update when existing labels cannot be read safely", async () => {
  const fixture = await projectWithLabels(undefined);
  await assert.rejects(fixture.project, /nicht sicher gelesen/);
  assert.equal(fixture.patchCalls(), 0);
});
