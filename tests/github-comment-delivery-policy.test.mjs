import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const policy = await loadTranspiledModule("src/features/tasks/model/github-comment-delivery-policy.ts");

test("github comment delivery recognizes its durable marker before posting", () => {
  const existing = policy.findExistingGitHubComment([
    {
      id: 42,
      body: "Changed text\n\n<!-- fmd-comment-id:17 -->",
      html_url: "https://github.com/findmydoc-platform/management/issues/1#issuecomment-42",
      user: { login: "somebody-else" },
    },
  ], { commentId: 17, authorLogin: "original-author", body: "Original text" });

  assert.equal(policy.githubCommentMarker(17), "fmd-comment-id:17");
  assert.equal(existing?.comment.id, 42);
  assert.equal(existing?.reason, "marker_reconciled");
});

test("legacy comment reconciliation requires issue-local exact author and content", () => {
  const comments = [
    { id: 1, body: "Exact content", html_url: "one", user: { login: "wrong-author" } },
    { id: 2, body: "Different content", html_url: "two", user: { login: "original-author" } },
    { id: 3, body: "Exact content", html_url: "three", user: { login: "Original-Author" } },
  ];
  const existing = policy.findExistingGitHubComment(comments, {
    commentId: 99,
    authorLogin: "original-author",
    body: "Exact content",
  });

  assert.equal(existing?.comment.id, 3);
  assert.equal(existing?.reason, "legacy_content_reconciled");
});

test("legacy reconciliation accepts the pre-canonicalized body after a lost success response", () => {
  const existing = policy.findExistingGitHubComment([
    {
      id: 4,
      body: "Ping @sebastian",
      html_url: "four",
      user: { login: "original-author" },
    },
  ], {
    commentId: 100,
    authorLogin: "original-author",
    body: "Ping @SebastianSchuetze",
    legacyBodies: ["Ping @sebastian"],
  });

  assert.equal(existing?.comment.id, 4);
  assert.equal(existing?.reason, "legacy_content_reconciled");
});

test("legacy reconciliation never reuses a comment carrying another FounderOps marker", () => {
  const existing = policy.findExistingGitHubComment([
    {
      id: 1,
      body: "Exact content\n\n<!-- fmd-comment-id:98 -->",
      html_url: "one",
      user: { login: "original-author" },
    },
  ], { commentId: 99, authorLogin: "original-author", body: "Exact content" });

  assert.equal(existing, null);
});
