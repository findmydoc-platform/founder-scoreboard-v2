import type { FmdTool, FounderEvent, Meeting, MeetingAttendance, Milestone, NotificationDelivery, NotificationEvent, NotificationPreference, Package, PlanningFilterPreferences, Profile, ProfileFeatureTourAcknowledgement, ProfileUiPreference, ScoreObjection, Sprint, SprintCommitment, StrikeEvent, Task, TaskBlocker, TaskComment, TaskExternalComment, TaskFocusItem, TaskRelation, TaskReview } from "./types";

export type DbProfile = {
  id: string;
  name: string;
  role: Profile["role"];
  platform_role: Profile["platformRole"] | null;
  org_role: string | null;
  github_login: string | null;
  deputy_for: string | null;
  deputy_active_from: string | null;
  deputy_active_until: string | null;
  focus: string | null;
  weekly_capacity: number;
  profile_color: string | null;
  google_chat_user_id: string | null;
  google_chat_dm_space: string | null;
  notifications_enabled: boolean | null;
};

export type DbPackage = {
  id: string;
  milestone_id: string | null;
  owner_id: string | null;
  accountable_profile_id: string | null;
  responsible_profile_ids: string[] | null;
  consulted_profile_ids: string[] | null;
  informed_profile_ids: string[] | null;
  title: string;
  goal: string | null;
  priority: string | null;
  status: Package["status"] | null;
  target_date: string | null;
  success_criteria: string | null;
  scope_constraints: string | null;
  sort_order: number;
  approval_status: Package["approvalStatus"] | null;
  approval_revision: number | null;
  proposed_by: string | null;
  proposed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  trashed_at: string | null;
  trashed_by: string | null;
  trash_reason: string | null;
  trash_cause: Package["trashCause"] | null;
  purge_after: string | null;
  trash_root_type: Package["trashRootType"] | null;
  trash_root_id: string | null;
  trash_revision: number;
};

export type DbMilestone = {
  id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  status: Milestone["status"];
  sort_order: number;
  updated_at: string | null;
};

export type DbTask = {
  id: string;
  sort_order: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  owner: string | null;
  assignee: string | null;
  created_by: string | null;
  workstream: string | null;
  package_id: string | null;
  deadline: string | null;
  problem_statement: string | null;
  intended_outcome: string | null;
  scope_constraints: string | null;
  acceptance_criteria: string | null;
  evidence_required: string | null;
  dod_template_version: string | null;
  definition_of_done: string | null;
  evidence_link: string | null;
  issue_number: string | null;
  issue_url: string | null;
  watched: boolean | null;
  estimate_hours: number | null;
  start_date: string | null;
  end_date: string | null;
  sprint_id: string | null;
  milestone_id: string | null;
  review_status: Task["reviewStatus"] | null;
  review_owner_profile_id: string | null;
  review_requested_at: string | null;
  score_points: number | null;
  score_final: boolean | null;
  github_repo: string | null;
  github_issue_number: number | null;
  github_issue_url: string | null;
  github_issue_sync_status: Task["githubIssueSyncStatus"] | null;
  github_issue_last_synced_at: string | null;
  github_issue_sync_error: string | null;
  task_type: Task["taskType"] | null;
  parent_task_id: string | null;
  approval_status: Task["approvalStatus"];
  approval_revision: number | null;
  proposed_by: string | null;
  proposed_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  trashed_at: string | null;
  trashed_by: string | null;
  trash_reason: string | null;
  trash_cause: Task["trashCause"] | null;
  purge_after: string | null;
  trash_root_type: Task["trashRootType"] | null;
  trash_root_id: string | null;
  trash_revision: number;
  score_relevant: boolean | null;
  original_sprint_id: string | null;
  carried_from_task_id: string | null;
  carried_from_sprint_id: string | null;
  carryover_reason: string | null;
  carryover_count: number | null;
  sprint_outcome: Task["sprintOutcome"] | null;
  self_dod_checked: boolean | null;
  self_evidence_checked: boolean | null;
  self_documented_checked: boolean | null;
  self_blockers_checked: boolean | null;
  updated_at: string;
  task_dependencies?: { note: string }[];
  task_notes?: { note: string } | null;
};

