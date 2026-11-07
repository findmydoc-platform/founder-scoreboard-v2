import "server-only";

import { observeRuntimePhase, observeRuntimePreparation } from "@/lib/runtime-logging";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningWorkspaceLoadContext, PlanningWorkspaceLoadResult } from "@/features/planning-items/model/planning-workspace-model";
import { mapTaskBlocker } from "@/lib/planning-activity-mappers";
import { mapTaskRelation } from "@/lib/planning-row-mappers";
import type {
  DbPlanningItemRaciAssignment,
  DbPlanningItemStrategy,
  DbProfile,
  DbProfileUiPreference,
  DbSprint,
  DbTask,
  DbTaskLink,
  DbTaskRelation,
  DbTaskBlocker,
} from "@/lib/planning-row-types";
import { taskRowColumns, taskRowSelect } from "@/lib/planning-row-types";
import { mapProfile, mapProfileUiPreference } from "@/lib/planning-profile-mappers";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { mapSprint } from "@/lib/planning-sprint-mappers";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import { DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS } from "@/lib/sprint-review-window";
import type { Profile, Project } from "@/lib/types";
import { projectPlanningBoard } from "@/features/planning/server/planning-board-projection";
import { withWorkspaceProfileAvatars } from "./workspace-profile-avatars";

export const planningProjectId = "findmydoc-founder-execution";
export const planningProfileSelect = "id,name,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity,profile_color";

type ProjectRow = {
  id: string;
  name: string;
  range_label: string | null;
  review_objection_window_hours: number | null;
};

export function mapPlanningProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    range: row.range_label || "",
    reviewObjectionWindowHours: Number(row.review_objection_window_hours || DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS),
    githubProjectOwner: "",
    githubProjectNumber: 0,
  };
}

export function mapPlanningItemRows(rows: DbTask[], people: Profile[], links: DbTaskLink[], strategies: DbPlanningItemStrategy[], assignments: DbPlanningItemRaciAssignment[]) {
  const linksById = new Map<string, DbTaskLink[]>();
  for (const link of links) linksById.set(link.task_id, [...(linksById.get(link.task_id) || []), link]);
  const strategyById = new Map(strategies.map((strategy) => [strategy.task_id, strategy]));
  const assignmentsById = new Map<string, DbPlanningItemRaciAssignment[]>();
  for (const assignment of assignments) assignmentsById.set(assignment.task_id, [...(assignmentsById.get(assignment.task_id) || []), assignment]);
  const items = rows.map((row) => mapTaskRow(row, people, {
    taskLinks: linksById.get(row.id) || [],
    strategy: strategyById.get(row.id),
    raciAssignments: assignmentsById.get(row.id) || [],
  }));
  const approvalById = new Map(items.map((item) => [item.id, item.approvalStatus]));
  return items.map((item) => item.parentTaskId ? { ...item, parentApprovalStatus: approvalById.get(item.parentTaskId) || null } : item);
}

// Description, DoD, AC, dependencies and strategy remain in the summary because
// Planning uses them for search, structure and attention signals. Problem
// statement stays in the DB projection for legacy Sub-Issue description fallback.
const planningSummarySelect = `${taskRowColumns.filter((column) => ![
  "intended_outcome", "scope_constraints", "evidence_required",
].includes(column)).join(",")}, task_dependencies(note)`;

export function mapPlanningSummaryRows(...args: Parameters<typeof mapPlanningItemRows>) {
  return mapPlanningItemRows(...args).map((item) => ({
    ...item,
    problemStatement: "",
    intendedOutcome: "",
    scopeConstraints: "",
    evidenceRequired: "",
    note: "",
    detailAvailability: "summary" as const,
  }));
}

