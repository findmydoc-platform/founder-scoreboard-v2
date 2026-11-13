import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
import type { PlanningBoardColumnOutcome, PlanningBoardQueryLoadResult } from "@/features/planning/model/planning-board-delivery";

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

async function resolveQuery(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext): Promise<PlanningWorkspaceLoadResult | { status: "query"; query: ReturnType<typeof normalizePlanningBoardQuery>; preferenceRevision?: string }> {
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
      return complete.status === "ready" && complete.model.scopeRevision !== preferenceRevision ? { status: "unavailable" as const } : complete;
    }
  }
  return { status: "query" as const, query, preferenceRevision };
}

function cursorSigner(context: PlanningWorkspaceLoadContext, query: ReturnType<typeof normalizePlanningBoardQuery>, column: TaskStatus) {
  return (cursor: Omit<Cursor, "binding">) => createHmac("sha256", context.authorityKey || context.actorProfileId || "local-planning")
    .update(JSON.stringify([context.actorProfileId, planningBoardQueryKey(query), column, query.ordering, cursor])).digest("hex");
}

export async function loadPlanningDeliverableBoard(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext): Promise<PlanningWorkspaceLoadResult> {
  if (!context.authorized) return { status: "forbidden" };
  const input = context.query || {};
  const resolved = await resolveQuery(supabase, context);
  if (resolved.status !== "query") return resolved;
  const { query, preferenceRevision } = resolved;
  const queryKey = planningBoardQueryKey(query);
  const column = input.column || (input.continuation ? "Erledigt" : query.filters.status !== "Alle" && statuses.includes(query.filters.status as TaskStatus) ? query.filters.status as TaskStatus : "Offen");
  if (!statuses.includes(column)) return { status: "staleContinuation" };
  const sign = cursorSigner(context, query, column);
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

type QueryPlan = Omit<Selection, "rows" | "card_ids" | "context_ids" | "relationships" | "columns"> & {
  columns: Record<TaskStatus, { total: number; ids: string[] }>;
};
type SelectedColumn = Pick<Selection, "status" | "source_revision" | "evaluated_at" | "rows" | "card_ids" | "context_ids" | "relationships">;

// All state below belongs to this one admitted query, never to a shared cache.
export async function startPlanningDeliverableQuery(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext): Promise<PlanningBoardQueryLoadResult> {
  if (!context.authorized) return { status: "forbidden" };
  const controller = new AbortController();
  const abort = () => { controller.abort(); cleanup(); };
  if (context.signal?.aborted) abort(); else context.signal?.addEventListener("abort", abort, { once: true });
  const bound = { ...context, signal: controller.signal };
  function cleanup() { context.signal?.removeEventListener("abort", abort); }
  try {
    const resolved = await resolveQuery(supabase, bound);
    if (resolved.status !== "query") { cleanup(); return resolved; }
    const { query, preferenceRevision } = resolved;
    const limit = Math.min(20, Math.max(1, Math.trunc(Number(context.query?.limit) || 20)));
    const planRead = supabase.rpc("planning_deliverable_query_plan", { p_actor_profile_id: context.actorProfileId, p_query: query, p_limit: limit });
    const result = await observeRuntimePhase("board.selection", () => planRead.abortSignal(controller.signal));
    if (result.error || !result.data) { cleanup(); return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" }; }
    const plan = result.data as QueryPlan;
    if (plan.status === "forbidden") { cleanup(); return { status: "forbidden" }; }
    if (plan.status !== "ready" || !plan.project?.id || typeof plan.source_revision !== "string" || !Number.isFinite(Date.parse(plan.evaluated_at))
      || typeof plan.temporal_key !== "string" || !(plan.valid_until === null || Number.isFinite(Date.parse(plan.valid_until)))
      || !Array.isArray(plan.profiles) || !Array.isArray(plan.sprints) || !Array.isArray(plan.preferences)
      || !Array.isArray(plan.workstreams) || plan.workstreams.some(value => typeof value !== "string")
      || !Array.isArray(plan.initiative_options) || plan.initiative_options.some(value => !value || typeof value.id !== "string" || typeof value.title !== "string")
      || statuses.some(status => !Number.isSafeInteger(plan.columns?.[status]?.total) || plan.columns[status].total < 0 || !Array.isArray(plan.columns[status].ids)
        || plan.columns[status].ids.some(id => typeof id !== "string") || new Set(plan.columns[status].ids).size !== plan.columns[status].ids.length
        || status !== "Pausiert" && plan.columns[status].ids.length !== Math.min(limit, plan.columns[status].total))
      || !plan.metrics || !plan.level_totals || !plan.workspace_revision || !plan.personal_children) { cleanup(); return { status: "unavailable" }; }
    if (preferenceRevision && plan.source_revision !== preferenceRevision) { cleanup(); return { status: "unavailable" }; }
    const people = await withWorkspaceProfileAvatars(plan.profiles.map(mapProfile), supabase, controller.signal);
    const initialFence = await supabase.rpc("planning_source_version").abortSignal(controller.signal);
    if (initialFence.error) { cleanup(); return { status: initialFence.status === 401 || initialFence.status === 403 ? "forbidden" : "unavailable" }; }
    if (initialFence.data !== plan.source_revision || plan.valid_until && Date.parse(plan.valid_until) <= Date.now()) { cleanup(); return { status: "unavailable" }; }
    const revision = createHash("sha256").update(JSON.stringify([plan.source_revision, plan.temporal_key])).digest("hex");
    const id = randomUUID(), pending = taskStatuses.filter(status => plan.columns[status].ids.length > 0);
    const columns = Object.fromEntries(statuses.map(status => [status, { total: plan.columns[status].total, loaded: 0,
      availability: plan.columns[status].total === 0 ? "ready" : "not-loaded", completeness: plan.columns[status].total === 0 ? "complete" : "partial", continuation: null } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
    const model = {
      revision: plan.workspace_revision.latestUpdatedAt, scopeRevision: plan.source_revision, query, queryRevision: revision,
      project: mapPlanningProject(plan.project), items: [], people, sprints: plan.sprints.map(mapSprint), preferences: plan.preferences.map(mapProfileUiPreference),
      relationships: [], blockers: [], taskOmittedFields: selectedOmittedFields,
      coverage: { items: "partial", people: "complete", sprints: "complete", preferences: "complete", strategies: "partial", raci: "partial", links: "partial", relationships: "partial", blockers: "partial" },
      board: { query, queryKey: planningBoardQueryKey(query), revision, observedAt: plan.evaluated_at, validUntil: plan.valid_until, delivery: { id, columns: pending },
        cardIds: [], columns, metrics: { ...plan.metrics, blocked: null }, levelTotals: plan.level_totals,
        workstreams: plan.workstreams, initiativeOptions: plan.initiative_options, childProgressById: {}, attentionById: {}, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: plan.workspace_revision },
    } satisfies import("../model/planning-workspace-model").PlanningWorkspaceModel;
    let terminal: Extract<PlanningBoardColumnOutcome, { kind: "failure" }> | undefined;
    function failure(column: TaskStatus, status: 403 | 409 | 503): PlanningBoardColumnOutcome {
      const outcome = { kind: "failure" as const, readId: id, column, status,
        error: status === 403 ? "Planung darf nicht geladen werden." : status === 409 ? "Die Ergebnisliste hat sich geändert. Bitte erneut laden." : "Die Spalte konnte nicht geladen werden.",
        ...(status === 409 ? { code: "stale_continuation" } : {}) };
      if (status !== 503) { terminal ||= outcome; abort(); }
      return terminal || outcome;
    }
    async function hydrate(column: TaskStatus): Promise<PlanningBoardColumnOutcome> {
      try {
        const ids = plan.columns[column].ids;
        const read = supabase.rpc("planning_deliverable_column", { p_actor_profile_id: context.actorProfileId, p_selected_ids: ids,
          p_source_revision: plan.source_revision, p_evaluated_at: plan.evaluated_at, p_valid_until: plan.valid_until });
        const response = await observeRuntimePhase("board.items", () => read.abortSignal(controller.signal));
        if (terminal) return terminal;
        if (response.error || !response.data) return failure(column, response.status === 401 || response.status === 403 ? 403 : 503);
        const selected = response.data as SelectedColumn;
        if (selected.status === "forbidden") return failure(column, 403);
        if (selected.status === "staleContinuation") return failure(column, 409);
        if (selected.status !== "ready" || selected.source_revision !== plan.source_revision || !Array.isArray(selected.rows) || !Array.isArray(selected.relationships)
          || !Array.isArray(selected.card_ids) || JSON.stringify(selected.card_ids) !== JSON.stringify(ids)) return failure(column, 503);
        const basis = { offset: ids.length, source: plan.source_revision, evaluatedAt: plan.evaluated_at, temporalKey: plan.temporal_key, validUntil: plan.valid_until };
        const total = plan.columns[column].total;
        return { kind: "column", readId: id, column, scopeRevision: plan.source_revision, queryRevision: revision, observedAt: plan.evaluated_at, validUntil: plan.valid_until,
          cardIds: ids, items: mapPlanningItemRows(selected.rows, people, [], [], []).map(task => compactPlanningCard(task, selectedOmittedFields)),
          relationships: selected.relationships.map(mapTaskRelation), taskOmittedFields: selectedOmittedFields,
          personalChildren: Object.fromEntries(ids.filter(cardId => plan.personal_children[cardId]?.length).map(cardId => [cardId, plan.personal_children[cardId]])),
          columnState: { total, loaded: ids.length, availability: "ready", completeness: ids.length >= total ? "complete" : "partial",
            continuation: ids.length < total ? Buffer.from(JSON.stringify({ ...basis, binding: cursorSigner(context, query, column)(basis) })).toString("base64url") : null },
        };
      } catch (error) {
        const status = typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403) ? 403 : 503;
        return terminal || failure(column, status);
      }
    }
    const unpublished = new Set(pending);
    async function checkPublication(outcome: PlanningBoardColumnOutcome): Promise<PlanningBoardColumnOutcome> {
      if (terminal) return terminal;
      try {
        if (outcome.kind === "failure") return outcome;
        // Run at the actual HTTP/SSR publication boundary, even if hydration
        // settled earlier. The guarded client rechecks original JWT/live access.
        const fence = await supabase.rpc("planning_source_version").abortSignal(controller.signal);
        if (terminal) return terminal;
        if (fence.error || typeof fence.data !== "string") return failure(outcome.column, fence.status === 401 || fence.status === 403 ? 403 : 503);
        if (fence.data !== plan.source_revision || plan.valid_until && Date.parse(plan.valid_until) <= Date.now()) return failure(outcome.column, 409);
        return outcome;
      } catch (error) {
        const status = typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403) ? 403 : 503;
        return terminal || failure(outcome.kind === "column" ? outcome.column : outcome.column || pending[0], status);
      } finally {
        if (outcome.column) unpublished.delete(outcome.column);
        if (!unpublished.size) cleanup();
      }
    }
    // Start every nonempty column now. No column waits for Offen or a sibling.
    const results = Object.fromEntries(pending.map(column => [column, hydrate(column)])) as Partial<Record<TaskStatus, Promise<PlanningBoardColumnOutcome>>>;
    if (!pending.length) cleanup();
    return { status: "ready", model, delivery: { id, columns: results, abort, checkPublication } };
  } catch (error) {
    cleanup(); abort();
    return { status: typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403) ? "forbidden" : "unavailable" };
  }
}
