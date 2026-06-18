import { seedData } from "./generated/seed-data";
import { mapAuditEntry, mapAvailability, mapDecision, mapDecisionComment, mapDecisionTaskLink, mapFeedbackItem, mapFmdTool, mapFounderEvent, mapFounderSprintScore, mapFounderStrikeState, mapMeeting, mapMeetingAttendance, mapMilestone, mapNotificationDelivery, mapNotificationEvent, mapNotificationPreference, mapPackage, mapProfile, mapScoreObjection, mapSprint, mapSprintCommitment, mapStrikeEvent, mapTask, mapTaskActivity, mapTaskBlocker, mapTaskComment, mapTaskExternalComment, mapTaskFocusItem, mapTaskRelation } from "./planning-data-mappers";
import type { DbAuditEntry, DbAvailability, DbDecision, DbDecisionComment, DbDecisionTaskLink, DbFeedbackItem, DbFmdTool, DbFounderEvent, DbFounderSprintScore, DbFounderStrikeState, DbMeeting, DbMeetingAttendance, DbMilestone, DbNotificationDelivery, DbNotificationEvent, DbNotificationPreference, DbPackage, DbProfile, DbScoreObjection, DbSprint, DbSprintCommitment, DbStrikeEvent, DbTask, DbTaskActivity, DbTaskBlocker, DbTaskComment, DbTaskExternalComment, DbTaskFocusItem, DbTaskRelation } from "./planning-data-row-types";
import { getServerSupabase } from "./supabase";
import type { PlanningData } from "./types";

export const emptyPlanningData: PlanningData = {
  project: {
    id: "findmydoc-founder-execution",
    name: "findmydoc Founder Execution",
    range: "Geschützter Teamzugriff",
  },
  profiles: [],
  packages: [],
  milestones: [],
  tasks: [],
  sprints: [],
  sprintCommitments: [],
  founderSprintScores: [],
  founderStrikeStates: [],
  strikeEvents: [],
  scoreObjections: [],
  decisions: [],
  decisionComments: [],
  taskComments: [],
  taskExternalComments: [],
  taskBlockers: [],
  taskRelations: [],
  taskActivity: [],
  taskFocusItems: [],
  decisionTaskLinks: [],
  notificationEvents: [],
  notificationDeliveries: [],
  notificationPreferences: [],
  feedbackItems: [],
  fmdTools: [],
  events: [],
  meetings: [],
  meetingAttendance: [],
  audit: [],
  availability: [],
};

