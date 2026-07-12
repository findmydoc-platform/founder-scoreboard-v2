import type { Task } from "./types";

const owner = process.env.GITHUB_SYNC_OWNER || "findmydoc-platform";
const repo = process.env.GITHUB_SYNC_REPO || "management";
const defaultGitHubApiVersion = "2022-11-28";
const issueDependencyGitHubApiVersion = "2026-03-10";

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

export type GitHubIssueDependencyInput = {
  blockedIssueNumber: number;
  blockingIssueNumber: number;
};

type GitHubIssueReference = {
  id: number;
  number: number;
  html_url: string;
};

type GitHubIssueDependency = GitHubIssueReference & {
  repository_url?: string;
};

export type GitHubIssueAssigneeInput = {
  login?: string;
};

type GitHubIssuePayload = {
  title: string;
  body: string;
  labels: string[];
  state: string;
  assignees?: string[];
};

type GitHubIssueSearchResult = {
  number: number;
  html_url: string;
  body?: string | null;
  pull_request?: unknown;
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
  return `Planning context: ${source}. GitHub issue sync keeps the working issue aligned.`;
}

export function taskIssueMarker(taskId: string) {
  return `<!-- founderops-task-id:${taskId} -->`;
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
    taskIssueMarker(task.id),
  ].join("\n");
}

function githubHeaders(token: string, apiVersion = defaultGitHubApiVersion) {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-github-api-version": apiVersion,
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

async function assignableGitHubLogin(login: string, token: string) {
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/assignees/${encodeURIComponent(login)}`, {
    method: "GET",
    headers: githubHeaders(token),
    cache: "no-store",
  });
  if (response.status === 204) return true;
  if (response.status === 404) return false;
  return null;
}

function matchingTaskIssue(items: GitHubIssueSearchResult[], marker: string) {
  return items.find((issue) => !issue.pull_request && issue.body?.includes(marker)) || null;
}

async function findGitHubIssueByTaskMarker(taskId: string, token: string) {
  const marker = taskIssueMarker(taskId);
  const markerToken = marker.slice(5, -4).trim();
  const query = encodeURIComponent(`repo:${owner}/${repo} is:issue in:body "${markerToken}"`);
  const searchResponse = await fetch(`https://api.github.com/search/issues?q=${query}&per_page=10`, {
    method: "GET",
    headers: githubHeaders(token),
    cache: "no-store",
  });
  if (searchResponse.ok) {
    const search = await searchResponse.json() as { items?: GitHubIssueSearchResult[] };
    const match = matchingTaskIssue(search.items || [], marker);
    if (match) return match;
  }

  for (let page = 1; page <= 5; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`,
      {
        method: "GET",
        headers: githubHeaders(token),
        cache: "no-store",
      },
    );
    if (!response.ok) break;
    const issues = await response.json() as GitHubIssueSearchResult[];
    const match = matchingTaskIssue(issues, marker);
    if (match) return match;
    if (issues.length < 100) break;
  }

  return null;
}

export async function upsertGitHubIssue(task: Task, token = "", assignee: GitHubIssueAssigneeInput = {}) {
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

  const headers = githubHeaders(token);
  const payload: GitHubIssuePayload = {
    title: taskIssueTitle(task),
    body: taskIssueBody(task),
    labels: taskIssueLabels(task),
    state: task.status === "Erledigt" ? "closed" : "open",
  };
  const warnings: string[] = [];
  const assigneeLogin = assignee.login?.trim();
  if (assigneeLogin) {
    const isAssignable = await assignableGitHubLogin(assigneeLogin, token);
    if (isAssignable) {
      payload.assignees = [assigneeLogin];
    } else if (isAssignable === false) {
      warnings.push(`GitHub-Assignee @${assigneeLogin} ist im Repository nicht zuweisbar.`);
    } else {
      warnings.push(`GitHub-Assignee @${assigneeLogin} konnte nicht geprüft werden.`);
    }
  } else {
    warnings.push("GitHub-Assignee nicht gesetzt: Das verantwortliche Profil hat keinen GitHub-Login.");
  }

  const issueNumber = linkedIssueNumber(task);

  if (issueNumber) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Update fehlgeschlagen"));
    const issue = await response.json() as { number: number; html_url: string };
    return { ...issue, warnings, recovered: false };
  }

  const recoveredIssue = await findGitHubIssueByTaskMarker(task.id, token);
  if (recoveredIssue) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${recoveredIssue.number}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(await githubErrorMessage(response, "Wiedergefundenes GitHub Issue konnte nicht aktualisiert werden"));
    const issue = await response.json() as { number: number; html_url: string };
    return { ...issue, warnings, recovered: true };
  }

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Issue-Erstellung fehlgeschlagen"));
  const issue = await response.json() as { number: number; html_url: string };
  return { ...issue, warnings, recovered: false };
}

export async function listGitHubIssueBlockedBy(issueNumber: number, token: string) {
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by?per_page=100`, {
    method: "GET",
    headers: githubHeaders(token, issueDependencyGitHubApiVersion),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Dependencies konnten nicht geladen werden"));
  return response.json() as Promise<GitHubIssueDependency[]>;
}

export async function addGitHubIssueBlockedBy(issueNumber: number, blockingIssueId: number, token: string) {
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by`, {
    method: "POST",
    headers: githubHeaders(token, issueDependencyGitHubApiVersion),
    body: JSON.stringify({ issue_id: blockingIssueId }),
  });
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Dependency konnte nicht erstellt werden"));
  return response.json() as Promise<GitHubIssueDependency>;
}

export async function removeGitHubIssueBlockedBy(issueNumber: number, blockingIssueId: number, token: string) {
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by/${blockingIssueId}`, {
    method: "DELETE",
    headers: githubHeaders(token, issueDependencyGitHubApiVersion),
  });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Dependency konnte nicht entfernt werden"));
}

