import type { AuditEntry, AvailabilityEntry, Decision, DecisionComment, DecisionTaskLink, FeedbackItem, FmdTool, FounderSprintScore, FounderStrikeState, Meeting, MeetingAttendance, Milestone, NotificationDelivery, NotificationEvent, NotificationPreference, Package, Profile, ScoreObjection, Sprint, SprintCommitment, StrikeEvent, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskFocusItem, TaskRelation } from "./types";
import type { DbProfile, DbPackage, DbMilestone, DbTask, DbSprint, DbDecision, DbSprintCommitment, DbAvailability, DbAuditEntry, DbDecisionComment, DbTaskComment, DbTaskExternalComment, DbTaskBlocker, DbTaskRelation, DbTaskActivity, DbTaskFocusItem, DbDecisionTaskLink, DbNotificationEvent, DbNotificationDelivery, DbNotificationPreference, DbFeedbackItem, DbFmdTool, DbMeeting, DbMeetingAttendance, DbFounderSprintScore, DbFounderStrikeState, DbStrikeEvent, DbScoreObjection } from "./planning-data-row-types";

const fallbackProfileColors: Record<string, string> = {
  volkan: "#22c55e",
  sebastian: "#3b82f6",
  anil: "#f59e0b",
  ozen: "#8b5cf6",
  youssef: "#ec4899",
};

function profileColor(id: string, value?: string | null) {
  return value || fallbackProfileColors[id] || "#64748b";
}

export function mapProfile(row: DbProfile): Profile {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    platformRole: row.platform_role || (row.role === "admin" ? "ceo" : "founder"),
    orgRole: row.org_role || (row.role === "admin" ? "CEO" : "Founder"),
    githubLogin: row.github_login || "",
    deputyFor: row.deputy_for || "",
    deputyActiveFrom: row.deputy_active_from || "",
    deputyActiveUntil: row.deputy_active_until || "",
    focus: row.focus || "",
    weeklyCapacity: row.weekly_capacity,
    color: profileColor(row.id, row.profile_color),
    googleChatUserId: row.google_chat_user_id || "",
    googleChatDmSpace: row.google_chat_dm_space || "",
    notificationsEnabled: row.notifications_enabled !== false,
    googleCalendarEmail: row.google_calendar_email || "",
    googleCalendarSyncEnabled: Boolean(row.google_calendar_sync_enabled),
    googleCalendarLastSyncedAt: row.google_calendar_last_synced_at || "",
  };
}
export function mapPackage(row: DbPackage): Package {
  const ownerId = row.owner_id || "";
  return {
    id: row.id,
    milestoneId: row.milestone_id || "",
    ownerId,
    accountableProfileId: row.accountable_profile_id || ownerId,
    responsibleProfileIds: row.responsible_profile_ids?.length ? row.responsible_profile_ids : ownerId ? [ownerId] : [],
    consultedProfileIds: row.consulted_profile_ids || [],
    informedProfileIds: row.informed_profile_ids || [],
    title: row.title,
    goal: row.goal || "",
    priority: row.priority || "P2",
    status: row.status || "planned",
    targetDate: row.target_date || "",
    successCriteria: row.success_criteria || "",
    scopeConstraints: row.scope_constraints || "",
    sortOrder: row.sort_order,
  };
}

export function mapMilestone(row: DbMilestone): Milestone {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    targetDate: row.target_date || "",
    status: row.status,
    sortOrder: row.sort_order,
  };
}

export function mapTask(row: DbTask, profiles: Profile[]): Task {
  const ownerId = row.owner || "";
  const assigneeId = row.assignee || "";
  const createdById = row.created_by || "";
  const owner = profiles.find((profile) => profile.id === row.owner)?.name || row.owner || "";
  const assignee = profiles.find((profile) => profile.id === row.assignee)?.name || row.assignee || owner;
  const createdBy = profiles.find((profile) => profile.id === row.created_by)?.name || row.created_by || "";

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

export function mapSprint(row: DbSprint): Sprint {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    reviewDueAt: row.review_due_at || "",
    scoreLocked: row.score_locked,
  };
}