export async function loadPlanningItemsForReadModel(supabase: SupabaseClient) {
  const [profileResult, itemResult, strategyResult, raciResult, linkResult] = await Promise.all([
    supabase.from("profiles").select(planningProfileSelect, { count: "exact" }).order("name"),
    supabase.from(ACTIVE_TASKS_TABLE).select(taskRowSelect, { count: "exact" }).eq("project_id", planningProjectId).order("sort_order").order("id"),
    supabase.from("planning_item_strategy").select("task_id,goal,success_criteria,scope_constraints", { count: "exact" }),
    supabase.from("planning_item_raci_assignments").select("task_id,profile_id,role,sort_order", { count: "exact" }).order("task_id").order("sort_order"),
    supabase.from("task_links").select("id,task_id,type,label,url,position,metadata", { count: "exact" }).order("position").order("id"),
  ]);
  if (profileResult.error || itemResult.error || strategyResult.error || raciResult.error || linkResult.error) return null;
  const people = ((profileResult.data || []) as DbProfile[]).map(mapProfile);
  const complete = (result: { data: unknown[] | null; count: number | null }) => typeof result.count === "number" && (result.data?.length || 0) >= result.count ? "complete" as const : "partial" as const;
  return {
    readCoverage: { people: complete(profileResult), items: complete(itemResult), strategies: complete(strategyResult), raci: complete(raciResult), links: complete(linkResult) },
    people,
    items: mapPlanningItemRows(
      (itemResult.data || []) as unknown as DbTask[],
      people,
      (linkResult.data || []) as DbTaskLink[],
      (strategyResult.data || []) as DbPlanningItemStrategy[],
      (raciResult.data || []) as DbPlanningItemRaciAssignment[],
    ),
  };
}

// Advance by received rows, not requested rows: PostgREST may clamp each range.
async function countedRows<T>(query: () => PromiseLike<{ data: T[] | null; count: number | null; error: unknown }> & { range(from: number, to: number): PromiseLike<{ data: T[] | null; count: number | null; error: unknown }> }) {
  const first = await query();
  if (first.error || first.count === null) return first;
  const rows = [...(first.data || [])];
  while (rows.length < first.count) {
    const next = await query().range(rows.length, rows.length + 999);
    if (next.error) return { ...next, data: rows };
    if (!next.data?.length || next.count !== first.count) return { data: rows, count: first.count, error: new Error("Planning coverage changed during enumeration.") };
    rows.push(...next.data);
  }
  return { ...first, data: rows };
}