export type DbTaskLink = {
  id: number;
  task_id: string;
  type: string;
  label: string;
  url: string;
  position: number;
  metadata: Record<string, unknown> | null;
};

export type DbTaskReview = {
  id: number;
  task_id: string;
  sprint_id: string | null;
  reviewer_profile_id: string | null;
  decision: TaskReview["decision"];
  points: number;
  comment: string | null;
  checklist: TaskReview["checklist"] | null;
  created_at: string;
};

type DbTaskScalarColumn = Exclude<keyof DbTask, "task_dependencies" | "task_notes">;

export const taskRowColumns = [
  "id",
  "sort_order",
  "title",
  "description",
  "status",
  "priority",
  "owner",
  "assignee",
  "created_by",
  "workstream",
  "package_id",
  "deadline",
  "problem_statement",
  "intended_outcome",
  "scope_constraints",
  "acceptance_criteria",
  "evidence_required",
  "dod_template_version",
  "definition_of_done",
  "evidence_link",
  "issue_number",
  "issue_url",
  "watched",
  "estimate_hours",
  "start_date",
  "end_date",
  "sprint_id",
  "milestone_id",
  "review_status",
  "review_owner_profile_id",
  "review_requested_at",
  "score_points",
  "score_final",
  "github_repo",
  "github_issue_number",
  "github_issue_url",
  "github_issue_sync_status",
  "github_issue_last_synced_at",
  "github_issue_sync_error",
  "task_type",
  "parent_task_id",
  "approval_status",
  "approval_revision",
  "proposed_by",
  "proposed_at",
  "decided_by",
  "decided_at",
  "decision_note",
  "trashed_at",
  "trashed_by",
  "trash_reason",
  "trash_cause",
  "purge_after",
  "trash_root_type",
  "trash_root_id",
  "trash_revision",
  "score_relevant",
  "original_sprint_id",
  "carried_from_task_id",
  "carried_from_sprint_id",
  "carryover_reason",
  "carryover_count",
  "sprint_outcome",
  "self_dod_checked",
  "self_evidence_checked",
  "self_documented_checked",
  "self_blockers_checked",
  "updated_at",
] as const satisfies readonly DbTaskScalarColumn[];

export const taskRelationSelect = "task_dependencies(note), task_notes(note)";
export const taskRowSelect: string = `${taskRowColumns.join(",")}, ${taskRelationSelect}`;

export type DbSprint = {
  id: string;
  name: string;
  status: Sprint["status"];
  start_date: string | null;
  end_date: string | null;
  review_due_at: string | null;
  score_locked: boolean;
};

export type DbSprintCommitment = {
  id: number;
  sprint_id: string;
  profile_id: string;
  commitment_level: SprintCommitment["commitmentLevel"];
  weekly_hours: number;
  note: string | null;
};

export type DbFounderSprintScore = {
  id: number;
  sprint_id: string;
  profile_id: string;
  delivery_points: number;
  form_points: number;
  weekly_points: number;
  total_points: number;
  fulfilled: boolean;
  away_neutral: boolean;
  finalized_at: string;
  finalized_by: string | null;
  reason_summary: string | null;
};

export type DbFounderStrikeState = {
  id: number;
  profile_id: string;
  strike_level: number;
  fulfilled_reset_streak: number;
  last_evaluated_sprint_id: string | null;
  updated_at: string;
};

export type DbStrikeEvent = {
  id: number;
  profile_id: string;
  sprint_id: string;
  event_type: StrikeEvent["eventType"];
  previous_strike_level: number;
  next_strike_level: number;
  reason: string | null;
  created_at: string;
  created_by: string | null;
};

export type DbScoreObjection = {
  id: number;
  sprint_id: string;
  profile_id: string;
  founder_sprint_score_id: number | null;
  status: ScoreObjection["status"];
  comment: string;
  resolution_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  resolved_delivery_points: number | null;
  resolved_form_points: number | null;
  resolved_weekly_points: number | null;
  second_reviewer_profile_id: string | null;
  second_review_decision: string | null;
  second_reviewed_at: string | null;
  created_at: string;
};

