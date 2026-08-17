import {
  githubIssuePriorityToFounderOps,
  githubProjectStatusToFounderOps,
} from "./github-sync/project-field-context";

export {
  githubIssuePriorityToFounderOps,
  githubProjectStatusToFounderOps,
};

export type GitHubPlanningTaskSnapshot = Readonly<{
  id: string;
  taskType: "deliverable" | "sub_issue";
  updatedAt: string;
  title: string;
  description: string;
  problemStatement: string;
  intendedOutcome: string;
  scopeConstraints: string;
  acceptanceCriteria: string;
  evidenceRequired: string;
  definitionOfDone: string;
  status: string;
  priority: string;
  workstream: string;
  hours: number;
  evidenceLink: string;
  evidenceLinks: readonly string[];
  startDate: string;
  deadline: string;
  sprintId: string;
  ownerId: string;
  parentTaskId: string;
  reviewStatus: string;
  scoreFinal: boolean;
}>;

export type GitHubPlanningIssueSnapshot = Readonly<{
  id: number;
  nodeId: string;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: readonly string[];
  assigneeUserIds: readonly number[];
  updatedAt: string;
}>;

export type GitHubPlanningIssueDelivery = Readonly<{
  action: string;
  changedFields: readonly string[];
  targetUserId: number | null;
}>;

export type GitHubPlanningProjectDelivery = Readonly<{
  action: string;
}>;

export type GitHubPlanningProjectSnapshot = Readonly<{
  changedFieldName: string | null;
  changedFieldValue: string | number | Readonly<{ title: string; startDate: string }> | null;
}>;

export type GitHubPlanningChangeDecision =
  | Readonly<{ kind: "ignored"; reason: "unowned_change" | "already_aligned" }>
  | Readonly<{ kind: "reconcile"; reason: string }>
  | Readonly<{ kind: "update"; patch: Readonly<Record<string, unknown>> }>
  | Readonly<{ kind: "request_review" }>;

const managedLabels = new Set([
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

const priorityByLabel = new Map([
  ["p0-urgent", "P0"],
  ["p1-high", "P1"],
  ["p2-medium", "P2"],
  ["p3-low", "P3"],
]);

const managedIssueFieldNames = new Set([
  "Priority",
  "Start date",
  "Target date",
]);

const deliverableSections = [
  "Problem Statement",
  "Intended Outcome",
  "Scope & Constraints",
  "Acceptance Criteria",
  "Evidence Required",
  "Definition of Done",
] as const;

const subIssueSections = [
  "Context",
  "Problem Statement",
  "Intended Outcome",
  "Scope & Constraints",
  "Acceptance Criteria",
  "Evidence Required",
  "Definition of Done",
] as const;

function normalizedText(value: string) {
  const text = value.trim();
  return text === "_Nicht gesetzt._" ? "" : text;
}

function normalizedList(value: string) {
  const text = normalizedText(value);
  if (!text) return "";
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .join("\n");
}

function parseSections(
  body: string,
  taskId: string,
  allowedSections: readonly string[],
) {
  const marker = `<!-- founderops-task-id:${taskId} -->`;
  const markerMatches = body.match(/<!--\s*founderops-task-id:([^>]+?)\s*-->/g) || [];
  if (markerMatches.length !== 1 || !body.includes(marker)) {
    return { ok: false as const, reason: "task_marker_mismatch" };
  }

  const dividerIndex = body.lastIndexOf("\n---\n");
  if (dividerIndex < 0 || !body.slice(dividerIndex + 5).includes(marker)) {
    return { ok: false as const, reason: "managed_body_footer_missing" };
  }

  const managedBody = body.slice(0, dividerIndex).trim();
  if (!managedBody) return { ok: true as const, sections: new Map<string, string>() };
  if (!managedBody.startsWith("## ")) {
    return { ok: false as const, reason: "managed_body_has_free_text" };
  }

  const sections = new Map<string, string>();
  const headingPattern = /^## (.+)$/gm;
  const headings = [...managedBody.matchAll(headingPattern)];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]?.[1]?.trim() || "";
    if (!allowedSections.includes(heading) || sections.has(heading)) {
      return { ok: false as const, reason: "managed_body_section_invalid" };
    }
    const start = (headings[index]?.index || 0) + (headings[index]?.[0]?.length || 0);
    const end = headings[index + 1]?.index ?? managedBody.length;
    sections.set(heading, managedBody.slice(start, end).trim());
  }
  if (!headings.length || headings[0]?.index !== 0) {
    return { ok: false as const, reason: "managed_body_has_free_text" };
  }
  return { ok: true as const, sections };
}

