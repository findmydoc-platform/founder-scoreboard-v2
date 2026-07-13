import type { Task } from "./types";
import { requireAllowedGitHubRepository, splitGitHubRepository } from "./github-repositories";
import {
  assertGitHubIssueRepository,
  parseGitHubIssueUrl,
  resolveGitHubIssueNumber,
} from "./github-issue-reference";
import { githubJson, githubRequest } from "./github-http";

const issueDependencyGitHubApiVersion = "2026-03-10";

export { GitHubApiError } from "./github-http";

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

type GitHubIssueLabel = string | { name?: string | null };

const founderOpsManagedIssueLabels = new Set([
  "task",
  "deliverable",
  "sub-issue",
  "review:ready",
  "changes-requested",
  "blocked",
  "p0-urgent",
  "p1-high",
  "p2-medium",
  "p3-low",
]);

type GitHubIssueSearchResult = {
  number: number;
  html_url: string;
  body?: string | null;
  pull_request?: unknown;
};

type GitHubIssueUpdateTarget = GitHubIssueSearchResult & {
  title: string;
  labels?: GitHubIssueLabel[];
};

export function hasGitHubSyncEnv() {
  return true;
}

export function githubRepoSlug(repository?: string | null) {
  return requireAllowedGitHubRepository(repository);
}

function githubRawUrl(path: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);
  const branch = process.env.GITHUB_SYNC_BRANCH || "main";
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function taskTypeLabel(task: Task) {
  if (task.taskType === "sub_issue") return "Sub-Issue";
  return "Deliverable";
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
    task.status === "Review" ? "review:ready" : "",
    task.status === "Nacharbeit" ? "changes-requested" : "",
    task.status === "Blockiert" ? "blocked" : "",
    task.priority === "P0" ? "P0-Urgent" : "",
    task.priority === "P1" ? "P1-High" : "",
    task.priority === "P2" ? "P2-Medium" : "",
    task.priority === "P3" ? "P3-Low" : "",
  ].filter(Boolean);
}

export function mergeGitHubIssueLabels(existingLabels: GitHubIssueLabel[], desiredLabels: string[]) {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const existingLabel of existingLabels) {
    const label = typeof existingLabel === "string" ? existingLabel : existingLabel.name || "";
    const normalized = label.toLowerCase();
    if (!label || founderOpsManagedIssueLabels.has(normalized) || seen.has(normalized)) continue;
    merged.push(label);
    seen.add(normalized);
  }

  for (const label of desiredLabels) {
    const normalized = label.toLowerCase();
    if (seen.has(normalized)) continue;
    merged.push(label);
    seen.add(normalized);
  }

  return merged;
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
    ...compactSection("Acceptance Criteria", lines(task.acceptanceCriteria)),
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

export async function githubUserForToken(token: string) {
  return githubJson<{ login: string }>("https://api.github.com/user", {
    token,
    errorMessage: "GitHub-Verbindung konnte nicht geprüft werden",
  });
}

