import type { LinkedPullRequest, Profile, Task, TaskReview } from "./types";
import type { DbTask, DbTaskLink, DbTaskReview } from "./planning-data-row-types";
import { profileNameById } from "./planning-profile-mappers";
import { normalizeSubIssueStatus } from "./status";

export type TaskRowForMapping = Partial<DbTask>;
type TaskProfileLookup = Profile[] | Map<string, string>;

type MapTaskRowOptions = {
  defaultSprintId?: string;
  includeLegacySubIssueBrief?: boolean;
  taskLinks?: DbTaskLink[];
};

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function taskLinkProjection(row: TaskRowForMapping, taskLinks: DbTaskLink[] = []) {
  const orderedLinks = [...taskLinks].sort((left, right) => left.position - right.position || left.id - right.id);
  const evidenceLinks = [...new Set(
    orderedLinks
      .filter((link) => link.type === "evidence" && isHttpUrl(link.url))
      .map((link) => link.url),
  )];
  if (!evidenceLinks.length && row.evidence_link && isHttpUrl(row.evidence_link)) {
    evidenceLinks.push(row.evidence_link);
  }

  const linkedPullRequests = orderedLinks.flatMap((link): LinkedPullRequest[] => {
    if (link.type !== "github_pull_request") return [];
    const metadata = link.metadata || {};
    const repository = typeof metadata.repository === "string" ? metadata.repository : "";
    const number = typeof metadata.number === "number" ? metadata.number : Number(metadata.number);
    const status = metadata.status;
    if (
      !repository
      || !Number.isInteger(number)
      || number <= 0
      || !isHttpUrl(link.url)
      || (status !== "open" && status !== "merged" && status !== "closed")
    ) {
      return [];
    }
    return [{
      title: link.label,
      repository,
      number,
      url: link.url,
      status,
      ...(typeof metadata.mergedAt === "string" && metadata.mergedAt ? { mergedAt: metadata.mergedAt } : {}),
    }];
  });

  return { evidenceLinks, linkedPullRequests };
}

function profileName(lookup: TaskProfileLookup, profileId?: string | null) {
  if (Array.isArray(lookup)) return profileNameById(lookup, profileId);
  return lookup.get(profileId || "") || profileId || "";
}

