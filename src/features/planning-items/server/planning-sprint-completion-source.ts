import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SprintCompletionOutcome, SprintCompletionRead, SprintCompletionSource } from "@/features/sprint/model/sprint-completion-read";
import type { SprintLockReceipt } from "@/features/sprint/model/sprint-lock";
import { mapSprint } from "@/lib/planning-row-mappers";
import type { DbFounderStrikeState, DbMeeting, DbMeetingAttendance, DbProfile, DbScoreObjection, DbSprint, DbSprintCommitment, DbTask } from "@/lib/planning-row-types";

export type SprintCompletionAccess = Readonly<{
  userId: string;
  sessionId: string;
  profileId: string;
  deadline: number;
  key: string;
  signal?: AbortSignal;
}>;

type RawCompletionSprint = DbSprint & { project_id: string; lock_result: unknown };
export type SprintCompletionTask = Pick<DbTask, "id" | "parent_task_id" | "title" | "description" | "status" | "priority"
  | "owner" | "assignee" | "workstream" | "sort_order" | "estimate_hours" | "definition_of_done" | "evidence_link" | "issue_number" | "issue_url"
  | "github_issue_number" | "github_issue_url" | "sprint_id" | "review_status" | "score_points" | "score_final" | "task_type" | "approval_status"
  | "score_relevant" | "carryover_count" | "original_sprint_id" | "problem_statement" | "intended_outcome" | "scope_constraints"
  | "acceptance_criteria" | "evidence_required" | "dod_template_version" | "sprint_outcome" | "updated_at"> & { project_id: string };

type RawFoundation = {
  tasks: SprintCompletionTask[];
  accepted_adjustments: Pick<DbScoreObjection, "profile_id" | "resolved_delivery_points" | "resolved_form_points" | "resolved_weekly_points">[];
  blocker_task_ids: string[];
  profiles: Pick<DbProfile, "id" | "name" | "platform_role" | "weekly_capacity">[];
  commitments: DbSprintCommitment[];
  meetings: DbMeeting[];
  attendance: DbMeetingAttendance[];
  strike_states: DbFounderStrikeState[];
};

type RawCompletion = RawFoundation & {
  status: "ready" | "forbidden" | "notFound" | "unavailable";
  source_revision: string;
  evaluated_at: string;
  valid_until: string;
  review_due_at: string | null;
  open_objections: number;
  next_sprint_id: string | null;
  sprint: RawCompletionSprint;
};

type CompletionFence = {
  sprintId: string;
  expectedUpdatedAt: string;
  sourceRevision: string;
  evaluatedAt: string;
  validUntil: string;
  deadline: number;
};

export type PreparedSprintCompletion = {
  read: SprintCompletionRead;
  foundation?: RawFoundation;
  fence?: CompletionFence;
};

const date = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));

function sign(access: SprintCompletionAccess, fence: CompletionFence) {
  return createHmac("sha256", access.key).update(JSON.stringify([
    "sprint-completion-v1", access.userId, access.sessionId, access.profileId, fence,
  ])).digest("hex");
}

function token(access: SprintCompletionAccess, fence: CompletionFence) {
  return Buffer.from(JSON.stringify({ ...fence, signature: sign(access, fence) })).toString("base64url");
}

function originalFence(access: SprintCompletionAccess, value: string, sprintId: string): CompletionFence | null {
  try {
    if (value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const { signature, ...fence } = JSON.parse(Buffer.from(value, "base64url").toString()) as CompletionFence & { signature: string };
    const now = Date.now();
    if (fence.sprintId !== sprintId || !date(fence.expectedUpdatedAt) || !date(fence.evaluatedAt) || !date(fence.validUntil)
      || typeof fence.sourceRevision !== "string" || !fence.sourceRevision || Date.parse(fence.evaluatedAt) > now
      || !Number.isSafeInteger(fence.deadline) || fence.deadline <= now || Date.parse(fence.validUntil) <= now
      || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)
      || !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(sign(access, fence), "hex"))) return null;
    return { ...fence, deadline: Math.min(access.deadline, fence.deadline) };
  } catch {
    return null;
  }
}

function storedReceipt(value: unknown, sprintId: string): SprintLockReceipt | null {
  if (!value || typeof value !== "object") return null;
  const receipt = value as Partial<SprintLockReceipt>;
  return receipt.sprint?.id === sprintId && receipt.sprint.scoreLocked === true && receipt.sprint.status === "closed"
    ? receipt as SprintLockReceipt : null;
}

export async function observePlanningSprintCompletion(
  user: SupabaseClient, access: SprintCompletionAccess, sprintId: string,
): Promise<SprintCompletionOutcome<SprintCompletionSource>> {
  if (access.deadline <= Date.now()) return { status: "forbidden" };
  try {
    const rpc = user.rpc("planning_sprint_completion_publication_context", { p_sprint_id: sprintId });
    const result = await (access.signal ? rpc.abortSignal(access.signal) : rpc);
    if (result.status === 401 || result.status === 403 || access.deadline <= Date.now()) return { status: "forbidden" };
    if (result.error || access.signal?.aborted) return { status: "unavailable" };
    if (result.data?.status === "notFound") return { status: "notFound" };
    if (result.data?.status !== "ready" || typeof result.data.source_revision !== "string" || !result.data.source_revision) {
      return { status: "unavailable" };
    }
    if (result.data.profile_id !== access.profileId || result.data.platform_role !== "ceo") return { status: "forbidden" };
    return { status: "ready", read: {
      sprintId, sourceRevision: result.data.source_revision, readActor: { profileId: access.profileId, platformRole: "ceo" },
      readAuthority: { userId: access.userId, deadline: access.deadline },
    } };
  } catch {
    return { status: "unavailable" };
  }
}

