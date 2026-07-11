import type { SupabaseClient } from "@supabase/supabase-js";
import { mapAuditEntry, mapFmdTool, mapFounderEvent, mapFounderSprintScore, mapFounderStrikeState, mapMeeting, mapMeetingAttendance, mapMilestone, mapNotificationDelivery, mapNotificationEvent, mapNotificationPreference, mapPackage, mapProfile, mapProfileFeatureTourAcknowledgement, mapProfileUiPreference, mapScoreObjection, mapSprint, mapSprintCommitment, mapStrikeEvent, mapTask, mapTaskActivity, mapTaskBlocker, mapTaskComment, mapTaskExternalComment, mapTaskFocusItem, mapTaskRelation } from "./planning-data-mappers";
import { taskRowSelect } from "./planning-data-row-types";
import type { DbAuditEntry, DbFmdTool, DbFounderEvent, DbFounderSprintScore, DbFounderStrikeState, DbMeeting, DbMeetingAttendance, DbMilestone, DbNotificationDelivery, DbNotificationEvent, DbNotificationPreference, DbPackage, DbProfile, DbProfileFeatureTourAcknowledgement, DbProfileUiPreference, DbScoreObjection, DbSprint, DbSprintCommitment, DbStrikeEvent, DbTask, DbTaskActivity, DbTaskBlocker, DbTaskComment, DbTaskExternalComment, DbTaskFocusItem, DbTaskRelation } from "./planning-data-row-types";
import type { PlanningData } from "./types";

const founderProjectId = "findmydoc-founder-execution";

const planningDataQueryKeys = [
  "milestones",
  "sprintCommitments",
  "founderSprintScores",
  "founderStrikeStates",
  "strikeEvents",
  "scoreObjections",
  "taskComments",
  "taskExternalComments",
  "taskBlockers",
  "taskRelations",
  "taskActivity",
  "taskFocusItems",
  "notificationEvents",
  "notificationDeliveries",
  "notificationPreferences",
  "profileUiPreferences",
  "profileFeatureTourAcknowledgements",
  "fmdTools",
  "events",
  "meetings",
  "meetingAttendance",
  "audit",
] as const;

export type PlanningDataQueryKey = typeof planningDataQueryKeys[number];
export type PlanningDataQueryScope = Partial<Record<PlanningDataQueryKey, boolean>>;

export const fullPlanningDataQueryScope = Object.fromEntries(
  planningDataQueryKeys.map((key) => [key, true]),
) as Record<PlanningDataQueryKey, true>;

export function shouldLoad(scope: PlanningDataQueryScope | undefined, key: PlanningDataQueryKey) {
  return scope?.[key] !== false;
}

function skippedListResult<Row>() {
  return { data: [] as Row[], error: null };
}