export function parseFounderOpsGitHubIssueTitle(
  title: string,
  taskType: GitHubPlanningTaskSnapshot["taskType"],
) {
  const prefix = taskType === "sub_issue" ? "[Sub-Issue] " : "[Deliverable] ";
  if (!title.startsWith(prefix)) return { ok: false as const, reason: "managed_title_prefix" };
  const value = title.slice(prefix.length).trim();
  if (value.length < 3 || value.length > 240) {
    return { ok: false as const, reason: "managed_title_invalid" };
  }
  return { ok: true as const, value };
}

export function parseFounderOpsGitHubIssueBody(
  body: string,
  task: Pick<GitHubPlanningTaskSnapshot, "id" | "taskType">,
) {
  const allowed = task.taskType === "sub_issue" ? subIssueSections : deliverableSections;
  const parsed = parseSections(body, task.id, allowed);
  if (!parsed.ok) return parsed;
  const section = (name: string) => parsed.sections.get(name) || "";
  const patch = task.taskType === "sub_issue"
    ? {
        description: normalizedText(section("Context")),
        problemStatement: normalizedText(section("Problem Statement")),
        intendedOutcome: normalizedText(section("Intended Outcome")),
        scopeConstraints: normalizedList(section("Scope & Constraints")),
        acceptanceCriteria: normalizedList(section("Acceptance Criteria")),
        evidenceRequired: normalizedText(section("Evidence Required")),
        definitionOfDone: normalizedList(section("Definition of Done")),
      }
    : {
        problemStatement: normalizedText(section("Problem Statement")),
        intendedOutcome: normalizedText(section("Intended Outcome")),
        scopeConstraints: normalizedList(section("Scope & Constraints")),
        acceptanceCriteria: normalizedList(section("Acceptance Criteria")),
        evidenceRequired: normalizedText(section("Evidence Required")),
        definitionOfDone: normalizedList(section("Definition of Done")),
      };
  return { ok: true as const, patch };
}

function changedLabel(delivery: GitHubPlanningIssueDelivery) {
  const field = delivery.changedFields.find((candidate) => candidate.startsWith("label:"));
  return field?.slice("label:".length).trim().toLowerCase() || "";
}

function samePatch(task: GitHubPlanningTaskSnapshot, patch: Readonly<Record<string, unknown>>) {
  return Object.entries(patch).every(([field, value]) => task[field as keyof GitHubPlanningTaskSnapshot] === value);
}