export async function syncGitHubIssueDependencies({
  currentIssueNumber,
  desiredDependencies,
  managedIssueNumbers,
}: {
  currentIssueNumber: number;
  desiredDependencies: GitHubIssueDependencyInput[];
  managedIssueNumbers: number[];
}, token: string) {
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

  const managedNumbers = new Set(managedIssueNumbers);
  const desiredByBlocked = new Map<number, Set<number>>();
  for (const dependency of desiredDependencies) {
    if (dependency.blockedIssueNumber === dependency.blockingIssueNumber) continue;
    const current = desiredByBlocked.get(dependency.blockedIssueNumber) || new Set<number>();
    current.add(dependency.blockingIssueNumber);
    desiredByBlocked.set(dependency.blockedIssueNumber, current);
  }

  const issueCache = new Map<number, GitHubIssueReference>();
  const issueReference = async (issueNumber: number) => {
    const cached = issueCache.get(issueNumber);
    if (cached) return cached;
    const issue = await getGitHubIssue(issueNumber, token);
    issueCache.set(issueNumber, issue);
    return issue;
  };

  const blockedIssueNumbers = new Set([currentIssueNumber, ...desiredDependencies.map((dependency) => dependency.blockedIssueNumber)]);
  for (const blockedIssueNumber of blockedIssueNumbers) {
    const existing = await listGitHubIssueBlockedBy(blockedIssueNumber, token);
    const existingManaged = new Map(
      existing
        .filter((dependency) => managedNumbers.has(dependency.number))
        .map((dependency) => [dependency.number, dependency]),
    );
    const desiredBlockingNumbers = desiredByBlocked.get(blockedIssueNumber) || new Set<number>();

    for (const blockingIssueNumber of desiredBlockingNumbers) {
      if (existingManaged.has(blockingIssueNumber)) continue;
      const blockingIssue = await issueReference(blockingIssueNumber);
      await addGitHubIssueBlockedBy(blockedIssueNumber, blockingIssue.id, token);
    }

    if (blockedIssueNumber !== currentIssueNumber) continue;
    for (const existingDependency of existingManaged.values()) {
      if (desiredBlockingNumbers.has(existingDependency.number)) continue;
      await removeGitHubIssueBlockedBy(blockedIssueNumber, existingDependency.id, token);
    }
  }
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
  if (!response.ok) throw new GitHubApiError(await githubErrorMessage(response, "GitHub Kommentar konnte nicht erstellt werden"), response.status);
  return response.json() as Promise<{ id: number; html_url: string }>;
}

export async function listGitHubIssueComments(issueNumber: number, token: string) {
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

  const comments: Array<{
    id: number;
    body: string;
    html_url: string;
    created_at: string;
    user?: {
      login?: string;
      avatar_url?: string;
    } | null;
  }> = [];

  for (let page = 1; page <= 100; page += 1) {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`, {
      method: "GET",
      headers: githubHeaders(token),
      cache: "no-store",
    });
    if (!response.ok) throw new GitHubApiError(await githubErrorMessage(response, "GitHub Kommentare konnten nicht geladen werden"), response.status);
    const pageComments = await response.json() as typeof comments;
    comments.push(...pageComments);
    if (pageComments.length < 100) break;
  }

  return comments;
}

export async function getGitHubIssue(issueNumber: number, token: string) {
  if (!token) throw new Error("GitHub-Verbindung ist nicht verfügbar. Bitte melde dich erneut mit GitHub an.");

  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "GET",
    headers: githubHeaders(token),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(await githubErrorMessage(response, "GitHub Issue konnte nicht geladen werden"));
  return response.json() as Promise<{ id: number; number: number; body?: string | null; html_url: string }>;
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
