import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "@/features/planning/model/planning-board-query";
import { loadPlanningWorkspaceModel, mapPlanningItemRows, mapPlanningProject } from "./planning-workspace-read-source";
import { compactPlanningCard, planningCardOmittedFields } from "./planning-card-summary";
import { withWorkspaceProfileAvatars } from "./workspace-profile-avatars";
import { mapProfile, mapProfileUiPreference } from "@/lib/planning-profile-mappers";
import { mapSprint } from "@/lib/planning-sprint-mappers";
import { mapTaskRelation } from "@/lib/planning-row-mappers";
import type { DbProfile, DbProfileUiPreference, DbSprint, DbTask, DbTaskRelation } from "@/lib/planning-row-types";
import { taskStatuses } from "@/lib/status";
import type { Task, TaskStatus } from "@/lib/types";
import type { PlanningWorkspaceLoadContext, PlanningWorkspaceLoadResult } from "../model/planning-workspace-model";
import { observeRuntimePhase } from "@/lib/runtime-logging";

type Selection = {
  status: "ready" | "forbidden" | "staleContinuation";
  source_revision: string; evaluated_at: string; temporal_key: string; valid_until: string | null;
  project: Parameters<typeof mapPlanningProject>[0]; rows: DbTask[]; card_ids: string[]; context_ids: string[];
  profiles: DbProfile[]; sprints: DbSprint[]; preferences: DbProfileUiPreference[]; relationships: DbTaskRelation[];
  columns: Record<TaskStatus, { total: number }>;
  metrics: { total: number; open: number; done: number; blocked: number };
  level_totals: { epic: number; initiative: number; deliverable: number };
  personal_children: Record<string, string[]>;
  workstreams: string[]; initiative_options: Array<{ id: string; title: string }>;
  workspace_revision: { activeTaskCount: number; latestUpdatedAt: string };
};
type Cursor = { offset: number; source: string; evaluatedAt: string; temporalKey: string; validUntil: string | null; binding: string };
const statuses: TaskStatus[] = [...taskStatuses, "Pausiert"];
const selectedOmittedFields: readonly (keyof Task)[] = [...planningCardOmittedFields, "dependsOn", "evidenceLink"];

