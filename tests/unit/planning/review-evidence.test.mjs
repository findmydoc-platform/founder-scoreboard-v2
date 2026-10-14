import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const evidence = await importTestModule("src/features/reviews/model/review-evidence.ts");

test("stored review evidence uses one qualification rule across legacy links and task links", () => {
  assert.equal(evidence.storedReviewEvidenceIsValid("https://example.com/legacy", []), true);
  assert.equal(evidence.storedReviewEvidenceIsValid(null, [{
    type: "github_issue",
    url: "https://github.com/findmydoc-platform/management/issues/1",
    metadata: {},
  }]), false);
  assert.equal(evidence.storedReviewEvidenceIsValid(null, [{
    type: "evidence",
    url: "https://example.com/release-notes",
    metadata: {},
  }]), true);
  assert.equal(evidence.storedReviewEvidenceIsValid(null, [{
    type: "github_pull_request",
    url: "https://github.com/findmydoc-platform/website/pull/42",
    metadata: {},
  }]), false);
  assert.equal(evidence.storedReviewEvidenceIsValid(null, [{
    type: "github_pull_request",
    url: "https://github.com/findmydoc-platform/website/pull/42",
    metadata: { repository: "findmydoc-platform/website", number: 42, status: "merged" },
  }]), true);
});