export async function preparePlanningSprintCompletion(
  service: SupabaseClient, originalUser: SupabaseClient, access: SprintCompletionAccess, sprintId: string, displayedToken?: string,
): Promise<SprintCompletionOutcome<PreparedSprintCompletion>> {
  if (access.deadline <= Date.now()) return { status: "forbidden" };
  const displayed = displayedToken === undefined ? undefined : originalFence(access, displayedToken, sprintId);
  if (displayed === null) return { status: "stale" };
  try {
    const rpc = service.rpc("planning_sprint_completion_snapshot", {
      p_sprint_id: sprintId, p_actor_profile_id: access.profileId, p_actor_user_id: access.userId,
      p_session_id: access.sessionId, p_deadline: new Date(access.deadline).toISOString(),
    });
    const result = await (access.signal ? rpc.abortSignal(access.signal) : rpc);
    if (result.status === 401 || result.status === 403 || access.deadline <= Date.now()) return { status: "forbidden" };
    if (result.error || access.signal?.aborted) return { status: "unavailable" };
    const row = result.data as RawCompletion | null;
    if (row?.status === "forbidden" || row?.status === "notFound") return { status: row.status };
    if (row?.status !== "ready" || row.sprint?.id !== sprintId || !date(row.sprint.updated_at)
      || typeof row.sprint.score_locked !== "boolean" || !date(row.evaluated_at) || !date(row.valid_until)
      || typeof row.source_revision !== "string" || !row.source_revision || !Number.isSafeInteger(row.open_objections)
      || row.open_objections < 0 || row.review_due_at !== null && !date(row.review_due_at)
      || row.next_sprint_id !== null && typeof row.next_sprint_id !== "string"
      || !Array.isArray(row.tasks)) return { status: "unavailable" };

    const sprint = mapSprint(row.sprint);
    const receipt = sprint.scoreLocked ? storedReceipt(row.sprint.lock_result, sprintId) : null;
    const ids = new Set(row.tasks.map(task => task.id));
    if (ids.size !== row.tasks.length || row.tasks.some(task => !task.id || typeof task.project_id !== "string" || !task.project_id
      || task.sprint_id !== sprintId || !date(task.updated_at))) {
      return { status: "unavailable" };
    }
    let foundation: RawFoundation | undefined;
    if (!sprint.scoreLocked) {
      if (![row.accepted_adjustments,row.blocker_task_ids,row.profiles,row.commitments,row.meetings,row.attendance,row.strike_states].every(Array.isArray)
        || !row.profiles.some(profile => profile.id === access.profileId)) return { status: "unavailable" };
      const meetingIds = new Set(row.meetings.map(item => item.id));
      if (row.accepted_adjustments.some(adjustment => ![
        adjustment.resolved_delivery_points,adjustment.resolved_form_points,adjustment.resolved_weekly_points,
      ].every(value => typeof value === "number" && Number.isFinite(value)))
        || row.blocker_task_ids.some(id => !ids.has(id)) || row.commitments.some(item => item.sprint_id !== sprintId)
        || row.meetings.some(item => item.sprint_id !== sprintId) || row.attendance.some(item => !meetingIds.has(item.meeting_id))) {
        return { status: "unavailable" };
      }
      foundation = row;
    }

    const observed = await observePlanningSprintCompletion(originalUser, access, sprintId);
    if (observed.status !== "ready") return observed.status === "notFound" ? { status: "stale" } : observed;
    const now = Date.now();
    if (observed.read.sourceRevision !== row.source_revision || Date.parse(row.valid_until) <= now) return { status: "stale" };
    if (displayed && !sprint.scoreLocked && (displayed.sourceRevision !== row.source_revision || displayed.expectedUpdatedAt !== sprint.updatedAt
      || Math.min(displayed.deadline, Date.parse(displayed.validUntil)) <= now)) return { status: "stale" };
    const blocked = sprint.scoreLocked ? "alreadyLocked" : row.open_objections > 0 ? "objections"
      : !sprint.endDate || !row.review_due_at ? "invalidSchedule"
        : Date.parse(row.review_due_at) > now ? "reviewWindow" : null;
    const currentFence = {
      sprintId, expectedUpdatedAt: row.sprint.updated_at, sourceRevision: row.source_revision,
      evaluatedAt: row.evaluated_at, validUntil: row.valid_until, deadline: access.deadline,
    };
    return { status: "ready", read: { foundation, fence: blocked ? undefined : displayed ?? currentFence, read: {
      ...observed.read, evaluatedAt: row.evaluated_at, validUntil: row.valid_until,
      basis: { sprint, tasks: row.tasks.map(task => ({ id: task.id, title: task.title, updatedAt: task.updated_at })) },
      tasksComplete: !sprint.scoreLocked, receipt, reviewDueAt: row.review_due_at, openObjections: row.open_objections,
      nextSprintId: row.next_sprint_id,
      decision: blocked ? { status: "blocked", reason: blocked } : { status: "ready", token: token(access, currentFence) },
    } } };
  } catch {
    return { status: "unavailable" };
  }
}
