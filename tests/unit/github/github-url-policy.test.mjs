import assert from "node:assert/strict";
import { test } from "vitest";

import { importTestModule } from "../../helpers/vitest-module.mjs";

const urlPolicy = await importTestModule("src/lib/github-url-policy.ts");
const platform = await importTestModule("src/lib/platform.ts");

test("GitHub issue URL policy accepts canonical issue and pull request URLs", () => {
  assert.equal(urlPolicy.isGitHubIssueUrl("https://github.com/findmydoc-platform/management/issues/42"), true);
  assert.equal(urlPolicy.isGitHubIssueUrl("https://github.com/findmydoc-platform/management/pull/42/files"), true);
});

test("GitHub issue URL policy rejects misleading hosts, credentials, and paths", () => {
  for (const value of [
    "https://evilgithub.com/findmydoc-platform/management/issues/42",
    "https://github.com.evil.test/findmydoc-platform/management/issues/42",
    "https://evil.test/github.com/findmydoc-platform/management/issues/42",
    "https://github.com@evil.test/findmydoc-platform/management/issues/42",
    "http://github.com/findmydoc-platform/management/issues/42",
    "https://github.com/findmydoc-platform/management/projects/42",
  ]) {
    assert.equal(urlPolicy.isGitHubIssueUrl(value), false, value);
  }
});

test("hasGitHubIssue only accepts parsed GitHub URLs when no issue number is present", () => {
  const emptyTask = {
    githubIssueNumber: null,
    githubIssueUrl: "",
    issueNumber: "",
    issueUrl: "",
  };

  assert.equal(platform.hasGitHubIssue({ ...emptyTask, issueUrl: "https://github.com.evil.test/o/r/issues/1" }), false);
  assert.equal(platform.hasGitHubIssue({ ...emptyTask, githubIssueUrl: "https://github.com/o/r/issues/1" }), true);
  assert.equal(platform.hasGitHubIssue({ ...emptyTask, githubIssueNumber: 1 }), true);
});
