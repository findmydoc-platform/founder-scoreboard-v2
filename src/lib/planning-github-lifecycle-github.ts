import "server-only";

import { createGitHubIssueComment, listGitHubIssueComments } from "./github";
import { githubJson } from "./github-http";
import { splitGitHubRepository } from "./github-repositories";

export type PlanningGitHubLifecycleAction = "close_not_planned" | "reopen";

export function planningGitHubLifecycleCommentMarker(
  action: PlanningGitHubLifecycleAction,
  taskId: string,
  sourceRevision: number,
) {
  return `founderops-planning-lifecycle:${action}:${encodeURIComponent(taskId)}:${sourceRevision}`;
}

async function ensurePlanningGitHubLifecycleComment({
  issueNumber,
  comment,
  marker,
  token,
  repository,
}: {
  issueNumber: number;
  comment: string;
  marker: string;
  token: string;
  repository?: string | null;
}) {
  const markerToken = `<!-- ${marker} -->`;
  const comments = await listGitHubIssueComments(issueNumber, token, repository);
  const existing = comments.find((item) => item.body?.includes(markerToken));
  if (existing) return { created: false, comment: existing };
  const created = await createGitHubIssueComment(issueNumber, comment, token, marker, repository);
  return { created: true, comment: created };
}

export async function closeGitHubIssueNotPlanned({
  issueNumber,
  taskId,
  sourceRevision,
  comment,
  token,
  repository,
}: {
  issueNumber: number;
  taskId: string;
  sourceRevision: number;
  comment: string;
  token: string;
  repository?: string | null;
}) {
  const { owner, repo } = splitGitHubRepository(repository);
  const issue = await githubJson<{ number: number; html_url: string }>(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    token,
    method: "PATCH",
    operation: "mutation",
    body: { state: "closed", state_reason: "not_planned" },
    errorMessage: "GitHub Issue konnte nicht für den Papierkorb geschlossen werden",
  });
  const lifecycleComment = await ensurePlanningGitHubLifecycleComment({
    issueNumber,
    comment,
    marker: planningGitHubLifecycleCommentMarker("close_not_planned", taskId, sourceRevision),
    token,
    repository,
  });
  return { issue, lifecycleComment };
}

export async function reopenGitHubIssueForPlanning({
  issueNumber,
  taskId,
  sourceRevision,
  comment,
  token,
  repository,
}: {
  issueNumber: number;
  taskId: string;
  sourceRevision: number;
  comment: string;
  token: string;
  repository?: string | null;
}) {
  const { owner, repo } = splitGitHubRepository(repository);
  const issue = await githubJson<{ number: number; html_url: string }>(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    token,
    method: "PATCH",
    operation: "mutation",
    body: { state: "open" },
    errorMessage: "GitHub Issue konnte nach der Freigabe nicht wieder geöffnet werden",
  });
  const lifecycleComment = await ensurePlanningGitHubLifecycleComment({
    issueNumber,
    comment,
    marker: planningGitHubLifecycleCommentMarker("reopen", taskId, sourceRevision),
    token,
    repository,
  });
  return { issue, lifecycleComment };
}
