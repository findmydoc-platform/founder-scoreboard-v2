import type { Profile, Task } from "./types";
import type { DbTask } from "./planning-data-row-types";
import { profileNameById } from "./planning-profile-mappers";

export type TaskRowForMapping = Partial<DbTask>;
type TaskProfileLookup = Profile[] | Map<string, string>;

type MapTaskRowOptions = {
  defaultSprintId?: string;
};

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

  return {
    id: row.id || "",
    order: row.sort_order || 0,
    title: row.title || "",
    description: row.description || "",
    status: row.status || "Offen",
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
    problemStatement: row.problem_statement || "",
    intendedOutcome: row.intended_outcome || "",
    scopeConstraints: row.scope_constraints || "",
    acceptanceCriteria: row.acceptance_criteria || "",
    evidenceRequired: row.evidence_required || "",
    dodTemplateVersion: row.dod_template_version || "founder-deliverable-v2",
    definitionOfDone: row.definition_of_done || "",
    dependsOn: row.task_dependencies?.map((item) => item.note).join("; ") || "",
    evidenceLink: row.evidence_link || "",
    issueNumber: row.issue_number || "",
    issueUrl: row.issue_url || "",
    note: row.task_notes?.note || "",
    watched: Boolean(row.watched),
    hours: row.estimate_hours || 0,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    sprintId: row.sprint_id || options.defaultSprintId || "",
    milestoneId: row.milestone_id || "",
    reviewStatus: row.review_status || "not_requested",
    reviewOwnerProfileId: row.review_owner_profile_id || "",
    reviewRequestedAt: row.review_requested_at || "",
    scorePoints: row.score_points || 0,
    scoreFinal: Boolean(row.score_final),
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
    scoreRelevant: approvalStatus === "approved" && row.score_relevant !== false,
    originalSprintId: row.original_sprint_id || "",
    carriedFromTaskId: row.carried_from_task_id || "",
    carriedFromSprintId: row.carried_from_sprint_id || "",
    carryoverReason: row.carryover_reason || "",
    carryoverCount: row.carryover_count || 0,
    sprintOutcome: row.sprint_outcome || "",
    selfDodChecked: Boolean(row.self_dod_checked),
    selfEvidenceChecked: Boolean(row.self_evidence_checked),
    selfDocumentedChecked: Boolean(row.self_documented_checked),
    selfBlockersChecked: Boolean(row.self_blockers_checked),
    updatedAt: row.updated_at || "",
  };
}

export function mapTask(row: DbTask, profiles: Profile[]): Task {
  return mapTaskRow(row, profiles, { defaultSprintId: "sprint-1" });
}
