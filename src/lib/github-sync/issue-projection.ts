import type { Task } from "../types";
import { GitHubApiError, githubJson, githubRequest } from "../github-http";
import {
  assertGitHubIssueRepository,
  parseGitHubIssueUrl,
  resolveGitHubIssueNumber,
} from "../github-issue-reference";
import { splitGitHubRepository } from "../github-repositories";

type GitHubIssuePayload = {
  title: string;
  body: string;
  labels: string[];
  state: string;
  assignees?: string[];
};

type GitHubIssueLabel = string | { name?: string | null };

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

export type GitHubIssueProjectionResult = {
  repository: string;
  number: number;
  url: string;
  warnings: string[];
  recovered: boolean;
  recreated: boolean;
};

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

function taskTypeLabel(task: Task) {
  return task.taskType === "sub_issue" ? "Sub-Issue" : "Deliverable";
}

function taskIssueTitle(task: Task) {
  return `[${taskTypeLabel(task)}] ${task.title}`;
}

function taskIssueLabels(task: Task) {
  if (task.taskType === "sub_issue") {
    return [
      "task",
      "sub-issue",
      task.status === "Blockiert" ? "blocked" : "",
    ].filter(Boolean);
  }
  return [
    "task",
    "deliverable",
    task.status === "Review" ? "review:ready" : "",
    task.status === "Nacharbeit" ? "changes-requested" : "",
    task.status === "Blockiert" ? "blocked" : "",
    task.priority === "P0" ? "P0-Urgent" : "",
    task.priority === "P1" ? "P1-High" : "",
    task.priority === "P2" ? "P2-Medium" : "",
    task.priority === "P3" ? "P3-Low" : "",
  ].filter(Boolean);
}

