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
  relationships?: Array<{ label: string; title: string; issueUrl?: string; issueNumber?: number | null; status?: string; owner?: string }>;
  comments?: Array<{ author: string; comment: string; createdAt: string }>;
  blockers?: Array<{ author: string; reason: string; impact: string; needsHelpFrom: string; status: string; createdAt: string }>;
  activities?: Array<{ message: string; createdAt: string }>;
};

export function hasGitHubSyncEnv() {
  return true;
}

export function githubRepoSlug() {
  return `${owner}/${repo}`;
}

function githubRawUrl(path: string) {
  const branch = process.env.GITHUB_SYNC_BRANCH || "main";
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split("/").map(encodeURIComponent).join("/")}`;
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

function relationshipLabel(value: string) {
  if (value === "blocked_by") return "Wartet auf";
  if (value === "blocks") return "Blockiert";
  if (value === "relates_to") return "Verknüpft mit";
  return value;
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
  const activities = (context.activities || []).slice(0, 15).map((activity) =>
    `- ${activity.createdAt}: ${activity.message}`,
  );
  const relationships = (context.relationships || []).map((relation) => {
    const issueRef = relation.issueNumber ? `#${relation.issueNumber}` : relation.issueUrl || "";
    return `- ${relationshipLabel(relation.label)}: ${issueRef ? `${issueRef} ` : ""}${relation.title}${relation.status ? ` (${relation.status})` : ""}${relation.owner ? ` - ${relation.owner}` : ""}`;
  });

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
    ...compactSection("Relationships", relationships),
    "",
    ...compactSection("Letzte Kommentare", comments),
    "",
    ...compactSection("Aktivitätsprotokoll", activities),
    "",
    "## Source of Truth",
    `- Founder Scoreboard v2 Task ID: ${task.id}`,
    `- Sync-Ziel: ${owner}/${repo}`,
    `- Bestehendes GitHub Issue: ${linkedIssueNumber(task) ? `#${linkedIssueNumber(task)}` : "noch nicht verknüpft"}`,
    "",
    "_One-way Sync aus Founder Scoreboard v2. Änderungen in GitHub werden nicht automatisch zurückgeschrieben._",
  ].join("\n");
}

function githubHeaders(token: string) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": "2022-11-28",
  };
}

async function githubErrorMessage(response: Response, fallback: string) {
  const scopes = response.headers.get("x-oauth-scopes") || "";
  const acceptedScopes = response.headers.get("x-accepted-oauth-scopes") || "";
  const body = await response.json().catch(() => null) as { message?: string; documentation_url?: string } | null;
  const details = [
    body?.message ? `GitHub: ${body.message}` : "",
    scopes ? `Token-Scopes: ${scopes}` : "",
    acceptedScopes ? `Benötigte Scopes: ${acceptedScopes}` : "",
  ].filter(Boolean).join(" | ");
  return `${fallback}: ${response.status}${details ? ` (${details})` : ""}`;
}

export async function githubUserForToken(token: string) {
  const response = await fetch("https://api.github.com/user", {
    method: "GET",
    headers: githubHeaders(token),
  });
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub User-Token konnte nicht geprüft werden"));
  return response.json() as Promise<{ login: string }>;
}

export async function upsertGitHubIssue(task: Task, context: GitHubTaskSyncContext = {}, token = "") {
  if (!token) throw new Error("GitHub User-Token ist nicht verfügbar. Bitte erneut mit GitHub anmelden.");

  const headers = githubHeaders(token);
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
    if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Update fehlgeschlagen"));
    return response.json() as Promise<{ number: number; html_url: string }>;
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Issue-Erstellung fehlgeschlagen"));
  return response.json() as Promise<{ number: number; html_url: string }>;
}

export async function createGitHubIssueComment(issueNumber: number, comment: string, token: string, marker?: string) {
  if (!token) throw new Error("GitHub User-Token ist nicht verfügbar. Bitte erneut mit GitHub anmelden.");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      body: marker ? `${comment}\n\n<!-- ${marker} -->` : comment,
    }),
  });
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Kommentar konnte nicht erstellt werden"));
  return response.json() as Promise<{ id: number; html_url: string }>;
}

export async function listGitHubIssueComments(issueNumber: number, token: string) {
  if (!token) throw new Error("GitHub User-Token ist nicht verfügbar. Bitte erneut mit GitHub anmelden.");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`, {
    method: "GET",
    headers: githubHeaders(token),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Kommentare konnten nicht geladen werden"));
  return response.json() as Promise<Array<{
    id: number;
    body: string;
    html_url: string;
    created_at: string;
    user?: {
      login?: string;
      avatar_url?: string;
    } | null;
  }>>;
}

export async function getGitHubIssue(issueNumber: number, token: string) {
  if (!token) throw new Error("GitHub User-Token ist nicht verfügbar. Bitte erneut mit GitHub anmelden.");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "GET",
    headers: githubHeaders(token),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Issue konnte nicht geladen werden"));
  return response.json() as Promise<{ number: number; body?: string | null; html_url: string }>;
}

export async function uploadGitHubAttachment(
  path: string,
  content: Buffer,
  token: string,
  message = "Add Founder Scoreboard attachment",
) {
  if (!token) throw new Error("GitHub User-Token ist nicht verfügbar. Bitte erneut mit GitHub anmelden.");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, {
    method: "PUT",
    headers: githubHeaders(token),
    body: JSON.stringify({
      message,
      content: content.toString("base64"),
      branch: process.env.GITHUB_SYNC_BRANCH || "main",
    }),
  });
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub-Anhang konnte nicht gespeichert werden"));

  const result = await response.json() as { content?: { download_url?: string | null; html_url?: string | null } };
  return {
    rawUrl: result.content?.download_url || githubRawUrl(path),
    htmlUrl: result.content?.html_url || "",
  };
}