export type DbAuditEntry = {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_profile_id: string | null;
  created_at: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
};

export type DbTaskAuditActivity = {
  id: number;
  task_id: string;
  action: string;
  actor_profile_id: string | null;
  message: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export type DbTaskComment = {
  id: number;
  task_id: string;
  profile_id: string | null;
  comment: string;
  created_at: string;
  task_comment_github_deliveries?: {
    status: TaskComment["githubDeliveryStatus"];
    github_comment_url: string | null;
  } | Array<{
    status: TaskComment["githubDeliveryStatus"];
    github_comment_url: string | null;
  }> | null;
};

export type DbTaskExternalComment = {
  id: number;
  task_id: string;
  source: TaskExternalComment["source"];
  external_id: string;
  author_login: string;
  author_avatar_url: string | null;
  body: string;
  html_url: string | null;
  created_at: string;
  imported_at: string;
};

export type DbTaskBlocker = {
  id: number;
  task_id: string;
  profile_id: string | null;
  reason: string;
  impact: string | null;
  needs_help_from: string | null;
  status: TaskBlocker["status"];
  created_at: string;
  resolved_at: string | null;
};

export type DbTaskRelation = {
  id: number;
  task_id: string;
  related_task_id: string;
  relation_type: TaskRelation["relationType"];
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type DbTaskFocusItem = {
  id: number;
  profile_id: string | null;
  task_id: string;
  focus_date: string;
  position: number;
  next_step: string | null;
  status: TaskFocusItem["status"];
  created_at: string;
  updated_at: string;
};

export type DbNotificationEvent = {
  id: number;
  type: string;
  actor_profile_id: string | null;
  recipient_profile_id: string | null;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string | null;
  status: NotificationEvent["status"];
  seen_at: string | null;
  dismissed_at: string | null;
  resolved_at: string | null;
  resolution_reason: string | null;
  created_at: string;
};

export type DbNotificationDelivery = {
  id: number;
  event_id: number;
  channel: NotificationDelivery["channel"];
  status: NotificationDelivery["status"];
  attempts: number;
  target: string | null;
  payload: {
    deliveryMode?: "direct_dm" | "webhook_digest";
    digestSize?: number;
  } | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
};

export type DbNotificationPreference = {
  id: number;
  profile_id: string;
  channel: NotificationPreference["channel"];
  event_type: string;
  enabled: boolean;
};

export type DbProfileUiPreference = {
  profile_id: string;
  default_workspace: string | null;
  default_task_view: ProfileUiPreference["defaultTaskView"] | null;
  planning_filters: Partial<PlanningFilterPreferences> | null;
  expanded_package_ids: string[] | null;
  created_at: string;
  updated_at: string;
};

export type DbProfileFeatureTourAcknowledgement = {
  profile_id: string;
  tour_id: ProfileFeatureTourAcknowledgement["tourId"];
  seen_at: string;
};

export type DbFmdTool = {
  id: string;
  name: string;
  category: FmdTool["category"];
  kind: string;
  description: string | null;
  url: string | null;
  owner: string | null;
  status: FmdTool["status"];
  is_curated: boolean | null;
  preview_image_url: string | null;
  preview_image_source: FmdTool["previewImageSource"] | null;
  sort_order: number;
};

export type DbFounderEvent = {
  id: number;
  title: string;
  category: FounderEvent["category"];
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  description: string | null;
  audience_mode: FounderEvent["audienceMode"];
  participant_profile_ids: string[] | null;
  reminder_days_before: number;
  reminder_generated_at: string | null;
  status: FounderEvent["status"];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type DbMeeting = {
  id: number;
  sprint_id: string;
  title: string;
  meeting_at: string;
  duration_minutes: number | null;
  status: Meeting["status"];
  agenda: string | null;
};

export type DbMeetingAttendance = {
  id: number;
  meeting_id: number;
  profile_id: string;
  status: MeetingAttendance["status"];
  absence_reason: string | null;
  reason_accepted: boolean;
  written_update: string | null;
  points: number;
  created_at: string;
  updated_at: string;
};
