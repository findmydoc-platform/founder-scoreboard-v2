import type { Task } from "@/lib/types";

type BuildTaskInsertRowInput = {
  id: string;
  projectId?: string | null;
  packageId?: string | null;
  milestoneId?: string | null;
  title: string;
  description?: string | null;
  problemStatement?: string | null;
  intendedOutcome?: string | null;
  scopeConstraints?: string | null;
  acceptanceCriteria?: string | null;
  evidenceRequired?: string | null;
  dodTemplateVersion?: string | null;
  status: string;
  priority: string;
  owner?: string | null;
  assignee?: string | null;
  createdBy?: string | null;
  workstream?: string | null;
  sortOrder: number;
  startDate?: string | null;
  endDate?: string | null;
  deadline?: string | null;
  hours?: number | null;
  definitionOfDone?: string | null;
  sprintId?: string | null;
  reviewOwnerProfileId?: string | null;
  scorePoints?: number | null;
  scoreFinal?: boolean | null;
  githubRepo?: string | null;
  githubSyncStatus?: Task["githubSyncStatus"] | null;
  taskType?: Task["taskType"] | null;
  parentTaskId?: string | null;
  scoreRelevant?: boolean | null;
  evidenceLink?: string | null;
  issueNumber?: string | null;
  issueUrl?: string | null;
  githubIssueNumber?: number | null;
  githubIssueUrl?: string | null;
  originalSprintId?: string | null;
  carriedFromTaskId?: string | null;
  carriedFromSprintId?: string | null;
  carryoverReason?: string | null;
  carryoverCount?: number | null;
};

export function buildTaskInsertRow(input: BuildTaskInsertRowInput) {
  return {
    id: input.id,
    project_id: input.projectId || "findmydoc-founder-execution",
    package_id: input.packageId || null,
    milestone_id: input.milestoneId || null,
    title: input.title,
    description: input.description ?? null,
    problem_statement: input.problemStatement ?? null,
    intended_outcome: input.intendedOutcome ?? null,
    scope_constraints: input.scopeConstraints ?? null,
    acceptance_criteria: input.acceptanceCriteria ?? null,
    evidence_required: input.evidenceRequired ?? null,
    dod_template_version: input.dodTemplateVersion || "founder-deliverable-v2",
    status: input.status,
    priority: input.priority,
    owner: input.owner || null,
    assignee: input.assignee || input.owner || null,
    created_by: input.createdBy || null,
    workstream: input.workstream ?? null,
    sort_order: input.sortOrder,
    start_date: input.startDate || null,
    end_date: input.endDate || null,
    deadline: input.deadline || null,
    estimate_hours: input.hours ?? null,
    definition_of_done: input.definitionOfDone ?? null,
    evidence_link: input.evidenceLink ?? null,
    issue_number: input.issueNumber || null,
    issue_url: input.issueUrl || null,
    github_issue_number: input.githubIssueNumber || null,
    github_issue_url: input.githubIssueUrl || null,
    sprint_id: input.sprintId || null,
    review_status: "not_requested",
    review_owner_profile_id: input.reviewOwnerProfileId || null,
    score_points: input.scorePoints ?? 0,
    score_final: input.scoreFinal ?? false,
    github_repo: input.githubRepo || "findmydoc-platform/management",
    github_sync_status: input.githubSyncStatus || "not_synced",
    task_type: input.taskType || "deliverable",
    parent_task_id: input.parentTaskId || null,
    score_relevant: input.scoreRelevant ?? true,
    original_sprint_id: input.originalSprintId || null,
    carried_from_task_id: input.carriedFromTaskId || null,
    carried_from_sprint_id: input.carriedFromSprintId || null,
    carryover_reason: input.carryoverReason || null,
    carryover_count: input.carryoverCount ?? null,
  };
}