async function assignableGitHubLogin(login: string, token: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);
  let response: Response;
  try {
    response = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/assignees/${encodeURIComponent(login)}`, {
      token,
      cache: "no-store",
      errorMessage: "GitHub-Assignee konnte nicht geprüft werden",
      allowFailure: true,
    });
  } catch {
    return null;
  }
  if (response.status === 204) return true;
  if (response.status === 404) return false;
  return null;
}

function matchingTaskIssue(items: GitHubIssueSearchResult[], marker: string) {
  return items.find((issue) => !issue.pull_request && issue.body?.includes(marker)) || null;
}

async function findGitHubIssueByTaskMarker(taskId: string, token: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);
  const marker = taskIssueMarker(taskId);
  const markerToken = marker.slice(5, -4).trim();
  const query = encodeURIComponent(`repo:${owner}/${repo} is:issue in:body "${markerToken}"`);
  const searchResponse = await githubRequest(`https://api.github.com/search/issues?q=${query}&per_page=10`, {
    token,
    cache: "no-store",
    errorMessage: "GitHub Issue-Suche fehlgeschlagen",
    allowFailure: true,
  });
  if (searchResponse.ok) {
    const search = await searchResponse.json() as { items?: GitHubIssueSearchResult[] };
    const match = matchingTaskIssue(search.items || [], marker);
    if (match) return match;
  }

  for (let page = 1; page <= 5; page += 1) {
    const response = await githubRequest(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`,
      {
        token,
        cache: "no-store",
        errorMessage: "GitHub Issue-Suche fehlgeschlagen",
        allowFailure: true,
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

export function assertGitHubIssueUpdateTarget(
  task: Task,
  issue: GitHubIssueUpdateTarget,
  repository: string,
  expectedIssueNumber: number,
) {
  if (issue.pull_request) {
    throw new Error("Die lokale GitHub-Verknüpfung zeigt auf einen Pull Request statt auf ein Issue.");
  }
  const issueReference = parseGitHubIssueUrl(issue.html_url);
  if (
    issue.number !== expectedIssueNumber
    || !issueReference
    || issueReference.number !== expectedIssueNumber
    || issueReference.repository.toLowerCase() !== repository.toLowerCase()
  ) {
    throw new Error("Das geladene GitHub Issue stimmt nicht mit der lokalen Verknüpfung überein.");
  }
  const expectedMarker = taskIssueMarker(task.id);
  if (issue.body?.includes(expectedMarker)) return;
  const containsFounderOpsMarker = /<!--\s*founderops-task-id:[^>]+-->/i.test(issue.body || "");
  const isBeforeFirstSync = !task.githubIssueLastSyncedAt;
  if (isBeforeFirstSync && !containsFounderOpsMarker && issue.title === taskIssueTitle(task)) return;
  throw new Error("Das verknüpfte GitHub Issue gehört nicht zu dieser FounderOps-Aufgabe.");
}

async function updateValidatedGitHubIssue(
  task: Task,
  issueNumber: number,
  payload: GitHubIssuePayload,
  token: string,
  owner: string,
  repo: string,
  repository: string,
  errorMessage: string,
) {
  const issueUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
  const target = await githubJson<GitHubIssueUpdateTarget>(issueUrl, {
    token,
    cache: "no-store",
    errorMessage: "Verknüpftes GitHub Issue konnte nicht geprüft werden",
  });
  assertGitHubIssueUpdateTarget(task, target, repository, issueNumber);
  if (!Array.isArray(target.labels)) {
    throw new Error("Bestehende GitHub-Labels konnten nicht sicher gelesen werden.");
  }

  return githubJson<{ number: number; html_url: string }>(issueUrl, {
    token,
    method: "PATCH",
    body: {
      ...payload,
      labels: mergeGitHubIssueLabels(target.labels, payload.labels),
    },
    errorMessage,
  });
}

export async function upsertGitHubIssue(task: Task, token = "", assignee: GitHubIssueAssigneeInput = {}) {
  const { owner, repo, repository } = splitGitHubRepository(task.githubRepo);
  assertGitHubIssueRepository(task, repository);

  const payload: GitHubIssuePayload = {
    title: taskIssueTitle(task),
    body: taskIssueBody(task),
    labels: taskIssueLabels(task),
    state: task.status === "Erledigt" ? "closed" : "open",
  };
  const warnings: string[] = [];
  const assigneeLogin = assignee.login?.trim();
  if (assigneeLogin) {
    const isAssignable = await assignableGitHubLogin(assigneeLogin, token, repository);
    if (isAssignable) {
      payload.assignees = [assigneeLogin];
    } else if (isAssignable === false) {
      payload.assignees = [];
      warnings.push(`GitHub-Assignee @${assigneeLogin} ist im Repository nicht zuweisbar.`);
    } else {
      warnings.push(`GitHub-Assignee @${assigneeLogin} konnte nicht geprüft werden.`);
    }
  } else {
    payload.assignees = [];
    warnings.push("GitHub-Assignee nicht gesetzt: Das verantwortliche Profil hat keinen GitHub-Login.");
  }

  const issueNumber = resolveGitHubIssueNumber(task, { repository, requireConsistent: true });

  if (issueNumber) {
    const issue = await updateValidatedGitHubIssue(
      task,
      issueNumber,
      payload,
      token,
      owner,
      repo,
      repository,
      "GitHub Update fehlgeschlagen",
    );
    return { ...issue, warnings, recovered: false };
  }

  const recoveredIssue = await findGitHubIssueByTaskMarker(task.id, token, repository);
  if (recoveredIssue) {
    const issue = await updateValidatedGitHubIssue(
      task,
      recoveredIssue.number,
      payload,
      token,
      owner,
      repo,
      repository,
      "Wiedergefundenes GitHub Issue konnte nicht aktualisiert werden",
    );
    return { ...issue, warnings, recovered: true };
  }

  const issue = await githubJson<{ number: number; html_url: string }>(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    token,
    method: "POST",
    body: payload,
    errorMessage: "GitHub Issue-Erstellung fehlgeschlagen",
  });
  return { ...issue, warnings, recovered: false };
}

export async function connectGitHubSubIssue({
  parentRepository,
  parentIssueNumber,
  childRepository,
  childIssueNumber,
  token,
}: {
  parentRepository: string;
  parentIssueNumber: number;
  childRepository: string;
  childIssueNumber: number;
  token: string;
}) {
  const parent = splitGitHubRepository(parentRepository);
  const child = splitGitHubRepository(childRepository);
  const query = `query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) { issue(number: $number) { id } }
  }`;
  const parentResult = await githubJson<{ data?: { repository?: { issue?: { id?: string } | null } | null }; errors?: Array<{ message?: string }> }>("https://api.github.com/graphql", {
    token,
    method: "POST",
    body: { query, variables: { owner: parent.owner, repo: parent.repo, number: parentIssueNumber } },
    errorMessage: "GitHub Parent-Issue konnte nicht geladen werden",
  });
  const parentId = parentResult.data?.repository?.issue?.id;
  if (!parentId) throw new Error(parentResult.errors?.[0]?.message || "GitHub Parent-Issue wurde nicht gefunden.");

  const mutation = `mutation($parent: ID!, $childUrl: String!) {
    addSubIssue(input: { issueId: $parent, subIssueUrl: $childUrl, replaceParent: true }) {
      issue { number url }
      subIssue { number url repository { nameWithOwner } parent { number url repository { nameWithOwner } } }
    }
  }`;
  const childUrl = `https://github.com/${child.repository}/issues/${childIssueNumber}`;
  const result = await githubJson<{ data?: unknown; errors?: Array<{ message?: string }> }>("https://api.github.com/graphql", {
    token,
    method: "POST",
    body: { query: mutation, variables: { parent: parentId, childUrl } },
    errorMessage: "GitHub Sub-Issue-Beziehung konnte nicht erstellt werden",
  });
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).filter(Boolean).join(" | "));
  return result.data;
}

