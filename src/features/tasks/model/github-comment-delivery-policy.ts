export type GitHubCommentCandidate = {
  id: number;
  body: string;
  html_url: string;
  user?: { login?: string } | null;
};

export function githubCommentMarker(commentId: number) {
  return `fmd-comment-id:${commentId}`;
}

export function hasGitHubCommentMarker(body: string, commentId: number) {
  return new RegExp(`<!--\\s*${githubCommentMarker(commentId)}\\s*-->`).test(body);
}

function hasAnyGitHubCommentMarker(body: string) {
  return /<!--\s*fmd-comment-id:\d+\s*-->/.test(body);
}

function normalizedCommentBody(value: string) {
  return value.replace(/\n*\s*<!--\s*fmd-comment-id:\d+\s*-->\s*$/, "").trim();
}

export function findExistingGitHubComment(
  comments: GitHubCommentCandidate[],
  input: { commentId: number; authorLogin: string; body: string },
) {
  const marked = comments.find((comment) => hasGitHubCommentMarker(comment.body || "", input.commentId));
  if (marked) return { comment: marked, reason: "marker_reconciled" as const };

  const legacy = comments.find((comment) => (
    !hasAnyGitHubCommentMarker(comment.body || "")
    && (comment.user?.login || "").toLowerCase() === input.authorLogin.toLowerCase()
    && normalizedCommentBody(comment.body || "") === normalizedCommentBody(input.body)
  ));
  return legacy ? { comment: legacy, reason: "legacy_content_reconciled" as const } : null;
}
