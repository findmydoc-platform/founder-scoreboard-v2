import type { Task } from "./types";

const owner = process.env.GITHUB_SYNC_OWNER || "findmydoc-platform";
const repo = process.env.GITHUB_SYNC_REPO || "management";

export type GitHubTaskSyncContext = {
  packageTitle?: string;
  packageGoal?: string;
  milestoneTitle?: string;
  milestoneTargetDate?: string;
  sprintName?: string;
  sprintRange?: string;
  sprintReviewDueAt?: string;
  parentTitle?: string;
  parentGitHubUrl?: string;
  comments?: Array<{ author: string; comment: string; createdAt: string }>;
  blockers?: Array<{ author: string; reason: string; impact: string; needsHelpFrom: string; status: string; createdAt: string }>;
};

export function hasGitHubSyncEnv() {
  return Boolean(process.env.GITHUB_SYNC_TOKEN);
}

function taskTypeLabel(task: Task) {
  if (task.taskType === "proposal") return "Vorschlag";
  if (task.taskType === "sub_issue") return "Sub-Issue";
  return "Deliverable";
}

function githubTypeLabel(task: Task) {
  if (task.taskType === "proposal") return "Proposal";
  if (task.taskType === "sub_issue") return "Sub-Issue";
  return "Deliverable";
}

function linkedIssueNumber(task: Task) {
  if (task.githubIssueNumber) return task.githubIssueNumber;
  const legacyNumber = Number(task.issueNumber);
  if (Number.isInteger(legacyNumber) && legacyNumber > 0) return legacyNumber;
  const legacyUrlMatch = task.issueUrl.match(/\/issues\/(\d+)(?:$|[?#])/);
  return legacyUrlMatch ? Number(legacyUrlMatch[1]) : null;
}

function compactSection(title: string, rows: string[]) {
  const content = rows.filter(Boolean);
  if (!content.length) return [`## ${title}`, "_Nicht gesetzt._"];
  return [`## ${title}`, ...content];
}

function lines(value?: string) {
  return (value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith("- ") || line.startsWith("* ") ? line : `- ${line}`));
}

export function taskIssueTitle(task: Task) {
  return `[${taskTypeLabel(task)}] ${task.title}`;
}

export function taskIssueLabels(task: Task) {
  return [
    "task",
    task.taskType === "deliverable" ? "deliverable" : "",
    task.taskType === "sub_issue" ? "sub-issue" : "",
    task.taskType === "proposal" ? "follow-up" : "",
    task.status === "Review" ? "review:ready" : "",
    task.status === "Nacharbeit" ? "changes-requested" : "",
    task.status === "Blockiert" ? "blocked" : "",
    task.priority === "P0" ? "P0-Urgent" : "",
    task.priority === "P1" ? "P1-High" : "",
    task.priority === "P2" ? "P2-Medium" : "",
    task.priority === "P3" || task.priority === "P4" ? "P3-Low" : "",
  ].filter(Boolean);
}

export function taskIssueBody(task: Task, context: GitHubTaskSyncContext = {}) {
  const comments = (context.comments || []).slice(0, 10).map((comment) =>
    `- ${comment.createdAt}: ${comment.author} - ${comment.comment}`,
  );
  const blockers = (context.blockers || []).slice(0, 10).map((blocker) =>
    `- ${blocker.status}: ${blocker.author} - ${blocker.reason}${blocker.impact ? ` | Impact: ${blocker.impact}` : ""}${blocker.needsHelpFrom ? ` | Hilfe: ${blocker.needsHelpFrom}` : ""}`,
  );

  return [
    "## Problem Statement",
    task.problemStatement || task.description || "_Nicht gesetzt._",
    "",
    "## Intended Outcome",
    task.intendedOutcome || "_Nicht gesetzt._",
    "",
    ...compactSection("Scope & Constraints", lines(task.scopeConstraints)),
    "",
    ...compactSection("Acceptance Criteria", lines(task.acceptanceCriteria || task.definitionOfDone)),
    "",
    "## Evidence Required",
    task.evidenceRequired || task.evidenceLink || "_Nicht gesetzt._",
    "",
    ...compactSection("Definition of Done", lines(task.definitionOfDone)),
    "",
    ...compactSection("Struktur", [
      `- Typ: ${githubTypeLabel(task)}`,
      `- Epic / Milestone: ${context.milestoneTitle || task.milestoneId || "ohne Epic"}`,
      context.milestoneTargetDate ? `- Epic-Zieltermin: ${context.milestoneTargetDate}` : "",
      `- Group Commitment: ${context.packageTitle || task.packageId || "ohne Group Commitment"}`,
      context.packageGoal ? `- Group-Commitment-Ziel: ${context.packageGoal}` : "",
      `- Sprint: ${context.sprintName || task.sprintId || "nicht zugewiesen"}`,
      context.sprintRange ? `- Sprint-Zeitraum: ${context.sprintRange}` : "",
      context.sprintReviewDueAt ? `- Review fällig bis: ${context.sprintReviewDueAt}` : "",
      context.parentTitle ? `- Parent Deliverable: ${context.parentTitle}` : "",
      context.parentGitHubUrl ? `- Parent GitHub Issue: ${context.parentGitHubUrl}` : "",
      `- Template: ${task.dodTemplateVersion || "founder-deliverable-v2"}`,
    ]),
    "",
    "## Planning Metadata",
    `- Owner: ${task.owner}`,
    `- Status: ${task.status}`,
    `- Priorität: ${task.priority}`,
    `- Workstream: ${task.workstream || "offen"}`,
    `- Zeitraum: ${task.startDate || "offen"} bis ${task.endDate || "offen"}`,
    `- Review: ${task.reviewStatus}`,
    `- Punkte: ${task.scorePoints}`,
    `- Score-relevant: ${task.scoreRelevant ? "ja" : "nein"}`,
    `- Evidence: ${task.evidenceLink || task.issueUrl || "offen"}`,
    "",
    ...compactSection("Offene Blocker", blockers),
    "",
    ...compactSection("Letzte Kommentare", comments),
    "",
    "## Source of Truth",
    `- Founder Scoreboard v2 Task ID: ${task.id}`,
    `- Sync-Ziel: ${owner}/${repo}`,
    `- Bestehendes GitHub Issue: ${linkedIssueNumber(task) ? `#${linkedIssueNumber(task)}` : "noch nicht verknüpft"}`,
    "",
    "_One-way Sync aus Founder Scoreboard v2. Änderungen in GitHub werden nicht automatisch zurückgeschrieben._",
  ].join("\n");
}

export async function upsertGitHubIssue(task: Task, context: GitHubTaskSyncContext = {}) {
  const token = process.env.GITHUB_SYNC_TOKEN;
  if (!token) throw new Error("GITHUB_SYNC_TOKEN ist nicht gesetzt.");

  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
  const payload = {
    title: taskIssueTitle(task),
    body: taskIssueBody(task, context),
    labels: taskIssueLabels(task),
  };

  const issueNumber = linkedIssueNumber(task);

  if (issueNumber) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`GitHub Update fehlgeschlagen: ${response.status}`);
    return response.json() as Promise<{ number: number; html_url: string }>;
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`GitHub Issue-Erstellung fehlgeschlagen: ${response.status}`);
  return response.json() as Promise<{ number: number; html_url: string }>;
}