export async function listGitHubIssueBlockedBy(issueNumber: number, token: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);

  return githubJson<GitHubIssueDependency[]>(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by?per_page=100`, {
    token,
    apiVersion: issueDependencyGitHubApiVersion,
    cache: "no-store",
    errorMessage: "GitHub Dependencies konnten nicht geladen werden",
  });
}

export async function addGitHubIssueBlockedBy(issueNumber: number, blockingIssueId: number, token: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);

  return githubJson<GitHubIssueDependency>(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by`, {
    token,
    method: "POST",
    apiVersion: issueDependencyGitHubApiVersion,
    body: { issue_id: blockingIssueId },
    errorMessage: "GitHub Dependency konnte nicht erstellt werden",
  });
}

export async function removeGitHubIssueBlockedBy(issueNumber: number, blockingIssueId: number, token: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);

  const response = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/dependencies/blocked_by/${blockingIssueId}`, {
    token,
    method: "DELETE",
    apiVersion: issueDependencyGitHubApiVersion,
    errorMessage: "GitHub Dependency konnte nicht entfernt werden",
    allowedStatuses: [404],
  });
  if (response.status === 404) return;
}

export async function syncGitHubIssueDependencies({
  currentIssueNumber,
  desiredDependencies,
  managedIssueNumbers,
  repository,
}: {
  currentIssueNumber: number;
  desiredDependencies: GitHubIssueDependencyInput[];
  managedIssueNumbers: number[];
  repository?: string;
}, token: string) {
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
    const issue = await getGitHubIssue(issueNumber, token, repository);
    issueCache.set(issueNumber, issue);
    return issue;
  };

  const blockedIssueNumbers = new Set([currentIssueNumber, ...desiredDependencies.map((dependency) => dependency.blockedIssueNumber)]);
  for (const blockedIssueNumber of blockedIssueNumbers) {
    const existing = await listGitHubIssueBlockedBy(blockedIssueNumber, token, repository);
    const existingManaged = new Map(
      existing
        .filter((dependency) => managedNumbers.has(dependency.number))
        .map((dependency) => [dependency.number, dependency]),
    );
    const desiredBlockingNumbers = desiredByBlocked.get(blockedIssueNumber) || new Set<number>();

    for (const blockingIssueNumber of desiredBlockingNumbers) {
      if (existingManaged.has(blockingIssueNumber)) continue;
      const blockingIssue = await issueReference(blockingIssueNumber);
      await addGitHubIssueBlockedBy(blockedIssueNumber, blockingIssue.id, token, repository);
    }

    if (blockedIssueNumber !== currentIssueNumber) continue;
    for (const existingDependency of existingManaged.values()) {
      if (desiredBlockingNumbers.has(existingDependency.number)) continue;
      await removeGitHubIssueBlockedBy(blockedIssueNumber, existingDependency.id, token, repository);
    }
  }
}

export async function archiveGitHubIssue(issueNumber: number, token: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);

  return githubJson<{ number: number; html_url: string }>(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    token,
    method: "PATCH",
    body: {
      state: "closed",
      state_reason: "not_planned",
      labels: ["task", "test/deleted"],
    },
    errorMessage: "GitHub Issue konnte nicht geschlossen werden",
  });
}

export async function createGitHubIssueComment(issueNumber: number, comment: string, token: string, marker?: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);

  return githubJson<{ id: number; html_url: string }>(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    token,
    method: "POST",
    body: {
      body: marker ? `${comment}\n\n<!-- ${marker} -->` : comment,
    },
    errorMessage: "GitHub Kommentar konnte nicht erstellt werden",
    errorType: "api",
  });
}

export async function listGitHubIssueComments(issueNumber: number, token: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);

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
    const pageComments = await githubJson<typeof comments>(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`, {
      token,
      cache: "no-store",
      errorMessage: "GitHub Kommentare konnten nicht geladen werden",
      errorType: "api",
    });
    comments.push(...pageComments);
    if (pageComments.length < 100) break;
  }

  return comments;
}

export async function getGitHubIssue(issueNumber: number, token: string, repository?: string | null) {
  const { owner, repo } = splitGitHubRepository(repository);

  return githubJson<{ id: number; number: number; body?: string | null; html_url: string }>(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    token,
    cache: "no-store",
    errorMessage: "GitHub Issue konnte nicht geladen werden",
  });
}

export async function uploadGitHubAttachment(
  path: string,
  content: Buffer,
  token: string,
  message = "Add Founder Scoreboard attachment",
  repository?: string | null,
) {
  const { owner, repo } = splitGitHubRepository(repository);

  const result = await githubJson<{ content?: { download_url?: string | null; html_url?: string | null } }>(`https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`, {
    token,
    method: "PUT",
    body: {
      message,
      content: content.toString("base64"),
      branch: process.env.GITHUB_SYNC_BRANCH || "main",
    },
    errorMessage: "GitHub-Anhang konnte nicht gespeichert werden",
  });
  return {
    rawUrl: result.content?.download_url || githubRawUrl(path, repository),
    htmlUrl: result.content?.html_url || "",
  };
}