export async function getPlanningData(): Promise<{ data: PlanningData; source: "seed" | "supabase" }> {
  const supabase = getServerSupabase();
  if (!supabase) return { data: seedData, source: "seed" };

  const [projectResult, profileResult, packageResult, milestoneResult, taskResult, sprintResult, sprintCommitmentResult, founderSprintScoreResult, founderStrikeStateResult, strikeEventResult, scoreObjectionResult, decisionResult, commentResult, taskCommentResult, taskExternalCommentResult, taskBlockerResult, taskRelationResult, taskActivityResult, taskFocusResult, decisionTaskLinkResult, notificationResult, notificationDeliveryResult, notificationPreferenceResult, feedbackResult, fmdToolResult, eventResult, meetingResult, meetingAttendanceResult, auditResult, availabilityResult] = await Promise.all([
    supabase.from("projects").select("id,name,range_label").eq("id", "findmydoc-founder-execution").single(),
    supabase.from("profiles").select("id,name,role,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity,profile_color,google_chat_user_id,google_chat_dm_space,notifications_enabled,google_calendar_email,google_calendar_sync_enabled,google_calendar_last_synced_at").order("name"),
    supabase.from("packages").select("id,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids,consulted_profile_ids,informed_profile_ids,title,goal,priority,status,target_date,success_criteria,scope_constraints,sort_order").order("sort_order"),
    supabase.from("milestones").select("id,title,description,target_date,status,sort_order").eq("project_id", "findmydoc-founder-execution").order("sort_order"),
    supabase
      .from("tasks")
      .select("*, task_dependencies(note), task_notes(note)")
      .eq("project_id", "findmydoc-founder-execution")
      .order("sort_order"),
    supabase.from("sprints").select("id,name,status,start_date,end_date,review_due_at,score_locked").order("start_date"),
    supabase.from("sprint_commitments").select("id,sprint_id,profile_id,commitment_level,weekly_hours,note").order("profile_id"),
    supabase.from("founder_sprint_scores").select("id,sprint_id,profile_id,delivery_points,form_points,weekly_points,total_points,fulfilled,away_neutral,finalized_at,finalized_by,reason_summary").order("finalized_at", { ascending: false }).limit(500),
    supabase.from("founder_strike_state").select("id,profile_id,strike_level,fulfilled_reset_streak,last_evaluated_sprint_id,updated_at").order("profile_id"),
    supabase.from("strike_events").select("id,profile_id,sprint_id,event_type,previous_strike_level,next_strike_level,reason,created_at,created_by").order("created_at", { ascending: false }).limit(500),
    supabase.from("score_objections").select("id,sprint_id,profile_id,founder_sprint_score_id,status,comment,resolution_comment,reviewed_by,reviewed_at,second_reviewer_profile_id,second_review_decision,second_reviewed_at,created_at").order("created_at", { ascending: false }).limit(300),
    supabase.from("decision_log").select("id,title,context,decision,status,required_profile_ids,created_by,locked_at,decision_confirmations(profile_id)").order("created_at", { ascending: false }),
    supabase.from("decision_comments").select("id,decision_id,profile_id,type,comment,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("task_comments").select("id,task_id,profile_id,comment,created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("task_external_comments").select("id,task_id,source,external_id,author_login,author_avatar_url,body,html_url,created_at,imported_at").order("created_at", { ascending: false }).limit(300),
    supabase.from("task_blockers").select("id,task_id,profile_id,reason,impact,needs_help_from,status,created_at,resolved_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("task_relationship_edges").select("id,task_id,related_task_id,relation_type,note,created_by,created_at").order("created_at", { ascending: false }).limit(500),
    supabase.from("task_activity").select("id,task_id,message,created_at").order("created_at", { ascending: true }).limit(500),
    supabase.from("task_focus_items").select("id,profile_id,task_id,focus_date,position,next_step,status,created_at,updated_at").order("focus_date", { ascending: false }).order("position").limit(500),
    supabase.from("decision_task_links").select("id,decision_id,task_id,link_type,note,created_by,created_at").order("created_at", { ascending: false }).limit(500),
    supabase.from("notification_events").select("id,type,actor_profile_id,recipient_profile_id,entity_type,entity_id,title,body,status,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("notification_deliveries").select("id,event_id,channel,status,attempts,target,payload,last_error,delivered_at,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("notification_preferences").select("id,profile_id,channel,event_type,enabled").eq("channel", "google_chat").order("profile_id"),
    supabase.from("feedback_items").select("id,type,status,severity,profile_id,title,description,page_url,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("fmd_tools").select("id,name,category,kind,description,url,owner,status,sort_order").order("sort_order"),
    supabase.from("founder_events").select("id,title,category,starts_at,ends_at,location,description,audience_mode,participant_profile_ids,reminder_days_before,reminder_generated_at,status,created_by,created_at,updated_at").order("starts_at", { ascending: true }).limit(200),
    supabase.from("meetings").select("id,sprint_id,title,meeting_at,duration_minutes,status,agenda,google_calendar_id,google_calendar_event_id,google_calendar_html_link,google_calendar_sync_status,google_calendar_sync_error,google_calendar_synced_at").order("meeting_at", { ascending: false }).limit(100),
    supabase.from("meeting_attendance").select("id,meeting_id,profile_id,status,absence_reason,reason_accepted,written_update,points,created_at,updated_at").order("updated_at", { ascending: false }).limit(300),
    supabase.from("audit_log").select("id,entity_type,entity_id,action,actor_profile_id,created_at,before_data,after_data").eq("entity_type", "decision").order("created_at", { ascending: false }).limit(100),
    supabase.from("availability").select("id,profile_id,type,title,blocker_kind,weekday,start_date,end_date,start_time,end_time,note,source,external_id,external_calendar_id,synced_at").order("start_date"),
  ]);

  if (projectResult.error || profileResult.error || packageResult.error || taskResult.error) {
    return { data: seedData, source: "seed" };
  }

  const profiles = (profileResult.data as DbProfile[]).map(mapProfile);

  return {
    source: "supabase",
    data: {
      project: {
        id: projectResult.data.id,
        name: projectResult.data.name,
        range: projectResult.data.range_label || "",
      },
      profiles,
      packages: (packageResult.data as DbPackage[]).map(mapPackage),
      milestones: milestoneResult.error ? [] : (milestoneResult.data as DbMilestone[]).map(mapMilestone),
      tasks: (taskResult.data as DbTask[]).map((row) => mapTask(row, profiles)),
      sprints: sprintResult.error ? seedData.sprints : (sprintResult.data as DbSprint[]).map(mapSprint),
      sprintCommitments: sprintCommitmentResult.error ? [] : (sprintCommitmentResult.data as DbSprintCommitment[]).map(mapSprintCommitment),
      founderSprintScores: founderSprintScoreResult.error ? [] : (founderSprintScoreResult.data as DbFounderSprintScore[]).map(mapFounderSprintScore),
      founderStrikeStates: founderStrikeStateResult.error ? [] : (founderStrikeStateResult.data as DbFounderStrikeState[]).map(mapFounderStrikeState),
      strikeEvents: strikeEventResult.error ? [] : (strikeEventResult.data as DbStrikeEvent[]).map(mapStrikeEvent),
      scoreObjections: scoreObjectionResult.error ? [] : (scoreObjectionResult.data as DbScoreObjection[]).map(mapScoreObjection),
      decisions: decisionResult.error ? [] : (decisionResult.data as DbDecision[]).map(mapDecision),
      decisionComments: commentResult.error ? [] : (commentResult.data as DbDecisionComment[]).map(mapDecisionComment),
      taskComments: taskCommentResult.error ? [] : (taskCommentResult.data as DbTaskComment[]).map(mapTaskComment),
      taskExternalComments: taskExternalCommentResult.error ? [] : (taskExternalCommentResult.data as DbTaskExternalComment[]).map(mapTaskExternalComment),
      taskBlockers: taskBlockerResult.error ? [] : (taskBlockerResult.data as DbTaskBlocker[]).map(mapTaskBlocker),
      taskRelations: taskRelationResult.error ? [] : (taskRelationResult.data as DbTaskRelation[]).map(mapTaskRelation),
      taskActivity: taskActivityResult.error ? [] : (taskActivityResult.data as DbTaskActivity[]).map(mapTaskActivity),
      taskFocusItems: taskFocusResult.error ? [] : (taskFocusResult.data as DbTaskFocusItem[]).map(mapTaskFocusItem),
      decisionTaskLinks: decisionTaskLinkResult.error ? [] : (decisionTaskLinkResult.data as DbDecisionTaskLink[]).map(mapDecisionTaskLink),
      notificationEvents: notificationResult.error ? [] : (notificationResult.data as DbNotificationEvent[]).map(mapNotificationEvent),
      notificationDeliveries: notificationDeliveryResult.error ? [] : (notificationDeliveryResult.data as DbNotificationDelivery[]).map(mapNotificationDelivery),
      notificationPreferences: notificationPreferenceResult.error ? [] : (notificationPreferenceResult.data as DbNotificationPreference[]).map(mapNotificationPreference),
      feedbackItems: feedbackResult.error ? [] : (feedbackResult.data as DbFeedbackItem[]).map(mapFeedbackItem),
      fmdTools: fmdToolResult.error ? [] : (fmdToolResult.data as DbFmdTool[]).map(mapFmdTool),
      events: eventResult.error ? [] : (eventResult.data as DbFounderEvent[]).map(mapFounderEvent),
      meetings: meetingResult.error ? [] : (meetingResult.data as DbMeeting[]).map(mapMeeting),
      meetingAttendance: meetingAttendanceResult.error ? [] : (meetingAttendanceResult.data as DbMeetingAttendance[]).map(mapMeetingAttendance),
      audit: auditResult.error ? [] : (auditResult.data as DbAuditEntry[]).map(mapAuditEntry),
      availability: availabilityResult.error ? [] : (availabilityResult.data as DbAvailability[]).map(mapAvailability),
    },
  };
}
