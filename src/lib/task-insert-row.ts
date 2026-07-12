import type { Task } from "@/lib/types";
import { defaultGitHubRepository } from "@/lib/github-repositories";

type BuildTaskInsertRowInput = {
  id: string;
  creationRequestId?: string | null;
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
  githubIssueSyncStatus?: Task["githubIssueSyncStatus"] | null;
  taskType?: Task["taskType"] | "proposal" | null;
  parentTaskId?: string | null;
  scoreRelevant?: boolean | null;
  approvalStatus?: Task["approvalStatus"];
  approvalRevision?: number | null;
  proposedById?: string | null;
  proposedAt?: string | null;
  decidedById?: string | null;
  decidedAt?: string | null;
  decisionNote?: string | null;
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
    creation_request_id: input.creationRequestId || null,
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
    owner: input.owner || input.assignee || null,
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
    github_repo: input.githubRepo || defaultGitHubRepository,
    github_issue_sync_status: input.githubIssueSyncStatus || "not_synced",
    task_type: input.taskType || "deliverable",
    parent_task_id: input.parentTaskId || null,
    score_relevant: input.scoreRelevant ?? true,
    approval_status: input.taskType === "sub_issue" ? null : input.approvalStatus || undefined,
    approval_revision: input.approvalRevision ?? undefined,
    proposed_by: input.proposedById || null,
    proposed_at: input.proposedAt || null,
    decided_by: input.decidedById || null,
    decided_at: input.decidedAt || null,
    decision_note: input.decisionNote || null,
    original_sprint_id: input.originalSprintId || null,
    carried_from_task_id: input.carriedFromTaskId || null,
    carried_from_sprint_id: input.carriedFromSprintId || null,
    carryover_reason: input.carryoverReason || null,
    carryover_count: input.carryoverCount ?? null,
  };
}