export function decideGitHubIssuePlanningChange({
  delivery,
  issue,
  task,
  targetProfileId,
}: {
  delivery: GitHubPlanningIssueDelivery;
  issue: GitHubPlanningIssueSnapshot;
  task: GitHubPlanningTaskSnapshot;
  targetProfileId?: string | null;
}): GitHubPlanningChangeDecision {
  if (delivery.action === "milestoned" || delivery.action === "demilestoned") {
    return { kind: "ignored", reason: "unowned_change" };
  }

  if (delivery.action === "edited") {
    const patch: Record<string, unknown> = {};
    if (delivery.changedFields.includes("title")) {
      const title = parseFounderOpsGitHubIssueTitle(issue.title, task.taskType);
      if (!title.ok) return { kind: "reconcile", reason: title.reason };
      patch.title = title.value;
    }
    if (delivery.changedFields.includes("body")) {
      const body = parseFounderOpsGitHubIssueBody(issue.body, task);
      if (!body.ok) return { kind: "reconcile", reason: body.reason };
      Object.assign(patch, body.patch);
    }
    if (!Object.keys(patch).length) return { kind: "ignored", reason: "unowned_change" };
    return samePatch(task, patch)
      ? { kind: "ignored", reason: "already_aligned" }
      : { kind: "update", patch };
  }

  if (delivery.action === "assigned") {
    if (
      !delivery.targetUserId
      || !issue.assigneeUserIds.includes(delivery.targetUserId)
      || !targetProfileId
    ) {
      return { kind: "reconcile", reason: "assignee_not_mapped" };
    }
    return task.ownerId === targetProfileId
      ? { kind: "ignored", reason: "already_aligned" }
      : { kind: "update", patch: { ownerId: targetProfileId } };
  }
  if (delivery.action === "unassigned") {
    return { kind: "reconcile", reason: "assignee_removal_has_no_desired_owner" };
  }

  if (delivery.action === "closed" || delivery.action === "reopened") {
    const status = issue.state === "closed" ? "Erledigt" : "Offen";
    return task.status === status
      ? { kind: "ignored", reason: "already_aligned" }
      : { kind: "update", patch: { status } };
  }

  if (delivery.action === "labeled" || delivery.action === "unlabeled") {
    const label = changedLabel(delivery);
    if (!managedLabels.has(label)) return { kind: "ignored", reason: "unowned_change" };
    if (!issue.labels.some((candidate) => candidate.trim().toLowerCase() === label)) {
      return { kind: "reconcile", reason: "managed_label_removed" };
    }
    const priority = priorityByLabel.get(label);
    if (priority) {
      return task.taskType === "sub_issue"
        ? { kind: "reconcile", reason: "sub_issue_has_no_priority" }
        : task.priority === priority
          ? { kind: "ignored", reason: "already_aligned" }
          : { kind: "update", patch: { priority } };
    }
    if (label === "blocked") {
      return task.status === "Blockiert"
        ? { kind: "ignored", reason: "already_aligned" }
        : { kind: "update", patch: { status: "Blockiert" } };
    }
    if (label === "review:ready") {
      return task.taskType === "deliverable" && task.status !== "Review"
        ? { kind: "request_review" }
        : { kind: "reconcile", reason: "review_label_not_actionable" };
    }
    return { kind: "reconcile", reason: "projection_only_label" };
  }

  if (delivery.action === "field_added" || delivery.action === "field_removed") {
    return { kind: "reconcile", reason: "issue_field_requires_project_snapshot" };
  }

  return { kind: "reconcile", reason: "managed_issue_action_not_supported" };
}

export function isFounderOpsManagedGitHubIssueField(fieldName: string) {
  return managedIssueFieldNames.has(fieldName);
}

export function decideGitHubIssueFieldPlanningChange({
  fieldName,
  fieldValue,
  task,
}: {
  fieldName: string;
  fieldValue: GitHubPlanningProjectSnapshot["changedFieldValue"];
  task: GitHubPlanningTaskSnapshot;
}) {
  return decideGitHubProjectPlanningChange({
    delivery: { action: "edited" },
    project: { changedFieldName: fieldName, changedFieldValue: fieldValue },
    task,
  });
}