export function mapDecision(row: DbDecision): Decision {
  return {
    id: row.id,
    title: row.title,
    context: row.context || "",
    decision: row.decision || "",
    status: row.status,
    requiredProfileIds: row.required_profile_ids || [],
    confirmedProfileIds: row.decision_confirmations?.map((item) => item.profile_id) || [],
    createdBy: row.created_by || "",
    lockedAt: row.locked_at || "",
  };
}

export function mapSprintCommitment(row: DbSprintCommitment): SprintCommitment {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    profileId: row.profile_id,
    commitmentLevel: row.commitment_level,
    weeklyHours: row.weekly_hours,
    note: row.note || "",
  };
}

export function mapFounderSprintScore(row: DbFounderSprintScore): FounderSprintScore {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    profileId: row.profile_id,
    deliveryPoints: row.delivery_points,
    formPoints: row.form_points,
    weeklyPoints: row.weekly_points,
    totalPoints: row.total_points,
    fulfilled: row.fulfilled,
    awayNeutral: row.away_neutral,
    finalizedAt: row.finalized_at,
    finalizedBy: row.finalized_by || "",
    reasonSummary: row.reason_summary || "",
  };
}

export function mapFounderStrikeState(row: DbFounderStrikeState): FounderStrikeState {
  return {
    id: row.id,
    profileId: row.profile_id,
    strikeLevel: row.strike_level,
    fulfilledResetStreak: row.fulfilled_reset_streak,
    lastEvaluatedSprintId: row.last_evaluated_sprint_id || "",
    updatedAt: row.updated_at,
  };
}

export function mapStrikeEvent(row: DbStrikeEvent): StrikeEvent {
  return {
    id: row.id,
    profileId: row.profile_id,
    sprintId: row.sprint_id,
    eventType: row.event_type,
    previousStrikeLevel: row.previous_strike_level,
    nextStrikeLevel: row.next_strike_level,
    reason: row.reason || "",
    createdAt: row.created_at,
    createdBy: row.created_by || "",
  };
}

export function mapScoreObjection(row: DbScoreObjection): ScoreObjection {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    profileId: row.profile_id,
    founderSprintScoreId: row.founder_sprint_score_id,
    status: row.status,
    comment: row.comment,
    resolutionComment: row.resolution_comment || "",
    reviewedBy: row.reviewed_by || "",
    reviewedAt: row.reviewed_at || "",
    secondReviewerProfileId: row.second_reviewer_profile_id || "",
    secondReviewDecision: row.second_review_decision || "",
    secondReviewedAt: row.second_reviewed_at || "",
    createdAt: row.created_at,
  };
}

export function mapAvailability(row: DbAvailability): AvailabilityEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    type: row.type,
    title: row.title || "",
    blockerKind: row.blocker_kind || (row.type === "working_hours" ? "working_hours" : row.type === "vacation" ? "vacation" : row.type === "sick" ? "sick" : "on_business"),
    weekday: row.weekday,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    startTime: row.start_time || "",
    endTime: row.end_time || "",
    note: row.note || "",
    source: row.source || "manual",
    externalId: row.external_id || "",
    externalCalendarId: row.external_calendar_id || "",
    syncedAt: row.synced_at || "",
  };
}

export function mapAuditEntry(row: DbAuditEntry): AuditEntry {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actorProfileId: row.actor_profile_id || "",
    createdAt: row.created_at,
    beforeData: row.before_data,
    afterData: row.after_data,
  };
}

export function mapDecisionComment(row: DbDecisionComment): DecisionComment {
  return {
    id: row.id,
    decisionId: row.decision_id,
    profileId: row.profile_id || "",
    type: row.type,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

export function mapTaskComment(row: DbTaskComment): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    profileId: row.profile_id || "",
    comment: row.comment,
    createdAt: row.created_at,
  };
}

export function mapTaskExternalComment(row: DbTaskExternalComment): TaskExternalComment {
  return {
    id: row.id,
    taskId: row.task_id,
    source: row.source,
    externalId: row.external_id,
    authorLogin: row.author_login,
    authorAvatarUrl: row.author_avatar_url || "",
    body: row.body,
    htmlUrl: row.html_url || "",
    createdAt: row.created_at,
    importedAt: row.imported_at,
  };
}