export async function loadPlanningDeliverableBoard(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext): Promise<PlanningWorkspaceLoadResult> {
  if (!context.authorized) return { status: "forbidden" };
  const input = context.query || {};
  let query = normalizePlanningBoardQuery(input);
  let preferenceRevision: string | undefined;
  if (!input.continuation && (!input.filters || !input.view)) {
    const versionRead = supabase.rpc("planning_source_version");
    const version = await (context.signal ? versionRead.abortSignal(context.signal) : versionRead);
    if (version.error || typeof version.data !== "string") return { status: "unavailable" };
    preferenceRevision = version.data;
    const preferenceRead = supabase.from("profile_ui_preferences").select("profile_id,default_workspace,default_task_view,planning_filters,expanded_item_ids,created_at,updated_at").eq("profile_id", context.actorProfileId || "");
    const preferenceResult = await (context.signal ? preferenceRead.abortSignal(context.signal) : preferenceRead).maybeSingle();
    if (preferenceResult.error) return { status: "unavailable" };
    const preference = preferenceResult.data ? mapProfileUiPreference(preferenceResult.data as DbProfileUiPreference) : undefined;
    const filters = preference && { ...preference.planningFilters, ...(preference.defaultWorkspace === "mine" ? { assignee: "Alle", quick: [...preference.planningFilters.quick, "mine"] } : {}) };
    query = normalizePlanningBoardQuery({ ...input, view: input.view || (preference?.defaultTaskView && preference.defaultTaskView !== "board" ? "complete" : "board"), filters: input.filters || filters });
    if (query.view === "complete") {
      const complete = await loadPlanningWorkspaceModel(supabase, { ...context, query });
      return complete.status === "ready" && complete.model.scopeRevision !== preferenceRevision ? { status: "unavailable" } : complete;
    }
  }
  const queryKey = planningBoardQueryKey(query);
  const column = input.column || (input.continuation ? "Erledigt" : query.filters.status !== "Alle" && statuses.includes(query.filters.status as TaskStatus) ? query.filters.status as TaskStatus : "Offen");
  if (!statuses.includes(column)) return { status: "staleContinuation" };
  const sign = (cursor: Omit<Cursor, "binding">) => createHmac("sha256", context.authorityKey || context.actorProfileId || "local-planning")
    .update(JSON.stringify([context.actorProfileId, queryKey, column, query.ordering, cursor])).digest("hex");
  let cursor: Cursor | undefined;
  if (input.continuation) {
    try {
      const parsed = JSON.parse(Buffer.from(input.continuation, "base64url").toString("utf8"));
      const { binding, ...basis } = parsed;
      if (!Number.isSafeInteger(basis.offset) || basis.offset < 1 || typeof basis.source !== "string" || typeof basis.temporalKey !== "string"
        || !Number.isFinite(Date.parse(basis.evaluatedAt)) || !(basis.validUntil === null || typeof basis.validUntil === "string" && Date.parse(basis.validUntil) > Date.now())
        || typeof binding !== "string" || !/^[a-f0-9]{64}$/.test(binding) || !timingSafeEqual(Buffer.from(binding, "hex"), Buffer.from(sign(basis), "hex"))) return { status: "staleContinuation" };
      cursor = parsed;
    } catch { return { status: "staleContinuation" }; }
  }
  const read = supabase.rpc("planning_deliverable_selection", {
    p_actor_profile_id: context.actorProfileId, p_query: query, p_column: column, p_offset: cursor?.offset || 0,
    p_limit: Math.min(20, Math.max(1, Math.trunc(Number(input.limit) || 20))), p_source_revision: cursor?.source || null, p_evaluated_at: cursor?.evaluatedAt || null,
  });
  const result = await observeRuntimePhase("board.selection", () => context.signal ? read.abortSignal(context.signal) : read);
  if (result.error || !result.data) return { status: "unavailable" };
  const selected = result.data as Selection;
  if (selected.status === "forbidden" || selected.status === "staleContinuation") return { status: selected.status };
  if (selected.status !== "ready" || !selected.project?.id || typeof selected.source_revision !== "string" || !Array.isArray(selected.rows) || !Array.isArray(selected.card_ids)
    || !Number.isFinite(Date.parse(selected.evaluated_at)) || typeof selected.temporal_key !== "string"
    || !(selected.valid_until === null || typeof selected.valid_until === "string" && Number.isFinite(Date.parse(selected.valid_until)))
    || !Array.isArray(selected.workstreams) || selected.workstreams.some(value => typeof value !== "string")
    || !Array.isArray(selected.initiative_options) || selected.initiative_options.some(value => !value || typeof value.id !== "string" || typeof value.title !== "string")
    || !selected.columns || !selected.metrics) return { status: "unavailable" };
  if (cursor && (cursor.source !== selected.source_revision || cursor.temporalKey !== selected.temporal_key)) return { status: "staleContinuation" };
  if (preferenceRevision && preferenceRevision !== selected.source_revision) return { status: "unavailable" };
  const people = await withWorkspaceProfileAvatars(selected.profiles.map(mapProfile), supabase, context.signal);
  // The SQL statement covers selection and hydration. Avatar identity is a
  // separate read, so retain a matching source fence across that supporting work.
  const fenceRead = supabase.rpc("planning_source_version");
  const fence = await (context.signal ? fenceRead.abortSignal(context.signal) : fenceRead);
  if (fence.error || typeof fence.data !== "string") return { status: "unavailable" };
  if (fence.data !== selected.source_revision || selected.valid_until && Date.parse(selected.valid_until) <= Date.now()) return { status: cursor ? "staleContinuation" : "unavailable" };
  const revision = createHash("sha256").update(JSON.stringify([selected.source_revision, selected.temporal_key])).digest("hex");
  const columns = Object.fromEntries(statuses.map(status => {
    const total = selected.columns[status]?.total;
    const loaded = status === column ? selected.card_ids.length : 0;
    const next = (cursor?.offset || 0) + loaded;
    const basis = { offset: next, source: selected.source_revision, evaluatedAt: selected.evaluated_at, temporalKey: selected.temporal_key, validUntil: selected.valid_until };
    return [status, { total: status === column ? total : null, loaded, availability: status === column ? "ready" : "not-loaded", completeness: status === column && next >= total ? "complete" : "partial",
      continuation: status === column && next < total ? Buffer.from(JSON.stringify({ ...basis, binding: sign(basis) })).toString("base64url") : null } satisfies PlanningBoardColumn];
  })) as Record<TaskStatus, PlanningBoardColumn>;
  return { status: "ready", model: {
    revision: selected.workspace_revision.latestUpdatedAt, scopeRevision: selected.source_revision, query, queryRevision: revision,
    project: mapPlanningProject(selected.project),
    items: mapPlanningItemRows(selected.rows, people, [], [], []).map(task => compactPlanningCard(task, selectedOmittedFields)),
    people, sprints: selected.sprints.map(mapSprint), preferences: selected.preferences.map(mapProfileUiPreference),
    relationships: selected.relationships.map(mapTaskRelation), blockers: [], taskOmittedFields: selectedOmittedFields,
    coverage: { items: "partial", people: "complete", sprints: "complete", preferences: "complete", strategies: "partial", raci: "partial", links: "partial", relationships: "partial", blockers: "partial" },
    board: { query, column, queryKey, revision, observedAt: selected.evaluated_at, validUntil: selected.valid_until,
      cardIds: selected.card_ids, columns, metrics: { ...selected.metrics, blocked: null }, levelTotals: selected.level_totals,
      workstreams: selected.workstreams, initiativeOptions: selected.initiative_options,
      childProgressById: Object.fromEntries(selected.card_ids.map(id => [id, null])), attentionById: Object.fromEntries(selected.card_ids.map(id => [id, null])),
      viewerOpenSubIssueIdsByDeliverableId: selected.personal_children, workspaceRevision: selected.workspace_revision },
  } };
}
