import type { Task } from "./types";
import { canonicalizeProfileMentionsForGitHub, type MentionProfile, type MentionTeam } from "./mentions";

export type IssueContentTask = Pick<Task, "id" | "title" | "taskType"> & Partial<Pick<Task,
  "description" | "problemStatement" | "intendedOutcome" | "scopeConstraints" | "acceptanceCriteria" |
  "evidenceRequired" | "definitionOfDone" | "evidenceLink">>;
export type IssueContentContext = { appUrl?: string; mentionProfiles?: MentionProfile[]; mentionTeam?: MentionTeam };
export const GITHUB_ISSUE_BODY_LIMIT = 65_536;
export const GITHUB_ISSUE_TITLE_LIMIT = 256;

export function codepointLength(value: string) {
  return Array.from(value).length;
}
export type ContentLengthError = {
  field: string;
  actual: number;
  maximum: number;
  excess: number;
  message: string;
};

export function contentLengthError(field: string, value: string, maximum: number, label = field): ContentLengthError | null {
  const actual = codepointLength(value);
  if (actual <= maximum) return null;
  const excess = actual - maximum;
  const format = (number: number) => number.toLocaleString("de-DE");
  return {
    field, actual, maximum, excess,
    message: `${label} enthält ${format(actual)} von maximal ${format(maximum)} Zeichen. Bitte mindestens ${format(excess)} Zeichen kürzen.`,
  };
}

export function taskIssueTitle(task: IssueContentTask) {
  return `[${task.taskType === "sub_issue" ? "Sub-Issue" : "Deliverable"}] ${task.title}`;
}

export function renderGitHubIssueContent(task: IssueContentTask, context: IssueContentContext = {}) {
  return {
    title: taskIssueTitle(task),
    body: canonicalizeProfileMentionsForGitHub(
      taskIssueBody(task, context.appUrl), context.mentionProfiles || [], context.mentionTeam,
    ),
  };
}

export function validateGitHubIssueContent(content: { title: string; body: string }) {
  return [
    contentLengthError("githubTitle", content.title, GITHUB_ISSUE_TITLE_LIMIT, "Der GitHub-Issue-Titel"),
    contentLengthError("githubBody", content.body, GITHUB_ISSUE_BODY_LIMIT, "Der GitHub-Issue-Body"),
  ].filter((error): error is ContentLengthError => error !== null);
}

export class GitHubContentLengthError extends Error {
  readonly retryable = false;
  constructor(readonly issues: ContentLengthError[]) {
    super(issues.map((issue) => issue.message).join(" "));
  }
}

export function assertGitHubIssueContent(content: { title: string; body: string }) {
  const errors = validateGitHubIssueContent(content);
  if (errors.length) throw new GitHubContentLengthError(errors);
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

export function founderOpsTaskUrl(taskId: string, appUrl?: string) {
  const configured = appUrl?.trim();
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

function sourceLine(task: IssueContentTask, appUrl?: string) {
  const taskUrl = founderOpsTaskUrl(task.id, appUrl);
  const source = taskUrl ? `[Open in FounderOps](${taskUrl})` : "FounderOps";
  return `Planning context: ${source}. GitHub issue sync keeps the working issue aligned.`;
}

function subIssueSourceLine(task: IssueContentTask, appUrl?: string) {
  const taskUrl = founderOpsTaskUrl(task.id, appUrl);
  return taskUrl ? `Source: [FounderOps](${taskUrl}).` : "Source: FounderOps.";
}

export function taskIssueMarker(taskId: string) {
  return `<!-- founderops-task-id:${taskId} -->`;
}

function subIssueBriefSections(task: IssueContentTask) {
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

function taskIssueBody(task: IssueContentTask, appUrl?: string) {
  if (task.taskType === "sub_issue") {
    const sections = subIssueBriefSections(task);
    return [
      ...(sections.length ? [sections.join("\n\n"), ""] : []),
      "---",
      subIssueSourceLine(task, appUrl),
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
    sourceLine(task, appUrl),
    taskIssueMarker(task.id),
  ].join("\n");
}

export function taskIssueUpdateBody(task: IssueContentTask, existingBody?: string | null, desiredBody = taskIssueBody(task)) {
  if (task.taskType !== "sub_issue" || !existingBody?.trim()) return desiredBody;

  const marker = taskIssueMarker(task.id);
  if (!subIssueBriefSections(task).length) {
    if (existingBody.includes(marker)) return desiredBody;
    return `${existingBody.trimEnd()}\n\n${marker}`;
  }
  return desiredBody;
}

