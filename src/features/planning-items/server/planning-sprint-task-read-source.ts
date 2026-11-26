import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SprintJointSelectedOutcome, SprintScopedQuery, SprintScopedResult, SprintSelectedProjectionResult } from "@/features/sprint/model/sprint-scoped-read";
import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import { mapFounderSprintScore, mapFounderStrikeState, mapMeeting, mapMeetingAttendance, mapScoreObjection, mapSprint, mapSprintCommitment, mapStrikeEvent } from "@/lib/planning-row-mappers";
import type { DbFounderSprintScore, DbFounderStrikeState, DbMeeting, DbMeetingAttendance, DbProfile, DbScoreObjection, DbSprint, DbSprintCommitment, DbStrikeEvent, DbTask, DbTaskLink, DbPlanningItemStrategy, DbPlanningItemRaciAssignment } from "@/lib/planning-row-types";
import { mapProfile } from "@/lib/planning-profile-mappers";
import type { PlatformRole } from "@/lib/types";
import type { PlanningWorkspaceLoadContext } from "../model/planning-workspace-model";
import { mapPlanningItemRows, mapPlanningProject, planningProjectId } from "./planning-workspace-read-source";

const pageLimit = 20;
type Cursor = { offset: number; source: string; evaluatedAt: string; validUntil: string; deadline: number };
type RawItem = DbTask & { links: DbTaskLink[]; strategy: DbPlanningItemStrategy | null; assignments: DbPlanningItemRaciAssignment[] };
type RawModel = {
  project: Parameters<typeof mapPlanningProject>[0]; sprints: DbSprint[]; commitments: DbSprintCommitment[];
  scores: DbFounderSprintScore[]; strike_states: DbFounderStrikeState[]; strike_events: DbStrikeEvent[];
  objections: DbScoreObjection[]; meetings: DbMeeting[]; attendance: DbMeetingAttendance[];
};
type RawSelection = {
  status: string; sprint_id: string | null; source_revision: string; evaluated_at: string; valid_until: string;
  scope_total: number; matched_total: number; unassigned_total: number | null; sprint_counts: Record<string, number> | null;
  assignment_targets: Record<string, string[]>;
  member_ids: string[]; page_ids: string[]; rows: RawItem[]; profiles: DbProfile[]; model: RawModel | null;
};
type Access = {
  userId: string; sessionId: string; profileId: string; role: PlatformRole; deadline: number;
  key: string; publication: NonNullable<PlanningWorkspaceLoadContext["publicationSource"]>; signal?: AbortSignal;
};

const date = (value: string) => typeof value === "string" && Number.isFinite(Date.parse(value));
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === "string" && id !== "") && new Set(value).size === value.length;
function signature(key: string, query: SprintScopedQuery, cursor: Cursor) {
  return createHmac("sha256", key).update(JSON.stringify(["sprint-collection-v1", query.scope, query.sprintId, query.filters, cursor])).digest("hex");
}
function decode(access: Access, query: SprintScopedQuery) {
  if (!query.continuation) return undefined;
  const { token, ...cursor } = JSON.parse(Buffer.from(query.continuation, "base64url").toString()) as Cursor & { token: string };
  if (!count(cursor.offset) || cursor.offset <= 0 || !cursor.source || !date(cursor.evaluatedAt) || !date(cursor.validUntil)
    || !Number.isFinite(cursor.deadline) || cursor.deadline <= Date.now() || Date.parse(cursor.validUntil) <= Date.now()
    || !/^[a-f0-9]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(signature(access.key, query, cursor), "hex"))) throw new Error("Invalid Sprint continuation");
  return cursor;
}

type SelectionBasis = { sprintId: string; scopeTotal: number; sourceRevision: string; evaluatedAt: string; validUntil: string; deadline: number };

function selectionBasisSignature(access: Access, basis: SelectionBasis) {
  return createHmac("sha256", access.key).update(JSON.stringify(["sprint-selected-membership-v1", access.userId, access.sessionId, access.profileId, access.role, basis])).digest("hex");
}

function encodeSelectionBasis(access: Access, basis: SelectionBasis) {
  return Buffer.from(JSON.stringify({ ...basis, token: selectionBasisSignature(access, basis) })).toString("base64url");
}