export async function loadPlanningWorkspaceModel(
  supabase: SupabaseClient,
  context: PlanningWorkspaceLoadContext,
): Promise<PlanningWorkspaceLoadResult> {
  if (!context.authorized) return { status: "forbidden" };
  const completeRead = <T>(query: () => PromiseLike<{ data: T[] | null; count: number | null; error: unknown }> & { range(from: number, to: number): PromiseLike<{ data: T[] | null; count: number | null; error: unknown }> }) => context.query ? countedRows(query) : Promise.resolve(query());
  let baseReadFailed = false;
  const trackRead = <T extends { error: unknown }>(read: Promise<T>, missingData?: (result: T) => boolean): Promise<T> => read.then(
    (result) => {
      if (result.error || missingData?.(result)) baseReadFailed = true;
      return result;
    },
    (error: unknown) => {
      baseReadFailed = true;
      throw error;
    },
  );
  const projectRead = trackRead(observeRuntimePhase("board.project", () => supabase.from("projects").select("id,name,range_label,review_objection_window_hours").eq("id", planningProjectId).single<ProjectRow>()), (result) => !result.data);
  const profileRead = trackRead(observeRuntimePhase("board.profiles", () => completeRead(() => supabase.from("profiles").select(planningProfileSelect, { count: "exact" }).order("name").order("id"))));
  type AvatarOutcome = { people: Profile[] } | { error: unknown };
  let avatarWork: Promise<AvatarOutcome> | undefined;
  const avatarStart = profileRead.then((result) => {
    if (baseReadFailed || !result.data?.length) return;
    avatarWork = observeRuntimePhase("board.avatars", () => withWorkspaceProfileAvatars((result.data as DbProfile[]).map(mapProfile), supabase)).then(
      (people): AvatarOutcome => ({ people }),
      (error: unknown): AvatarOutcome => ({ error }),
    );
  }, () => undefined);
  const baseReads = Promise.all([
    projectRead,
    profileRead,
    trackRead(observeRuntimePhase("board.items", () => completeRead(() => supabase.from(ACTIVE_TASKS_TABLE).select(planningSummarySelect, { count: "exact" }).eq("project_id", planningProjectId).order("sort_order").order("id")))),
    trackRead(observeRuntimePhase("board.strategy", () => completeRead(() => supabase.from("planning_item_strategy").select("task_id,goal,success_criteria,scope_constraints", { count: "exact" }).order("task_id")))),
    trackRead(observeRuntimePhase("board.raci", () => completeRead(() => supabase.from("planning_item_raci_assignments").select("task_id,profile_id,role,sort_order", { count: "exact" }).order("task_id").order("sort_order").order("profile_id").order("role")))),
    trackRead(observeRuntimePhase("board.links", () => completeRead(() => supabase.from("task_links").select("id,task_id,type,label,url,position,metadata", { count: "exact" }).order("position").order("id")))),
    trackRead(observeRuntimePhase("board.sprints", () => completeRead(() => supabase.from("sprints").select("id,name,status,start_date,end_date,review_due_at,score_locked,updated_at", { count: "exact" }).order("start_date").order("id")))),
    trackRead(observeRuntimePhase("board.relationships", () => completeRead(() => { const query = supabase.from("task_relationship_edges").select("id,task_id,related_task_id,relation_type,note,created_by,created_at", { count: "exact" }).order("created_at", { ascending: false }).order("id"); return context.query ? query : query.limit(500); }))),
    trackRead(observeRuntimePhase("board.preferences", () => completeRead(() => supabase.from("profile_ui_preferences").select("profile_id,default_workspace,default_task_view,planning_filters,expanded_item_ids,created_at,updated_at", { count: "exact" }).order("profile_id")))),
    context.query ? trackRead(completeRead(() => supabase.from("task_blockers").select("id,task_id,profile_id,reason,impact,needs_help_from,status,created_at,resolved_at", { count: "exact" }).order("id"))) : Promise.resolve({ data: [], error: null, count: 0 }),
  ]);
  const [projectResult, profileResult, itemResult, strategyResult, raciResult, linkResult, sprintResult, relationResult, preferenceResult, blockerResult] = await baseReads.catch(async (error: unknown) => {
    // A failed base read owns the result, but started avatar dispatch must finish cleanup.
    if (avatarWork) await avatarWork;
    throw error;
  });
  await avatarStart;
  const avatars = avatarWork ? await avatarWork : { people: [] };
  if (projectResult.error || !projectResult.data || profileResult.error || itemResult.error || strategyResult.error || raciResult.error || linkResult.error || sprintResult.error || relationResult.error || preferenceResult.error || blockerResult.error) {
    return { status: "unavailable" };
  }
  if ("error" in avatars) throw avatars.error;
  const people = avatars.people;
  const complete = (result: { data: unknown[] | null; count: number | null }) => typeof result.count === "number" && (result.data?.length || 0) >= result.count ? "complete" as const : "partial" as const;
  return observeRuntimePreparation(() => {
    const items = mapPlanningSummaryRows(
      (itemResult.data || []) as unknown as DbTask[],
      people,
      (linkResult.data || []) as DbTaskLink[],
      (strategyResult.data || []) as DbPlanningItemStrategy[],
      (raciResult.data || []) as DbPlanningItemRaciAssignment[],
    );
    const activeIds = new Set(items.map((item) => item.id));
    const model = {
        revision: items.reduce((latest, item) => item.updatedAt && item.updatedAt > latest ? item.updatedAt : latest, ""),
        coverage: { items: complete(itemResult), people: complete(profileResult), strategies: complete(strategyResult), raci: complete(raciResult), links: complete(linkResult), sprints: complete(sprintResult), relationships: complete(itemResult) === "complete" ? complete(relationResult) : "partial", preferences: complete(preferenceResult), ...(context.query ? { blockers: complete(blockerResult) } : {}) },
        project: mapPlanningProject(projectResult.data),
        items,
        ...(context.query ? { blockers: ((blockerResult.data || []) as DbTaskBlocker[]).filter(row => activeIds.has(row.task_id)).map(mapTaskBlocker) } : {}),
        relationships: ((relationResult.data || []) as DbTaskRelation[])
          .filter((relation) => activeIds.has(relation.task_id) && activeIds.has(relation.related_task_id))
          .map(mapTaskRelation),
        people,
        sprints: ((sprintResult.data || []) as DbSprint[]).map(mapSprint),
        preferences: ((preferenceResult.data || []) as DbProfileUiPreference[]).map(mapProfileUiPreference),
    };
    return context.query ? projectPlanningBoard(model, context) : { status: "ready" as const, model };
  }, "board.map");
}