export async function loadPlanningDataRows(supabase: SupabaseClient, scope: PlanningDataQueryScope = fullPlanningDataQueryScope) {
  const [projectResult, profileResult, packageResult, milestoneResult, taskResult, sprintResult, sprintCommitmentResult, founderSprintScoreResult, founderStrikeStateResult, strikeEventResult, scoreObjectionResult, taskCommentResult, taskExternalCommentResult, taskBlockerResult, taskRelationResult, taskActivityResult, taskFocusResult, notificationResult, notificationDeliveryResult, notificationPreferenceResult, profileUiPreferenceResult, profileFeatureTourAcknowledgementResult, fmdToolResult, eventResult, meetingResult, meetingAttendanceResult, auditResult] = await Promise.all([
    supabase.from("projects").select("id,name,range_label").eq("id", founderProjectId).single(),
    supabase.from("profiles").select("id,name,role,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity,profile_color,google_chat_user_id,google_chat_dm_space,notifications_enabled").order("name"),
    supabase.from("packages").select("id,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids,consulted_profile_ids,informed_profile_ids,title,goal,priority,status,target_date,success_criteria,scope_constraints,sort_order").order("sort_order"),
    shouldLoad(scope, "milestones") ? supabase.from("milestones").select("id,title,description,target_date,status,sort_order").eq("project_id", founderProjectId).order("sort_order") : Promise.resolve(skippedListResult<DbMilestone>()),
    supabase
      .from("tasks")
      .select(taskRowSelect)
      .eq("project_id", founderProjectId)
      .order("sort_order"),
    supabase.from("sprints").select("id,name,status,start_date,end_date,review_due_at,score_locked").order("start_date"),
    shouldLoad(scope, "sprintCommitments") ? supabase.from("sprint_commitments").select("id,sprint_id,profile_id,commitment_level,weekly_hours,note").order("profile_id") : Promise.resolve(skippedListResult<DbSprintCommitment>()),
    shouldLoad(scope, "founderSprintScores") ? supabase.from("founder_sprint_scores").select("id,sprint_id,profile_id,delivery_points,form_points,weekly_points,total_points,fulfilled,away_neutral,finalized_at,finalized_by,reason_summary").order("finalized_at", { ascending: false }).limit(500) : Promise.resolve(skippedListResult<DbFounderSprintScore>()),
    shouldLoad(scope, "founderStrikeStates") ? supabase.from("founder_strike_state").select("id,profile_id,strike_level,fulfilled_reset_streak,last_evaluated_sprint_id,updated_at").order("profile_id") : Promise.resolve(skippedListResult<DbFounderStrikeState>()),
    shouldLoad(scope, "strikeEvents") ? supabase.from("strike_events").select("id,profile_id,sprint_id,event_type,previous_strike_level,next_strike_level,reason,created_at,created_by").order("created_at", { ascending: false }).limit(500) : Promise.resolve(skippedListResult<DbStrikeEvent>()),
    shouldLoad(scope, "scoreObjections") ? supabase.from("score_objections").select("id,sprint_id,profile_id,founder_sprint_score_id,status,comment,resolution_comment,reviewed_by,reviewed_at,resolved_delivery_points,resolved_form_points,resolved_weekly_points,second_reviewer_profile_id,second_review_decision,second_reviewed_at,created_at").order("created_at", { ascending: false }).limit(300) : Promise.resolve(skippedListResult<DbScoreObjection>()),
    shouldLoad(scope, "taskComments") ? supabase.from("task_comments").select("id,task_id,profile_id,comment,created_at").order("created_at", { ascending: false }).limit(200) : Promise.resolve(skippedListResult<DbTaskComment>()),
    shouldLoad(scope, "taskExternalComments") ? supabase.from("task_external_comments").select("id,task_id,source,external_id,author_login,author_avatar_url,body,html_url,created_at,imported_at").order("created_at", { ascending: false }).limit(300) : Promise.resolve(skippedListResult<DbTaskExternalComment>()),
    shouldLoad(scope, "taskBlockers") ? supabase.from("task_blockers").select("id,task_id,profile_id,reason,impact,needs_help_from,status,created_at,resolved_at").order("created_at", { ascending: false }).limit(200) : Promise.resolve(skippedListResult<DbTaskBlocker>()),
    shouldLoad(scope, "taskRelations") ? supabase.from("task_relationship_edges").select("id,task_id,related_task_id,relation_type,note,created_by,created_at").order("created_at", { ascending: false }).limit(500) : Promise.resolve(skippedListResult<DbTaskRelation>()),
    shouldLoad(scope, "taskActivity") ? supabase.from("task_activity").select("id,task_id,message,created_at").order("created_at", { ascending: true }).limit(500) : Promise.resolve(skippedListResult<DbTaskActivity>()),
    shouldLoad(scope, "taskFocusItems") ? supabase.from("task_focus_items").select("id,profile_id,task_id,focus_date,position,next_step,status,created_at,updated_at").order("focus_date", { ascending: false }).order("position").limit(500) : Promise.resolve(skippedListResult<DbTaskFocusItem>()),
    shouldLoad(scope, "notificationEvents") ? supabase.from("notification_events").select("id,type,actor_profile_id,recipient_profile_id,entity_type,entity_id,title,body,status,seen_at,dismissed_at,resolved_at,resolution_reason,created_at").order("created_at", { ascending: false }).limit(500) : Promise.resolve(skippedListResult<DbNotificationEvent>()),
    shouldLoad(scope, "notificationDeliveries") ? supabase.from("notification_deliveries").select("id,event_id,channel,status,attempts,target,payload,last_error,delivered_at,created_at").order("created_at", { ascending: false }).limit(100) : Promise.resolve(skippedListResult<DbNotificationDelivery>()),
    shouldLoad(scope, "notificationPreferences") ? supabase.from("notification_preferences").select("id,profile_id,channel,event_type,enabled").eq("channel", "google_chat").order("profile_id") : Promise.resolve(skippedListResult<DbNotificationPreference>()),
    shouldLoad(scope, "profileUiPreferences") ? supabase.from("profile_ui_preferences").select("profile_id,default_workspace,default_task_view,planning_filters,expanded_package_ids,created_at,updated_at").order("profile_id") : Promise.resolve(skippedListResult<DbProfileUiPreference>()),
    shouldLoad(scope, "profileFeatureTourAcknowledgements") ? supabase.from("profile_feature_tour_acknowledgements").select("profile_id,tour_id,seen_at").order("seen_at", { ascending: false }) : Promise.resolve(skippedListResult<DbProfileFeatureTourAcknowledgement>()),
    shouldLoad(scope, "fmdTools") ? supabase.from("fmd_tools").select("id,name,category,kind,description,url,owner,status,is_curated,preview_image_url,preview_image_source,sort_order").order("sort_order") : Promise.resolve(skippedListResult<DbFmdTool>()),
    shouldLoad(scope, "events") ? supabase.from("founder_events").select("id,title,category,starts_at,ends_at,location,description,audience_mode,participant_profile_ids,reminder_days_before,reminder_generated_at,status,created_by,created_at,updated_at").order("starts_at", { ascending: true }).limit(200) : Promise.resolve(skippedListResult<DbFounderEvent>()),
    shouldLoad(scope, "meetings") ? supabase.from("meetings").select("id,sprint_id,title,meeting_at,duration_minutes,status,agenda").order("meeting_at", { ascending: false }).limit(100) : Promise.resolve(skippedListResult<DbMeeting>()),
    shouldLoad(scope, "meetingAttendance") ? supabase.from("meeting_attendance").select("id,meeting_id,profile_id,status,absence_reason,reason_accepted,written_update,points,created_at,updated_at").order("updated_at", { ascending: false }).limit(300) : Promise.resolve(skippedListResult<DbMeetingAttendance>()),
    shouldLoad(scope, "audit") ? supabase.from("audit_log").select("id,entity_type,entity_id,action,actor_profile_id,created_at,before_data,after_data").order("created_at", { ascending: false }).limit(100) : Promise.resolve(skippedListResult<DbAuditEntry>()),
  ] as const);

  return {
    projectResult,
    profileResult,
    packageResult,
    milestoneResult,
    taskResult,
    sprintResult,
    sprintCommitmentResult,
    founderSprintScoreResult,
    founderStrikeStateResult,
    strikeEventResult,
    scoreObjectionResult,
    taskCommentResult,
    taskExternalCommentResult,
    taskBlockerResult,
    taskRelationResult,
    taskActivityResult,
    taskFocusResult,
    notificationResult,
    notificationDeliveryResult,
    notificationPreferenceResult,
    profileUiPreferenceResult,
    profileFeatureTourAcknowledgementResult,
    fmdToolResult,
    eventResult,
    meetingResult,
    meetingAttendanceResult,
    auditResult,
  };
}

