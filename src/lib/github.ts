import type { Task } from "./types";

const owner = process.env.GITHUB_SYNC_OWNER || "findmydoc-platform";
const repo = process.env.GITHUB_SYNC_REPO || "management";

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

function isPrivateHostname(hostname: string) {
  const value = hostname.toLowerCase();
  if (value === "localhost" || value === "0.0.0.0" || value === "::1" || value === "[::1]") return true;
  if (value.endsWith(".local") || value.endsWith(".internal") || value.endsWith(".lan") || value.endsWith(".test") || value.endsWith(".example")) return true;
  if (/^127\./.test(value) || /^10\./.test(value) || /^192\.168\./.test(value)) return true;
  const private172 = value.match(/^172\.(\d{1,2})\./);
  return Boolean(private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31);
}

function founderOpsTaskUrl(taskId: string) {
  const configured = process.env.APP_URL?.trim();
  if (!configured) return "";

  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || isPrivateHostname(url.hostname)) return "";
    const basePath = url.pathname.replace(/\/$/, "");
    return `${url.origin}${basePath}/tasks/${encodeURIComponent(taskId)}`;
  } catch {
    return "";
  }
}

function sourceLine(task: Task) {
  const taskUrl = founderOpsTaskUrl(task.id);
  const source = taskUrl ? `[Open in FounderOps](${taskUrl})` : "FounderOps";
  return `Source: ${source}. One-way sync; edit task state in FounderOps.`;
}

export function taskIssueBody(task: Task) {
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
    "---",
    sourceLine(task),
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
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub-Verbindung konnte nicht geprüft werden"));
  return response.json() as Promise<{ login: string }>;
}

export async function upsertGitHubIssue(task: Task, token = "") {
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

  const headers = githubHeaders(token);
  const payload = {
    title: taskIssueTitle(task),
    body: taskIssueBody(task),
    labels: taskIssueLabels(task),
    state: task.status === "Erledigt" ? "closed" : "open",
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

export async function archiveGitHubIssue(issueNumber: number, token: string) {
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: githubHeaders(token),
    body: JSON.stringify({
      state: "closed",
      state_reason: "not_planned",
      labels: ["task", "test/deleted"],
    }),
  });
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Issue konnte nicht geschlossen werden"));
  return response.json() as Promise<{ number: number; html_url: string }>;
}

export async function createGitHubIssueComment(issueNumber: number, comment: string, token: string, marker?: string) {
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

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
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

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
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

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
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

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