export function mapTaskRow(row: TaskRowForMapping, profiles: TaskProfileLookup, options: MapTaskRowOptions = {}): Task {
  const assigneeId = row.assignee || row.owner || "";
  const ownerId = row.owner || assigneeId;
  const createdById = row.created_by || "";
  const assignee = profileName(profiles, assigneeId);
  const owner = profileName(profiles, ownerId) || assignee;
  const createdBy = profileName(profiles, row.created_by);
  const taskType: Task["taskType"] = row.task_type === "sub_issue" ? "sub_issue" : "deliverable";
  const approvalStatus = taskType === "sub_issue" ? null : row.approval_status || "approved";
  const taskLinks = taskLinkProjection(row, options.taskLinks);
  const evidenceLinks = taskType === "sub_issue" ? [] : taskLinks.evidenceLinks;
  const linkedPullRequests = taskLinks.linkedPullRequests;
  const status = taskType === "sub_issue"
    ? normalizeSubIssueStatus(row.status || "Offen")
    : row.status || "Offen";
  const description = taskType === "sub_issue" && !row.description?.trim()
    ? row.problem_statement || ""
    : row.description || "";
  const includeLegacySubIssueBrief = taskType === "sub_issue"
    && Boolean(options.includeLegacySubIssueBrief)
    && Boolean(row.problem_statement?.trim());

  return {
    id: row.id || "",
    order: row.sort_order || 0,
    title: row.title || "",
    description,
    status,
    priority: row.priority || "P2",
    assigneeId,
    assignee,
    ownerId,
    owner,
    createdById,
    createdBy,
    workstream: row.workstream || "",
    packageId: row.package_id || "",
    deadline: row.deadline || "",
    problemStatement: taskType === "sub_issue" && !includeLegacySubIssueBrief ? "" : row.problem_statement || "",
    intendedOutcome: taskType === "sub_issue" && !includeLegacySubIssueBrief ? "" : row.intended_outcome || "",
    scopeConstraints: taskType === "sub_issue" && !includeLegacySubIssueBrief ? "" : row.scope_constraints || "",
    acceptanceCriteria: taskType === "sub_issue" && !includeLegacySubIssueBrief ? "" : row.acceptance_criteria || "",
    evidenceRequired: taskType === "sub_issue" && !includeLegacySubIssueBrief ? "" : row.evidence_required || "",
    dodTemplateVersion: taskType === "sub_issue" ? "" : row.dod_template_version || "founder-deliverable-v2",
    definitionOfDone: taskType === "sub_issue" && !includeLegacySubIssueBrief ? "" : row.definition_of_done || "",
    dependsOn: row.task_dependencies?.map((item) => item.note).join("; ") || "",
    evidenceLink: taskType === "sub_issue" ? "" : evidenceLinks[0] || row.evidence_link || "",
    evidenceLinks,
    linkedPullRequests,
    issueNumber: row.issue_number || "",
    issueUrl: row.issue_url || "",
    note: row.task_notes?.note || "",
    watched: Boolean(row.watched),
    hours: row.estimate_hours || 0,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    sprintId: row.sprint_id || options.defaultSprintId || "",
    milestoneId: row.milestone_id || "",
    reviewStatus: taskType === "sub_issue" ? "not_requested" : row.review_status || "not_requested",
    reviewOwnerProfileId: taskType === "sub_issue" ? "" : row.review_owner_profile_id || "",
    reviewRequestedAt: taskType === "sub_issue" ? "" : row.review_requested_at || "",
    scorePoints: taskType === "sub_issue" ? 0 : row.score_points || 0,
    scoreFinal: taskType === "deliverable" && Boolean(row.score_final),
    githubRepo: row.github_repo || "findmydoc-platform/management",
    githubIssueNumber: row.github_issue_number ?? null,
    githubIssueUrl: row.github_issue_url || row.issue_url || "",
    githubIssueSyncStatus: row.github_issue_sync_status || "not_synced",
    githubIssueLastSyncedAt: row.github_issue_last_synced_at || "",
    githubIssueSyncError: row.github_issue_sync_error || "",
    taskType,
    parentTaskId: row.parent_task_id || "",
    approvalStatus,
    approvalRevision: Number(row.approval_revision || 1),
    proposedById: row.proposed_by || "",
    proposedAt: row.proposed_at || "",
    decidedById: row.decided_by || "",
    decidedAt: row.decided_at || "",
    decisionNote: row.decision_note || "",
    parentApprovalStatus: null,
    scoreRelevant: taskType === "deliverable" && approvalStatus === "approved" && row.score_relevant !== false,
    originalSprintId: row.original_sprint_id || "",
    carriedFromTaskId: row.carried_from_task_id || "",
    carriedFromSprintId: row.carried_from_sprint_id || "",
    carryoverReason: row.carryover_reason || "",
    carryoverCount: row.carryover_count || 0,
    sprintOutcome: row.sprint_outcome || "",
    selfDodChecked: taskType === "deliverable" && Boolean(row.self_dod_checked),
    selfEvidenceChecked: taskType === "deliverable" && Boolean(row.self_evidence_checked),
    selfDocumentedChecked: taskType === "deliverable" && Boolean(row.self_documented_checked),
    selfBlockersChecked: taskType === "deliverable" && Boolean(row.self_blockers_checked),
    updatedAt: row.updated_at || "",
    trashedAt: row.trashed_at || "",
    trashedById: row.trashed_by || "",
    trashReason: row.trash_reason || "",
    trashCause: row.trash_cause || undefined,
    purgeAfter: row.purge_after || "",
    trashRootType: row.trash_root_type || undefined,
    trashRootId: row.trash_root_id || "",
    trashRevision: Number(row.trash_revision || 0),
  };
}

export function mapTask(row: DbTask, profiles: Profile[], taskLinks: DbTaskLink[] = []): Task {
  return mapTaskRow(row, profiles, { defaultSprintId: "sprint-1", taskLinks });
}

export function mapTaskReview(row: DbTaskReview): TaskReview {
  return {
    id: row.id,
    taskId: row.task_id,
    sprintId: row.sprint_id || "",
    reviewerProfileId: row.reviewer_profile_id || "",
    decision: row.decision,
    points: Number(row.points || 0),
    comment: row.comment || "",
    checklist: row.checklist || {},
    createdAt: row.created_at,
  };
}
