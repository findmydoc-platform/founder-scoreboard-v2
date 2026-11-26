import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sprintWorkspaceModelToPlanningShellState } from "@/features/sprint/model/sprint-planning-shell-projection";
import { buildSprintScoreViewModel } from "@/features/sprint/model/sprint-score-view-model";
import type { SprintAssessmentResult, SprintAssessmentSource } from "@/features/sprint/model/sprint-assessment-read";
import { mapProfile } from "@/lib/planning-profile-mappers";
import { mapFounderSprintScore, mapFounderStrikeState, mapMeeting, mapMeetingAttendance, mapScoreObjection, mapSprint, mapSprintCommitment } from "@/lib/planning-row-mappers";
import { mapTaskRow, type TaskRowForMapping } from "@/lib/planning-task-mappers";
import type { DbFounderSprintScore, DbFounderStrikeState, DbMeeting, DbMeetingAttendance, DbProfile, DbScoreObjection, DbSprint, DbSprintCommitment, DbTaskLink } from "@/lib/planning-row-types";
import type { PlatformRole } from "@/lib/types";
import { mapPlanningProject, planningProjectId } from "./planning-workspace-read-source";

type Access = { userId: string; sessionId: string; profileId: string; role: PlatformRole; deadline: number; signal?: AbortSignal };
type RawAssessment = {
  status: "ready" | "forbidden" | "notFound" | "unavailable";
  sprint_id: string;
  source_revision: string;
  evaluated_at: string;
  valid_until: string;
  project: Parameters<typeof mapPlanningProject>[0];
  sprint: DbSprint;
  profiles: DbProfile[];
  items: TaskRowForMapping[];
  links: DbTaskLink[];
  commitments: DbSprintCommitment[];
  scores: DbFounderSprintScore[];
  strike_states: DbFounderStrikeState[];
  objections: DbScoreObjection[];
  meetings: DbMeeting[];
  attendance: DbMeetingAttendance[];
};
const completeScope = {
  people: "complete", items: "complete", commitments: "complete", scores: "complete",
  strikeStates: "complete", objections: "complete", meetings: "complete", attendance: "complete",
} as const;

export async function observePlanningSprintAssessment(
  user: SupabaseClient, access: Access, sprintId: string,
): Promise<SprintAssessmentResult<SprintAssessmentSource>> {
  if (access.deadline <= Date.now()) return { status: "forbidden" };
  try {
    const request = user.rpc("planning_sprint_assessment_publication_context", { p_sprint_id: sprintId });
    const result = await (access.signal ? request.abortSignal(access.signal) : request);
    if (result.status === 401 || result.status === 403 || access.deadline <= Date.now()) return { status: "forbidden" };
    if (result.error || access.signal?.aborted) return { status: "unavailable" };
    const row = result.data;
    if (row?.status === "notFound") return { status: "notFound" };
    if (row?.status !== "ready" || typeof row.source_revision !== "string" || !row.source_revision) return { status: "unavailable" };
    if (row.profile_id !== access.profileId || row.platform_role !== access.role) return { status: "forbidden" };
    return { status: "ready", read: {
      sprintId, sourceRevision: row.source_revision,
      readAuthority: { userId: access.userId, deadline: access.deadline },
      readActor: { profileId: access.profileId, platformRole: access.role },
    } };
  } catch {
    return { status: "unavailable" };
  }
}

export async function loadPlanningSprintAssessment(
  service: SupabaseClient, user: SupabaseClient, access: Access, sprintId: string,
): Promise<SprintAssessmentResult> {
  if (access.deadline <= Date.now()) return { status: "forbidden" };
  try {
    const request = service.rpc("planning_sprint_assessment_snapshot", {
      p_sprint_id: sprintId, p_actor_profile_id: access.profileId, p_actor_user_id: access.userId,
      p_session_id: access.sessionId, p_platform_role: access.role, p_deadline: new Date(access.deadline).toISOString(),
    });
    const result = await (access.signal ? request.abortSignal(access.signal) : request);
    if (result.status === 401 || result.status === 403 || access.deadline <= Date.now()) return { status: "forbidden" };
    if (result.error || access.signal?.aborted) return { status: "unavailable" };
    const row = result.data as RawAssessment | null;
    if (row?.status === "forbidden" || row?.status === "notFound") return { status: row.status };
    if (row?.status !== "ready" || row.sprint_id !== sprintId || row.sprint?.id !== sprintId || typeof row.sprint.score_locked !== "boolean"
      || row.project?.id !== planningProjectId || typeof row.source_revision !== "string" || !row.source_revision
      || !Number.isFinite(Date.parse(row.evaluated_at)) || !Number.isFinite(Date.parse(row.valid_until))
      || ![row.profiles,row.items,row.links,row.commitments,row.scores,row.strike_states,
        row.objections,row.meetings,row.attendance].every(Array.isArray)) return { status: "unavailable" };
    if (Date.parse(row.valid_until) <= Date.now()) return { status: "stale" };

    const people = row.profiles.map(mapProfile);
    const itemIds = new Set(row.items.map(item => item.id));
    const meetingIds = new Set(row.meetings.map(meeting => meeting.id));
    if (!people.some(person => person.id === access.profileId) || itemIds.size !== row.items.length
      || meetingIds.size !== row.meetings.length || row.items.some(item => !item.id || item.sprint_id !== sprintId || item.task_type !== "deliverable")
      || row.links.some(link => !itemIds.has(link.task_id) || link.type !== "evidence")
      || [row.commitments,row.scores,row.objections,row.meetings].some(set => set.some(item => item.sprint_id !== sprintId))
      || row.attendance.some(attendance => !meetingIds.has(attendance.meeting_id))) return { status: "unavailable" };
    const linksByItem = new Map<string, DbTaskLink[]>();
    for (const link of row.links) {
      const links = linksByItem.get(link.task_id);
      if (links) links.push(link);
      else linksByItem.set(link.task_id, [link]);
    }

    const data = sprintWorkspaceModelToPlanningShellState({
      revision: row.source_revision, project: mapPlanningProject(row.project), people,
      items: row.items.map(item => mapTaskRow(item, people, { taskLinks: linksByItem.get(item.id!) })),
      sprints: [mapSprint(row.sprint)], commitments: row.commitments.map(mapSprintCommitment),
      scores: row.scores.map(mapFounderSprintScore), strikeStates: row.strike_states.map(mapFounderStrikeState),
      strikeEvents: [], objections: row.objections.map(mapScoreObjection),
      meetings: row.meetings.map(mapMeeting), attendance: row.attendance.map(mapMeetingAttendance),
    });
    const { scoreRows } = buildSprintScoreViewModel({ data, selectedSprintId: sprintId, coverage: completeScope });
    const observation = await observePlanningSprintAssessment(user, access, sprintId);
    if (observation.status !== "ready") return observation.status === "notFound" ? { status: "stale" } : observation;
    if (observation.read.sourceRevision !== row.source_revision || Date.parse(row.valid_until) <= Date.now()) return { status: "stale" };
    return { status: "ready", read: {
      ...observation.read, evaluatedAt: row.evaluated_at, validUntil: row.valid_until, scoreLocked: row.sprint.score_locked, scoreRows,
      inputCounts: {
        people: data.profiles.length, items: data.tasks.length, commitments: data.sprintCommitments.length,
        scores: data.founderSprintScores.length, strikeStates: data.founderStrikeStates.length,
        objections: data.scoreObjections.length, meetings: data.meetings.length, attendance: data.meetingAttendance.length,
      },
    } };
  } catch {
    return { status: "unavailable" };
  }
}