function decodeSelectionBasis(access: Access, encoded: string, sprintId: string): SelectionBasis | undefined {
  try {
    if (encoded.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return;
    const { token, ...basis } = JSON.parse(Buffer.from(encoded, "base64url").toString()) as SelectionBasis & { token: string };
    if (basis.sprintId !== sprintId || !count(basis.scopeTotal) || typeof basis.sourceRevision !== "string" || !basis.sourceRevision
      || !date(basis.evaluatedAt) || !date(basis.validUntil) || Date.parse(basis.evaluatedAt) > Date.now()
      || !Number.isSafeInteger(basis.deadline) || basis.deadline <= Date.now() || Date.parse(basis.validUntil) <= Date.now()
      || typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)
      || !timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(selectionBasisSignature(access, basis), "hex"))) return;
    return basis;
  } catch { return; }
}

type RawMatches = Pick<RawSelection, "status" | "sprint_id" | "scope_total" | "source_revision" | "evaluated_at" | "valid_until" | "matched_total" | "page_ids">;

function selectedMatches(row: RawMatches | undefined, basis: SelectionBasis, access: Access): SprintSelectedProjectionResult {
  const deadline = Math.min(access.deadline, basis.deadline);
  if (Math.min(deadline, Date.parse(basis.validUntil)) <= Date.now() || row?.status === "staleContinuation" || row?.status === "notFound") return { status: "staleSelectionBasis" };
  if (row?.status === "forbidden") return { status: "forbidden" };
  if (row?.status !== "ready" || row.sprint_id !== basis.sprintId || row.scope_total !== basis.scopeTotal
    || row.source_revision !== basis.sourceRevision || row.evaluated_at !== basis.evaluatedAt || row.valid_until !== basis.validUntil
    || !count(row.matched_total) || row.matched_total > row.scope_total || !ids(row.page_ids) || row.page_ids.length !== row.matched_total) return { status: "unavailable" };
  return { status: "ready", read: { projection: "matches", sprintId: basis.sprintId,
    matchedIds: row.page_ids, matchedTotal: row.matched_total, scopeTotal: basis.scopeTotal,
    sourceRevision: basis.sourceRevision, evaluatedAt: basis.evaluatedAt, validUntil: basis.validUntil,
    readAuthority: { userId: access.userId, deadline }, readActor: { profileId: access.profileId, platformRole: access.role } } };
}

export async function loadPlanningSprintSelectedProjection(supabase: SupabaseClient, access: Access, query: SprintScopedQuery, encoded: string): Promise<SprintSelectedProjectionResult> {
  if (query.scope !== "selected" || !query.sprintId || query.continuation) return { status: "staleSelectionBasis" };
  if (access.deadline <= Date.now()) return { status: "forbidden" };
  const basis = decodeSelectionBasis(access, encoded, query.sprintId);
  if (!basis) return { status: "staleSelectionBasis" };
  const deadline = Math.min(access.deadline, basis.deadline);
  const cutoff = Math.min(deadline, Date.parse(basis.validUntil));
  const originalExpiry = AbortSignal.timeout(Math.max(0, Math.ceil(cutoff - Date.now())));
  const signal = access.signal ? AbortSignal.any([access.signal, originalExpiry]) : originalExpiry;
  try {
    const result = await supabase.rpc("planning_sprint_selected_matches", {
      p_actor_profile_id: access.profileId, p_actor_user_id: access.userId, p_session_id: access.sessionId, p_platform_role: access.role,
      p_deadline: new Date(deadline).toISOString(), p_sprint_id: query.sprintId, p_filters: query.filters,
      p_source_revision: basis.sourceRevision, p_evaluated_at: basis.evaluatedAt,
    }).abortSignal(signal);
    if (access.deadline <= Date.now() || result.status === 401 || result.status === 403) return { status: "forbidden" };
    if (cutoff <= Date.now()) return { status: "staleSelectionBasis" };
    if (signal.aborted || result.error) return { status: "unavailable" };
    const selected = selectedMatches(result.data, basis, access);
    if (selected.status !== "ready") return selected;
    const latest = await access.publication.read(signal);
    if (access.deadline <= Date.now() || latest.status === "forbidden") return { status: "forbidden" };
    if (cutoff <= Date.now()) return { status: "staleSelectionBasis" };
    if (signal.aborted || latest.status !== "ready") return { status: "unavailable" };
    if (latest.revision !== basis.sourceRevision) return { status: "staleSelectionBasis" };
    return selected;
  } catch { return { status: "unavailable" }; }
}

