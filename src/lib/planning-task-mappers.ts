import type { Profile, Task } from "./types";
import type { DbTask } from "./planning-data-row-types";
import { profileNameById } from "./planning-profile-mappers";

export function mapTask(row: DbTask, profiles: Profile[]): Task {
  const ownerId = row.owner || "";
  const assigneeId = row.assignee || "";
  const createdById = row.created_by || "";
  const owner = profileNameById(profiles, row.owner);
  const assignee = profileNameById(profiles, row.assignee) || owner;
  const createdBy = profileNameById(profiles, row.created_by);

  return {
    id: row.id,
    order: row.sort_order,
    title: row.title,
    description: row.description || "",
    status: row.status,
    priority: row.priority,
    ownerId,
    owner,
    assigneeId,
    assignee,
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
    sprintId: row.sprint_id || "sprint-1",
    milestoneId: row.milestone_id || "",
    reviewStatus: row.review_status || "not_requested",
    reviewOwnerProfileId: row.review_owner_profile_id || "",
    reviewRequestedAt: row.review_requested_at || "",
    scorePoints: row.score_points || 0,
    scoreFinal: Boolean(row.score_final),
    githubRepo: row.github_repo || "findmydoc-platform/management",
    githubIssueNumber: row.github_issue_number,
    githubIssueUrl: row.github_issue_url || row.issue_url || "",
    githubSyncStatus: row.github_sync_status || "not_synced",
    githubLastSyncedAt: row.github_last_synced_at || "",
    githubSyncError: row.github_sync_error || "",
    taskType: row.task_type || "deliverable",
    parentTaskId: row.parent_task_id || "",
    scoreRelevant: row.score_relevant !== false,
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
  };
}