export function mapTaskBlocker(row: DbTaskBlocker): TaskBlocker {
  return {
    id: row.id,
    taskId: row.task_id,
    profileId: row.profile_id || "",
    reason: row.reason,
    impact: row.impact || "",
    needsHelpFrom: row.needs_help_from || "",
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || "",
  };
}

export function mapTaskRelation(row: DbTaskRelation): TaskRelation {
  return {
    id: row.id,
    taskId: row.task_id,
    relatedTaskId: row.related_task_id,
    relationType: row.relation_type,
    note: row.note || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
  };
}

export function mapTaskActivity(row: DbTaskActivity): TaskActivity {
  return {
    id: row.id,
    taskId: row.task_id,
    message: row.message,
    createdAt: row.created_at,
  };
}

export function mapTaskFocusItem(row: DbTaskFocusItem): TaskFocusItem {
  return {
    id: row.id,
    profileId: row.profile_id || "",
    taskId: row.task_id,
    focusDate: row.focus_date,
    position: row.position,
    nextStep: row.next_step || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDecisionTaskLink(row: DbDecisionTaskLink): DecisionTaskLink {
  return {
    id: row.id,
    decisionId: row.decision_id,
    taskId: row.task_id,
    linkType: row.link_type,
    note: row.note || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
  };
}

export function mapNotificationEvent(row: DbNotificationEvent): NotificationEvent {
  return {
    id: row.id,
    type: row.type,
    actorProfileId: row.actor_profile_id || "",
    recipientProfileId: row.recipient_profile_id || "",
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body || "",
    status: row.status,
    createdAt: row.created_at,
  };
}

export function mapNotificationDelivery(row: DbNotificationDelivery): NotificationDelivery {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : null;
  return {
    id: row.id,
    eventId: row.event_id,
    channel: row.channel,
    status: row.status,
    attempts: row.attempts,
    target: row.target || "",
    lastError: row.last_error || "",
    deliveryMode: payload?.deliveryMode || "",
    digestSize: Number(payload?.digestSize || 0),
    deliveredAt: row.delivered_at || "",
    createdAt: row.created_at,
  };
}

export function mapNotificationPreference(row: DbNotificationPreference): NotificationPreference {
  return {
    id: row.id,
    profileId: row.profile_id,
    channel: row.channel,
    eventType: row.event_type,
    enabled: row.enabled,
  };
}

export function mapFeedbackItem(row: DbFeedbackItem): FeedbackItem {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    severity: row.severity,
    profileId: row.profile_id || "",
    title: row.title,
    description: row.description,
    pageUrl: row.page_url || "",
    createdAt: row.created_at,
  };
}

export function mapFmdTool(row: DbFmdTool): FmdTool {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    kind: row.kind,
    description: row.description || "",
    url: row.url || "",
    owner: row.owner || "",
    status: row.status,
    sortOrder: row.sort_order,
  };
}

export function mapMeeting(row: DbMeeting): Meeting {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    title: row.title,
    meetingAt: row.meeting_at,
    durationMinutes: row.duration_minutes || 60,
    status: row.status,
    agenda: row.agenda || "",
    googleCalendarId: row.google_calendar_id || "",
    googleCalendarEventId: row.google_calendar_event_id || "",
    googleCalendarHtmlLink: row.google_calendar_html_link || "",
    googleCalendarSyncStatus: row.google_calendar_sync_status || "not_synced",
    googleCalendarSyncError: row.google_calendar_sync_error || "",
    googleCalendarSyncedAt: row.google_calendar_synced_at || "",
  };
}

export function mapMeetingAttendance(row: DbMeetingAttendance): MeetingAttendance {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    profileId: row.profile_id,
    status: row.status,
    absenceReason: row.absence_reason || "",
    reasonAccepted: row.reason_accepted,
    writtenUpdate: row.written_update || "",
    points: row.points,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