export async function loadPlanningSprintTaskScope(supabase: SupabaseClient, access: Access, query: SprintScopedQuery, selectionBasis?: string): Promise<SprintScopedResult> {
  if (selectionBasis !== undefined && (query.scope !== "assignment" || !query.sprintId || query.continuation)) return { status: "unavailable" };
  const basis = selectionBasis && query.sprintId ? decodeSelectionBasis(access, selectionBasis, query.sprintId) : undefined;
  let cursor: Cursor | undefined;
  try { cursor = decode(access, query); } catch { return { status: "staleContinuation" }; }
  const deadline = Math.min(access.deadline, cursor?.deadline ?? Infinity);
  const { signal } = access;
  if (deadline <= Date.now()) return { status: "forbidden" };
  try {
    const read = basis ? supabase.rpc("planning_sprint_assignment_and_selected_matches", {
      p_actor_profile_id: access.profileId, p_actor_user_id: access.userId, p_session_id: access.sessionId, p_platform_role: access.role,
      p_deadline: new Date(deadline).toISOString(), p_sprint_id: query.sprintId, p_filters: query.filters,
      p_selected_revision: basis.sourceRevision, p_selected_evaluated_at: basis.evaluatedAt, p_selected_valid_until: basis.validUntil,
      p_selected_deadline: new Date(basis.deadline).toISOString(),
    }) : supabase.rpc("planning_sprint_task_scope", {
      p_actor_profile_id: access.profileId, p_actor_user_id: access.userId, p_session_id: access.sessionId, p_platform_role: access.role,
      p_deadline: new Date(deadline).toISOString(), p_scope: query.scope, p_sprint_id: query.sprintId, p_filters: query.filters,
      p_offset: cursor?.offset ?? 0, p_source_revision: cursor?.source ?? null, p_evaluated_at: cursor?.evaluatedAt ?? null,
    });
    const result = await (signal ? read.abortSignal(signal) : read);
    if (deadline <= Date.now()) return { status: "forbidden" };
    if (signal?.aborted) return { status: "unavailable" };
    if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
    const raw: RawSelection = basis ? result.data?.assignment : result.data;
    if (basis && result.data?.selected?.status === "forbidden") return { status: "forbidden" };
    if (raw?.status === "forbidden" || raw?.status === "notFound" || raw?.status === "staleContinuation") return { status: raw.status };
    const isSelected = query.scope === "selected";
    const offset = cursor?.offset ?? 0;
    if (raw?.status !== "ready" || !raw.source_revision || !date(raw.evaluated_at) || !date(raw.valid_until)
      || raw.sprint_id !== (query.sprintId || raw.sprint_id) || raw.sprint_id !== null && typeof raw.sprint_id !== "string"
      || !count(raw.scope_total) || !count(raw.matched_total) || raw.matched_total > raw.scope_total
      || !ids(raw.member_ids) || !ids(raw.page_ids) || !Array.isArray(raw.rows) || !Array.isArray(raw.profiles)
      || raw.page_ids.length !== (isSelected ? raw.matched_total : Math.min(pageLimit, Math.max(0, raw.matched_total - offset)))
      || raw.member_ids.length !== (isSelected ? raw.scope_total : 0)
      || !raw.assignment_targets || Object.entries(raw.assignment_targets).some(([id, targets]) => !raw.page_ids.includes(id) || !ids(targets))) return { status: "unavailable" };
    if (cursor && (cursor.source !== raw.source_revision || cursor.evaluatedAt !== raw.evaluated_at || cursor.validUntil !== raw.valid_until)) return { status: "staleContinuation" };
    const members = isSelected ? raw.member_ids : raw.page_ids;
    const memberIds = new Set(members);
    if (raw.page_ids.some(id => !memberIds.has(id))) return { status: "unavailable" };
    const people = raw.profiles.map(mapProfile);
    const tasks = mapPlanningItemRows(raw.rows, people, raw.rows.flatMap(row => row.links), raw.rows.flatMap(row => row.strategy ? [row.strategy] : []), raw.rows.flatMap(row => row.assignments));
    const byId = new Map(tasks.map(task => [task.id, task]));
    if (byId.size !== tasks.length || members.some(id => !byId.has(id) || isSelected && byId.get(id)!.sprintId !== raw.sprint_id
      || !isSelected && byId.get(id)!.sprintId === raw.sprint_id)) return { status: "unavailable" };
    let model: SprintWorkspaceModel | undefined;
    if (isSelected) {
      const body = raw.model;
      if (body?.project?.id !== planningProjectId || !Array.isArray(body.sprints) || !Array.isArray(body.commitments)
        || !Array.isArray(body.scores) || !Array.isArray(body.strike_states) || !Array.isArray(body.strike_events)
        || !Array.isArray(body.objections) || !Array.isArray(body.meetings) || !Array.isArray(body.attendance)
        || !count(raw.unassigned_total) || !raw.sprint_counts || Object.values(raw.sprint_counts).some(total => !count(total))) return { status: "unavailable" };
      model = { revision: raw.source_revision, project: mapPlanningProject(body.project), people, items: members.map(id => byId.get(id)!),
        coverage: { project: "complete", people: "complete", sprints: "complete", items: "partial", commitments: "partial",
          scores: "partial", strikeStates: "complete", strikeEvents: "partial", objections: "partial", meetings: "partial", attendance: "partial" },
        sprints: body.sprints.map(mapSprint), commitments: body.commitments.map(mapSprintCommitment), scores: body.scores.map(mapFounderSprintScore),
        strikeStates: body.strike_states.map(mapFounderStrikeState), strikeEvents: body.strike_events.map(mapStrikeEvent),
        objections: body.objections.map(mapScoreObjection), meetings: body.meetings.map(mapMeeting), attendance: body.attendance.map(mapMeetingAttendance) };
    }
    const publication = await access.publication.read(signal);
    if (deadline <= Date.now()) return { status: "forbidden" };
    if (signal?.aborted) return { status: "unavailable" };
    if (publication.status !== "ready") return { status: publication.status };
    if (publication.revision !== raw.source_revision || Date.parse(raw.valid_until) <= Date.now()) return { status: "staleContinuation" };
    const next = { offset: offset + raw.page_ids.length, source: raw.source_revision, evaluatedAt: raw.evaluated_at, validUntil: raw.valid_until, deadline };
    const continuation = !isSelected && next.offset < raw.matched_total
      ? Buffer.from(JSON.stringify({ ...next, token: signature(access.key, query, next) })).toString("base64url") : null;
    let selected: SprintJointSelectedOutcome | undefined;
    if (selectionBasis !== undefined) {
      const projection = basis ? selectedMatches(result.data?.selected, basis, access) : { status: "staleSelectionBasis" as const };
      if (projection.status === "forbidden") return { status: "forbidden" };
      if (projection.status === "ready") {
        selected = projection.read.sourceRevision === raw.source_revision && projection.read.evaluatedAt === raw.evaluated_at
          && projection.read.validUntil === raw.valid_until ? projection : { status: "staleSelectionBasis" };
      } else selected = { status: projection.status };
    }
    const signedBasis = isSelected && raw.sprint_id ? encodeSelectionBasis(access, { sprintId: raw.sprint_id, scopeTotal: raw.scope_total,
      sourceRevision: raw.source_revision, evaluatedAt: raw.evaluated_at, validUntil: raw.valid_until, deadline }) : undefined;
    return { status: "ready", ...(model ? { model } : {}), ...(signedBasis ? { selectionBasis: signedBasis } : {}), ...(selected ? { selected } : {}),
      readAuthority: { userId: access.userId, deadline },
      readActor: { profileId: access.profileId, platformRole: access.role }, page: {
        scope: query.scope, sprintId: raw.sprint_id, items: raw.page_ids.map(id => byId.get(id)!),
        context: tasks.filter(task => !memberIds.has(task.id)), scopeTotal: raw.scope_total, matchedTotal: raw.matched_total,
        unassignedTotal: raw.unassigned_total, sprintTaskCounts: raw.sprint_counts, assignmentTargetsByItemId: raw.assignment_targets,
        evaluatedAt: raw.evaluated_at, validUntil: raw.valid_until, sourceRevision: raw.source_revision, continuation,
      } };
  } catch { return { status: "unavailable" }; }
}
