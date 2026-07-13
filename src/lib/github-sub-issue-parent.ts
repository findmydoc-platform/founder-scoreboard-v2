import type { SupabaseClient } from "@supabase/supabase-js";
import { getGitHubIssue, githubRepoSlug } from "./github";
import { parseGitHubIssueUrl, resolveGitHubIssueNumber } from "./github-issue-reference";
import { ACTIVE_TASKS_TABLE } from "./planning-read-model";
import type { Task } from "./types";

type GitHubSubIssueParentRow = {
  id: string;
  task_type?: string | null;
  approval_status?: string | null;
  github_repo?: string | null;
  github_issue_number?: number | null;
  github_issue_url?: string | null;
  issue_number?: string | null;
  issue_url?: string | null;
};

export type GitHubSubIssueParentContext = {
  repository: string;
  issueNumber: number;
};

function positiveIssueNumber(value: unknown) {
  const number = Number(value || 0);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function assertConsistentParentReference(parent: GitHubSubIssueParentRow, repository: string, issueNumber: number) {
  const directReferences = [parent.github_issue_number, parent.issue_number]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
  if (directReferences.some((value) => positiveIssueNumber(value) !== issueNumber)) {
    throw new Error("Die lokale GitHub-Verknüpfung des Parent-Deliverables ist widersprüchlich.");
  }

  const urlReferences = [parent.github_issue_url, parent.issue_url]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  for (const value of urlReferences) {
    const reference = parseGitHubIssueUrl(value);
    if (
      !reference
      || reference.number !== issueNumber
      || reference.repository.toLowerCase() !== repository.toLowerCase()
    ) {
      throw new Error("Die lokale GitHub-Verknüpfung des Parent-Deliverables ist widersprüchlich.");
    }
  }
}

export async function preflightGitHubSubIssueParent(
  supabase: SupabaseClient,
  task: Pick<Task, "parentTaskId">,
  token: string,
): Promise<GitHubSubIssueParentContext> {
  if (!task.parentTaskId) {
    throw new Error("Das Sub-Issue hat kein Parent-Deliverable.");
  }

  const { data, error } = await supabase
    .from(ACTIVE_TASKS_TABLE)
    .select("id,task_type,approval_status,github_repo,github_issue_number,github_issue_url,issue_number,issue_url")
    .eq("id", task.parentTaskId)
    .maybeSingle();
  if (error) throw new Error(`Parent-Deliverable konnte nicht geprüft werden: ${error.message}`);

  const parent = data as GitHubSubIssueParentRow | null;
  if (!parent) throw new Error("Das Parent-Deliverable ist nicht aktiv oder nicht vorhanden.");
  if (parent.task_type !== "deliverable") throw new Error("Der Parent des Sub-Issues ist kein Deliverable.");
  if (parent.approval_status !== "approved") throw new Error("Das Parent-Deliverable ist nicht freigegeben.");

  const repository = githubRepoSlug(parent.github_repo);
  const issueNumber = resolveGitHubIssueNumber(parent, { repository });
  if (!issueNumber) throw new Error("Das Parent-Deliverable ist noch nicht mit GitHub verknüpft.");
  assertConsistentParentReference(parent, repository, issueNumber);

  const githubIssue = await getGitHubIssue(issueNumber, token, repository);
  const githubReference = parseGitHubIssueUrl(githubIssue.html_url);
  if (
    githubIssue.pull_request
    || githubIssue.number !== issueNumber
    || !githubReference
    || githubReference.number !== issueNumber
    || githubReference.repository.toLowerCase() !== repository.toLowerCase()
  ) {
    throw new Error("Das GitHub Issue des Parent-Deliverables stimmt nicht mit der lokalen Verknüpfung überein.");
  }

  return { repository, issueNumber };
}