export type PlanningDataRows = Awaited<ReturnType<typeof loadPlanningDataRows>>;

export function hasCorePlanningDataError(rows: PlanningDataRows) {
  return Boolean(rows.projectResult.error || rows.profileResult.error || rows.packageResult.error || rows.taskResult.error);
}

export function mapPlanningDataRows(rows: PlanningDataRows): PlanningData {
  const project = rows.projectResult.data;
  if (!project) {
    throw new Error("Planning project was not loaded.");
  }

  const profiles = (rows.profileResult.data as DbProfile[]).map(mapProfile);

  return {
    project: {
      id: project.id,
      name: project.name,
      range: project.range_label || "",
    },
    profiles,
    packages: (rows.packageResult.data as DbPackage[]).map(mapPackage),
    milestones: rows.milestoneResult.error ? [] : (rows.milestoneResult.data as DbMilestone[]).map(mapMilestone),
    tasks: (rows.taskResult.data as unknown as DbTask[]).map((row) => mapTask(row, profiles)),
    sprints: rows.sprintResult.error ? [] : (rows.sprintResult.data as DbSprint[]).map(mapSprint),
    sprintCommitments: rows.sprintCommitmentResult.error ? [] : (rows.sprintCommitmentResult.data as DbSprintCommitment[]).map(mapSprintCommitment),
    founderSprintScores: rows.founderSprintScoreResult.error ? [] : (rows.founderSprintScoreResult.data as DbFounderSprintScore[]).map(mapFounderSprintScore),
    founderStrikeStates: rows.founderStrikeStateResult.error ? [] : (rows.founderStrikeStateResult.data as DbFounderStrikeState[]).map(mapFounderStrikeState),
    strikeEvents: rows.strikeEventResult.error ? [] : (rows.strikeEventResult.data as DbStrikeEvent[]).map(mapStrikeEvent),
    scoreObjections: rows.scoreObjectionResult.error ? [] : (rows.scoreObjectionResult.data as DbScoreObjection[]).map(mapScoreObjection),
    taskComments: rows.taskCommentResult.error ? [] : (rows.taskCommentResult.data as DbTaskComment[]).map(mapTaskComment),
    taskExternalComments: rows.taskExternalCommentResult.error ? [] : (rows.taskExternalCommentResult.data as DbTaskExternalComment[]).map(mapTaskExternalComment),
    taskBlockers: rows.taskBlockerResult.error ? [] : (rows.taskBlockerResult.data as DbTaskBlocker[]).map(mapTaskBlocker),
    taskRelations: rows.taskRelationResult.error ? [] : (rows.taskRelationResult.data as DbTaskRelation[]).map(mapTaskRelation),
    taskActivity: rows.taskActivityResult.error ? [] : (rows.taskActivityResult.data as DbTaskActivity[]).map(mapTaskActivity),
    taskFocusItems: rows.taskFocusResult.error ? [] : (rows.taskFocusResult.data as DbTaskFocusItem[]).map(mapTaskFocusItem),
    notificationEvents: rows.notificationResult.error ? [] : (rows.notificationResult.data as DbNotificationEvent[]).map(mapNotificationEvent),
    notificationDeliveries: rows.notificationDeliveryResult.error ? [] : (rows.notificationDeliveryResult.data as DbNotificationDelivery[]).map(mapNotificationDelivery),
    notificationPreferences: rows.notificationPreferenceResult.error ? [] : (rows.notificationPreferenceResult.data as DbNotificationPreference[]).map(mapNotificationPreference),
    profileUiPreferences: rows.profileUiPreferenceResult.error ? [] : (rows.profileUiPreferenceResult.data as DbProfileUiPreference[]).map(mapProfileUiPreference),
    profileFeatureTourAcknowledgements: rows.profileFeatureTourAcknowledgementResult.error ? [] : (rows.profileFeatureTourAcknowledgementResult.data as DbProfileFeatureTourAcknowledgement[]).map(mapProfileFeatureTourAcknowledgement),
    fmdTools: rows.fmdToolResult.error ? [] : (rows.fmdToolResult.data as DbFmdTool[]).map(mapFmdTool),
    events: rows.eventResult.error ? [] : (rows.eventResult.data as DbFounderEvent[]).map(mapFounderEvent),
    meetings: rows.meetingResult.error ? [] : (rows.meetingResult.data as DbMeeting[]).map(mapMeeting),
    meetingAttendance: rows.meetingAttendanceResult.error ? [] : (rows.meetingAttendanceResult.data as DbMeetingAttendance[]).map(mapMeetingAttendance),
    audit: rows.auditResult.error ? [] : (rows.auditResult.data as DbAuditEntry[]).map(mapAuditEntry),
  };
}
