import assert from "node:assert/strict";
import test from "node:test";
import {
  buildChatMessage,
  buildGoogleChatPayload,
  buildReleaseContext,
  buildReleaseNotes,
  buildWorkflowDispatchPayload,
  determineSemverBump,
  extractPrSummary,
  selectReleasePullRequests,
} from "../.agents/skills/fmd-release-publish/scripts/lib.mjs";

function pr(overrides = {}) {
  return {
    number: 17,
    title: "Smooth auth boot and GitHub reconnect flow",
    body: "## Zusammenfassung\n\n- Supabase Auth nutzt jetzt SSR-kompatible Cookies.\n\n## Validierung\n\n- pnpm test",
    url: "https://github.com/findmydoc-platform/founder-scoreboard-v2/pull/17",
    mergedAt: "2026-06-18T13:44:07Z",
    baseRefName: "main",
    headRefName: "feature/auth-flow-smoothing",
    author: { login: "SebastianSchuetze", is_bot: false },
    closingIssuesReferences: [],
    ...overrides,
  };
}

test("initial release selection starts at PR 17 and ignores older setup PRs", () => {
  const selected = selectReleasePullRequests([
    pr({ number: 1, title: "github actions deployment copy" }),
    pr({ number: 16, title: "remove unused wrapper" }),
    pr({ number: 17 }),
    pr({ number: 94, title: "feat: add path-based workspace routes" }),
  ]);

  assert.deepEqual(selected.map((pullRequest) => pullRequest.number), [17, 94]);
});

test("semver bump follows conventional release rules after the first tag", () => {
  assert.equal(determineSemverBump([{ subject: "fix: keep task detail panel local" }]), "patch");
  assert.equal(determineSemverBump([{ subject: "feat: add path-based workspace routes" }]), "minor");
  assert.equal(determineSemverBump([{ subject: "feat!: replace planning hierarchy" }]), "major");
  assert.equal(determineSemverBump([{ subject: "refactor: move helpers", body: "BREAKING CHANGE: schema changed" }]), "major");
});

test("PR summary extraction prefers management and summary sections over validation output", () => {
  const managementSummary = extractPrSummary(pr({
    body: `## Management summary

### Deutsch

FounderOps wird für Betreiber klarer steuerbar.

### English

FounderOps is easier to operate.

## Validation

- pnpm test`,
  }));
  assert.equal(managementSummary, "FounderOps wird für Betreiber klarer steuerbar.");

  const fallbackSummary = extractPrSummary(pr({
    body: `## What changed

- GitHub-Sync nutzt native Assignees.

## Checks

- /Users/razorspoint/Library/pnpm/pnpm test`,
  }));
  assert.equal(fallbackSummary, "GitHub-Sync nutzt native Assignees.");
});

test("release narrative filters bot maintenance PRs but keeps them in release notes", () => {
  const releasePlan = {
    rangeLabel: "PR #17 bis origin/main",
    targetCommit: "abc123",
    pullRequests: [
      pr(),
      pr({
        number: 24,
        title: "chore(deps): bump dependabot/fetch-metadata from 2.3.0 to 3.1.0",
        headRefName: "dependabot/github_actions/dependabot/fetch-metadata-3.1.0",
        author: { login: "app/dependabot", is_bot: true },
      }),
    ],
  };

  const context = buildReleaseContext(releasePlan.pullRequests);
  assert.deepEqual(context.stakeholderPullRequests.map((pullRequest) => pullRequest.number), [17]);
  assert.deepEqual(context.maintenancePullRequests.map((pullRequest) => pullRequest.number), [24]);

  const notes = buildReleaseNotes({ releaseTag: "v0.1.0", releasePlan });
  assert.match(notes, /## Maintenance/);
  assert.match(notes, /#24/);

  const chat = buildChatMessage({
    releaseTag: "v0.1.0",
    releasePlan,
    releaseUrl: "https://github.com/findmydoc-platform/founder-scoreboard-v2/releases/tag/v0.1.0",
  });
  assert.match(chat, /FounderOps Release v0\.1\.0 ist live/);
  assert.match(chat, /nicht die findmydoc Website/);
  assert.match(chat, /1 produktrelevante PRs/);
  assert.doesNotMatch(chat, /#24/);
});

test("Google Chat send path builds workflow payloads without local webhook use", () => {
  const payload = buildGoogleChatPayload("FounderOps Release v0.1.0 ist live.", "v0.1.0");
  assert.deepEqual(payload, {
    text: "FounderOps Release v0.1.0 ist live.",
    thread: { threadKey: "founderops-release-v0.1.0" },
  });

  const dispatch = buildWorkflowDispatchPayload({
    ref: "main",
    inputs: {
      message_payload_json: JSON.stringify(payload),
      release_tag: "v0.1.0",
    },
  });
  assert.equal(dispatch.ref, "main");
  assert.match(dispatch.inputs.message_payload_json, /FounderOps Release v0\.1\.0/);
});