function validEvidenceUrl(value: string) {
  if (!value) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function decideGitHubProjectPlanningChange({
  delivery,
  project,
  task,
  resolvedSprintId,
}: {
  delivery: GitHubPlanningProjectDelivery;
  project: GitHubPlanningProjectSnapshot;
  task: GitHubPlanningTaskSnapshot;
  resolvedSprintId?: string | null;
}): GitHubPlanningChangeDecision {
  if (delivery.action === "reordered") return { kind: "ignored", reason: "unowned_change" };
  if (delivery.action !== "edited") {
    return { kind: "reconcile", reason: "project_membership_is_founderops_owned" };
  }

  const field = project.changedFieldName;
  const value = project.changedFieldValue;
  if (!field || ![
    "Status",
    "Sprint",
    "Workstream",
    "Estimate hours",
    "Evidence URL",
    "Priority",
    "Start date",
    "Target date",
  ].includes(field)) {
    return { kind: "ignored", reason: "unowned_change" };
  }

  if (field === "Status") {
    const status = typeof value === "string" ? githubProjectStatusToFounderOps(value) : null;
    if (!status) return { kind: "reconcile", reason: "project_status_invalid" };
    if (status === "Review") {
      return task.taskType === "deliverable" && task.status !== "Review"
        ? { kind: "request_review" }
        : task.status === "Review"
          ? { kind: "ignored", reason: "already_aligned" }
          : { kind: "reconcile", reason: "review_status_not_actionable" };
    }
    return task.status === status
      ? { kind: "ignored", reason: "already_aligned" }
      : { kind: "update", patch: { status } };
  }

  if (task.taskType !== "deliverable") {
    return { kind: "reconcile", reason: "project_field_not_supported_for_sub_issue" };
  }
  if (field === "Sprint") {
    if (value !== null && resolvedSprintId === undefined) {
      return { kind: "reconcile", reason: "project_sprint_not_mapped" };
    }
    const sprintId = resolvedSprintId || "";
    return task.sprintId === sprintId
      ? { kind: "ignored", reason: "already_aligned" }
      : { kind: "update", patch: { sprintId: resolvedSprintId || null } };
  }
  if (field === "Workstream") {
    const workstream = typeof value === "string" ? value.trim() : "";
    return task.workstream === workstream
      ? { kind: "ignored", reason: "already_aligned" }
      : { kind: "update", patch: { workstream } };
  }
  if (field === "Estimate hours") {
    if (value !== null && (
      typeof value !== "number"
      || !Number.isFinite(value)
      || !Number.isInteger(value)
      || value < 0
      || value > 200
    )) {
      return { kind: "reconcile", reason: "project_estimate_invalid" };
    }
    const hours = typeof value === "number" ? value : 0;
    return task.hours === hours
      ? { kind: "ignored", reason: "already_aligned" }
      : { kind: "update", patch: { hours } };
  }
  if (field === "Evidence URL") {
    const evidenceLink = typeof value === "string" ? value.trim() : "";
    if (!validEvidenceUrl(evidenceLink)) return { kind: "reconcile", reason: "project_evidence_url_invalid" };
    if (task.evidenceLinks.length > 1 && task.evidenceLink !== evidenceLink) {
      return { kind: "reconcile", reason: "multiple_founderops_evidence_links" };
    }
    return task.evidenceLink === evidenceLink
      ? { kind: "ignored", reason: "already_aligned" }
      : { kind: "update", patch: { evidenceLink } };
  }
  if (field === "Priority") {
    const priority = typeof value === "string" ? githubIssuePriorityToFounderOps(value) : null;
    if (!priority) return { kind: "reconcile", reason: "project_priority_ambiguous_or_invalid" };
    return task.priority === priority
      ? { kind: "ignored", reason: "already_aligned" }
      : { kind: "update", patch: { priority } };
  }
  if (field === "Start date") {
    const startDate = typeof value === "string" ? value : "";
    return task.startDate === startDate
      ? { kind: "ignored", reason: "already_aligned" }
      : { kind: "update", patch: { startDate } };
  }
  const deadline = typeof value === "string" ? value : "";
  return task.deadline === deadline
    ? { kind: "ignored", reason: "already_aligned" }
    : { kind: "update", patch: { deadline } };
}