function mergeGitHubIssueLabels(existingLabels: GitHubIssueLabel[], desiredLabels: string[]) {
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

function subIssueSourceLine(task: Task) {
  const taskUrl = founderOpsTaskUrl(task.id);
  return taskUrl ? `Source: [FounderOps](${taskUrl}).` : "Source: FounderOps.";
}

function taskIssueMarker(taskId: string) {
  return `<!-- founderops-task-id:${taskId} -->`;
}

function hasMatchingLegacyFounderOpsTaskLink(task: Task, body?: string | null) {
  const taskUrl = founderOpsTaskUrl(task.id);
  return Boolean(taskUrl && body?.includes(`](${taskUrl})`));
}

function hasMatchingLegacyFounderOpsTaskId(task: Task, body?: string | null) {
  const prefix = "- Founder Scoreboard v2 Task ID: ";
  const taskIds = new Set((body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim()));
  return taskIds.size === 1 && taskIds.has(task.id);
}

function subIssueBriefSections(task: Task) {
  const sections: string[] = [];
  const textSection = (title: string, value?: string) => {
    const content = value?.trim();
    if (content) sections.push(`## ${title}\n${content}`);
  };
  const listSection = (title: string, value?: string) => {
    const content = lines(value);
    if (content.length) sections.push([`## ${title}`, ...content].join("\n"));
  };

  textSection("Context", task.description);
  textSection("Problem Statement", task.problemStatement);
  textSection("Intended Outcome", task.intendedOutcome);
  listSection("Scope & Constraints", task.scopeConstraints);
  listSection("Acceptance Criteria", task.acceptanceCriteria);
  textSection("Evidence Required", task.evidenceRequired);
  listSection("Definition of Done", task.definitionOfDone);
  return sections;
}

function taskIssueBody(task: Task) {
  if (task.taskType === "sub_issue") {
    const sections = subIssueBriefSections(task);
    return [
      ...(sections.length ? [sections.join("\n\n"), ""] : []),
      "---",
      subIssueSourceLine(task),
      taskIssueMarker(task.id),
    ].join("\n");
  }
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

function taskIssueUpdateBody(task: Task, existingBody?: string | null) {
  const desiredBody = taskIssueBody(task);
  if (task.taskType !== "sub_issue" || !existingBody?.trim()) return desiredBody;

  const marker = taskIssueMarker(task.id);
  if (!subIssueBriefSections(task).length) {
    if (existingBody.includes(marker)) return desiredBody;
    return `${existingBody.trimEnd()}\n\n${marker}`;
  }
  return desiredBody;
}

async function assignableGitHubLogin(login: string, token: string, repository: string) {
  const { owner, repo } = splitGitHubRepository(repository);
  let response: Response;
  try {
    response = await githubRequest(`https://api.github.com/repos/${owner}/${repo}/assignees/${encodeURIComponent(login)}`, {
      token,
      cache: "no-store",
      errorMessage: "GitHub-Assignee konnte nicht geprüft werden",
      acceptErrorResponse: true,
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

async function findGitHubIssueByTaskMarker(taskId: string, token: string, repository: string) {
  const { owner, repo } = splitGitHubRepository(repository);
  const marker = taskIssueMarker(taskId);
  const markerToken = marker.slice(5, -4).trim();
  const query = encodeURIComponent(`repo:${owner}/${repo} is:issue in:body "${markerToken}"`);
  const searchResponse = await githubRequest(`https://api.github.com/search/issues?q=${query}&per_page=10`, {
    token,
    cache: "no-store",
    errorMessage: "GitHub Issue-Suche fehlgeschlagen",
    acceptErrorResponse: true,
  });
  let searchFailed = !searchResponse.ok;
  if (searchResponse.ok) {
    const search = await searchResponse.json() as { incomplete_results?: boolean; items?: GitHubIssueSearchResult[] };
    const match = matchingTaskIssue(search.items || [], marker);
    if (match) return match;
    searchFailed = search.incomplete_results === true;
  }

  let repositoryLookupFailed = false;
  for (let page = 1; page <= 5; page += 1) {
    const response = await githubRequest(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`,
      {
        token,
        cache: "no-store",
        errorMessage: "GitHub Issue-Suche fehlgeschlagen",
        acceptErrorResponse: true,
      },
    );
    if (!response.ok) {
      repositoryLookupFailed = true;
      break;
    }
    const issues = await response.json() as GitHubIssueSearchResult[];
    const match = matchingTaskIssue(issues, marker);
    if (match) return match;
    if (issues.length < 100) break;
  }

  if (searchFailed || repositoryLookupFailed) {
    throw new Error("GitHub Issue-Suche fehlgeschlagen: Die Abwesenheit eines FounderOps-Issues konnte nicht bestätigt werden.");
  }
  return null;
}

function assertGitHubIssueUpdateTarget(
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
  const hasMatchingLegacyOwnership = hasMatchingLegacyFounderOpsTaskLink(task, issue.body)
    || hasMatchingLegacyFounderOpsTaskId(task, issue.body);
  if (!containsFounderOpsMarker && hasMatchingLegacyOwnership) return;
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
    operation: "mutation",
    body: {
      ...payload,
      body: taskIssueUpdateBody(task, target.body),
      labels: mergeGitHubIssueLabels(target.labels, payload.labels),
    },
    errorMessage,
  });
}

async function createGitHubIssue(payload: GitHubIssuePayload, token: string, owner: string, repo: string) {
  return githubJson<{ number: number; html_url: string }>(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    token,
    method: "POST",
    operation: "mutation",
    body: payload,
    errorMessage: "GitHub Issue-Erstellung fehlgeschlagen",
  });
}

export async function projectTaskGitHubIssue({
  task,
  token,
  assigneeLogin = "",
}: {
  task: Task;
  token: string;
  assigneeLogin?: string;
}): Promise<GitHubIssueProjectionResult> {
  const { owner, repo, repository } = splitGitHubRepository(task.githubRepo);
  assertGitHubIssueRepository(task, repository);

  const payload: GitHubIssuePayload = {
    title: taskIssueTitle(task),
    body: taskIssueBody(task),
    labels: taskIssueLabels(task),
    state: task.status === "Erledigt" ? "closed" : "open",
  };
  const warnings: string[] = [];
  const normalizedAssigneeLogin = assigneeLogin.trim();
  if (normalizedAssigneeLogin) {
    const isAssignable = await assignableGitHubLogin(normalizedAssigneeLogin, token, repository);
    if (isAssignable) {
      payload.assignees = [normalizedAssigneeLogin];
    } else if (isAssignable === false) {
      payload.assignees = [];
      warnings.push(`GitHub-Assignee @${normalizedAssigneeLogin} ist im Repository nicht zuweisbar.`);
    } else {
      warnings.push(`GitHub-Assignee @${normalizedAssigneeLogin} konnte nicht geprüft werden.`);
    }
  } else {
    payload.assignees = [];
    warnings.push("GitHub-Assignee nicht gesetzt: Das verantwortliche Profil hat keinen GitHub-Login.");
  }

  const issueNumber = resolveGitHubIssueNumber(task, { repository, requireConsistent: true });
  if (issueNumber) {
    try {
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
      return { repository, number: issue.number, url: issue.html_url, warnings, recovered: false, recreated: false };
    } catch (updateError) {
      if (!(updateError instanceof GitHubApiError) || updateError.status !== 404) throw updateError;

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
        return { repository, number: issue.number, url: issue.html_url, warnings, recovered: true, recreated: false };
      }

      const issue = await createGitHubIssue(payload, token, owner, repo);
      return { repository, number: issue.number, url: issue.html_url, warnings, recovered: false, recreated: true };
    }
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
    return { repository, number: issue.number, url: issue.html_url, warnings, recovered: true, recreated: false };
  }

  const issue = await createGitHubIssue(payload, token, owner, repo);
  return { repository, number: issue.number, url: issue.html_url, warnings, recovered: false, recreated: false };
}
