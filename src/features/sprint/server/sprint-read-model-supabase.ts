import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPlanningItemsForReadModel, mapPlanningProject, planningProjectId } from "@/features/planning-items/server/planning-workspace-read-source";
import type { SprintReadModel } from "@/features/sprint/model/sprint-read-model";
import { mapFounderSprintScore, mapFounderStrikeState, mapMeeting, mapMeetingAttendance, mapScoreObjection, mapSprint, mapSprintCommitment, mapStrikeEvent } from "@/lib/planning-row-mappers";
import type { DbFounderSprintScore, DbFounderStrikeState, DbMeeting, DbMeetingAttendance, DbScoreObjection, DbSprint, DbSprintCommitment, DbStrikeEvent } from "@/lib/planning-row-types";

export function createSupabaseSprintReadModel(supabase: SupabaseClient): SprintReadModel {
  return {
    async load(context) {
      if (!context.authorized) return { status: "forbidden" };
      const [state, projectResult, sprintResult, commitmentResult, scoreResult, strikeStateResult, strikeEventResult, objectionResult, meetingResult, attendanceResult] = await Promise.all([
        loadPlanningItemsForReadModel(supabase),
        supabase.from("projects").select("id,name,range_label,review_objection_window_hours,github_project_owner,github_project_number").eq("id", planningProjectId).single(),
        supabase.from("sprints").select("id,name,status,start_date,end_date,review_due_at,score_locked").order("start_date").order("id"),
        supabase.from("sprint_commitments").select("id,sprint_id,profile_id,commitment_level,weekly_hours,note").order("profile_id"),
        supabase.from("founder_sprint_scores").select("id,sprint_id,profile_id,delivery_points,form_points,weekly_points,total_points,fulfilled,away_neutral,finalized_at,finalized_by,reason_summary").order("finalized_at", { ascending: false }).limit(500),
        supabase.from("founder_strike_state").select("id,profile_id,strike_level,fulfilled_reset_streak,last_evaluated_sprint_id,updated_at").order("profile_id"),
        supabase.from("strike_events").select("id,profile_id,sprint_id,event_type,previous_strike_level,next_strike_level,reason,created_at,created_by").order("created_at", { ascending: false }).limit(500),
        supabase.from("score_objections").select("id,sprint_id,profile_id,founder_sprint_score_id,status,comment,resolution_comment,reviewed_by,reviewed_at,resolved_delivery_points,resolved_form_points,resolved_weekly_points,second_reviewer_profile_id,second_review_decision,second_reviewed_at,created_at").order("created_at", { ascending: false }).limit(300),
        supabase.from("meetings").select("id,sprint_id,title,meeting_at,duration_minutes,status,agenda").order("meeting_at", { ascending: false }).limit(100),
        supabase.from("meeting_attendance").select("id,meeting_id,profile_id,status,absence_reason,reason_accepted,written_update,points,created_at,updated_at").order("updated_at", { ascending: false }).limit(300),
      ]);
      if (!state || projectResult.error || !projectResult.data || sprintResult.error || commitmentResult.error || scoreResult.error || strikeStateResult.error || strikeEventResult.error || objectionResult.error || meetingResult.error || attendanceResult.error) {
        return { status: "unavailable" };
      }
      const sprints = ((sprintResult.data || []) as DbSprint[]).map(mapSprint);
      return {
        status: "ready",
        model: {
          revision: sprints.map((sprint) => `${sprint.id}:${sprint.status}:${sprint.scoreLocked}`).join("|"),
          project: mapPlanningProject(projectResult.data),
          people: state.people,
          items: state.items,
          sprints,
          commitments: ((commitmentResult.data || []) as DbSprintCommitment[]).map(mapSprintCommitment),
          scores: ((scoreResult.data || []) as DbFounderSprintScore[]).map(mapFounderSprintScore),
          strikeStates: ((strikeStateResult.data || []) as DbFounderStrikeState[]).map(mapFounderStrikeState),
          strikeEvents: ((strikeEventResult.data || []) as DbStrikeEvent[]).map(mapStrikeEvent),
          objections: ((objectionResult.data || []) as DbScoreObjection[]).map(mapScoreObjection),
          meetings: ((meetingResult.data || []) as DbMeeting[]).map(mapMeeting),
          attendance: ((attendanceResult.data || []) as DbMeetingAttendance[]).map(mapMeetingAttendance),
        },
      };
    },
  };
}
