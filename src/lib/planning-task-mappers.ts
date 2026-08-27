import type { LinkedPullRequest, Profile, Task, TaskReview } from "./types";
import type { DbPlanningItemRaciAssignment, DbPlanningItemStrategy, DbTask, DbTaskLink, DbTaskReview } from "./planning-row-types";
import { profileNameById } from "./planning-profile-mappers";
import { normalizeSubIssueStatus } from "./status";

export type TaskRowForMapping = Partial<DbTask>;
type TaskProfileLookup = Profile[] | Map<string, string>;

type MapTaskRowOptions = {
  defaultSprintId?: string;
  taskLinks?: DbTaskLink[];
  strategy?: DbPlanningItemStrategy;
  raciAssignments?: DbPlanningItemRaciAssignment[];
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
  const taskType: Task["taskType"] = row.task_type === "epic"
    || row.task_type === "initiative"
    || row.task_type === "sub_issue"
    ? row.task_type
    : "deliverable";
  const isStrategic = taskType === "epic" || taskType === "initiative";
  const isDeliverable = taskType === "deliverable";
  const approvalStatus = taskType === "epic" || taskType === "sub_issue"
    ? null
    : row.approval_status || "proposed";
  const taskLinks = taskLinkProjection(row, options.taskLinks);
  const evidenceLinks = isDeliverable ? taskLinks.evidenceLinks : [];
  // Sub-Issues intentionally keep their GitHub projection and linked pull
  // requests, while evidence gates remain a Deliverable-only concern.
  const linkedPullRequests = isStrategic ? [] : taskLinks.linkedPullRequests;
  const status = taskType === "sub_issue"
    ? normalizeSubIssueStatus(row.status || "Offen")
    : row.status || "Offen";
  const description = taskType === "sub_issue" && !row.description?.trim()
    ? row.problem_statement || ""
    : row.description || "";

  return {
    id: row.id || "",
    order: row.sort_order || 0,
    title: row.title || "",
    description,
    status,
    priority: row.priority || "",
    assigneeId,
    assignee,
    ownerId,
    owner,
    createdById,
    createdBy,
    workstream: row.workstream || "",
    targetDate: row.target_date || "",
    fixedDate: isDeliverable ? row.fixed_date || "" : "",
    problemStatement: row.problem_statement || "",
    intendedOutcome: row.intended_outcome || "",
    scopeConstraints: row.scope_constraints || "",
    acceptanceCriteria: row.acceptance_criteria || "",
    evidenceRequired: row.evidence_required || "",
    dodTemplateVersion: isDeliverable ? row.dod_template_version || "founder-deliverable-v2" : "",
    definitionOfDone: row.definition_of_done || "",
    dependsOn: row.task_dependencies?.map((item) => item.note).join("; ") || "",
    evidenceLink: isDeliverable ? evidenceLinks[0] || row.evidence_link || "" : "",
    evidenceLinks,
    linkedPullRequests,
    issueNumber: row.issue_number || "",
    issueUrl: row.issue_url || "",
    note: row.task_notes?.note || "",
    watched: Boolean(row.watched),
    hours: row.estimate_hours || 0,
    sprintId: isDeliverable ? row.sprint_id || options.defaultSprintId || "" : "",
    reviewStatus: isDeliverable ? row.review_status || "not_requested" : "not_requested",
    reviewOwnerProfileId: isDeliverable ? row.review_owner_profile_id || "" : "",
    reviewRequestedAt: isDeliverable ? row.review_requested_at || "" : "",
    scorePoints: isDeliverable ? row.score_points || 0 : 0,
    scoreFinal: isDeliverable && Boolean(row.score_final),
    githubRepo: isStrategic ? "" : row.github_repo || "findmydoc-platform/management",
    githubIssueNumber: isStrategic ? null : row.github_issue_number ?? null,
    githubIssueUrl: isStrategic ? "" : row.github_issue_url || row.issue_url || "",
    githubIssueSyncStatus: isStrategic ? "not_applicable" : row.github_issue_sync_status || "not_synced",
    githubIssueLastSyncedAt: isStrategic ? "" : row.github_issue_last_synced_at || "",
    githubIssueSyncError: isStrategic ? "" : row.github_issue_sync_error || "",
    taskType,
    parentTaskId: row.parent_task_id || "",
    strategy: taskType === "initiative" ? {
      goal: options.strategy?.goal || "",
      successCriteria: options.strategy?.success_criteria || "",
      scopeConstraints: options.strategy?.scope_constraints || "",
    } : undefined,
    raciAssignments: taskType === "initiative"
      ? (options.raciAssignments || []).map((assignment) => ({
        profileId: assignment.profile_id,
        role: assignment.role,
        sortOrder: assignment.sort_order,
      }))
      : [],
    approvalStatus,
    approvalRevision: Number(row.approval_revision || 1),
    proposedById: row.proposed_by || "",
    proposedAt: row.proposed_at || "",
    decidedById: row.decided_by || "",
    decidedAt: row.decided_at || "",
    decisionNote: row.decision_note || "",
    parentApprovalStatus: null,
    scoreRelevant: isDeliverable && approvalStatus === "approved" && row.score_relevant !== false,
    originalSprintId: isDeliverable ? row.original_sprint_id || "" : "",
    carriedFromTaskId: isDeliverable ? row.carried_from_task_id || "" : "",
    carriedFromSprintId: isDeliverable ? row.carried_from_sprint_id || "" : "",
    carryoverReason: isDeliverable ? row.carryover_reason || "" : "",
    carryoverCount: isDeliverable ? row.carryover_count || 0 : 0,
    sprintOutcome: isDeliverable ? row.sprint_outcome || "" : "",
    selfDodChecked: isDeliverable && Boolean(row.self_dod_checked),
    selfEvidenceChecked: isDeliverable && Boolean(row.self_evidence_checked),
    selfDocumentedChecked: isDeliverable && Boolean(row.self_documented_checked),
    selfBlockersChecked: isDeliverable && Boolean(row.self_blockers_checked),
    updatedAt: row.updated_at || "",
    createdAt: row.created_at || "",
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

export function mapTask(
  row: DbTask,
  profiles: Profile[],
  taskLinks: DbTaskLink[] = [],
  options: Omit<MapTaskRowOptions, "defaultSprintId" | "taskLinks"> = {},
): Task {
  return mapTaskRow(row, profiles, { defaultSprintId: "sprint-1", taskLinks, ...options });
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
