import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "@/features/planning/model/planning-board-query";
import { loadPlanningWorkspaceModel, mapPlanningItemRows, mapPlanningProject, planningProjectId, planningProfileSelect } from "./planning-workspace-read-source";
import { compactPlanningCard, planningCardOmittedFields } from "./planning-card-summary";
import { withWorkspaceProfileAvatars } from "./workspace-profile-avatars";
import { mapProfile, mapProfileUiPreference } from "@/lib/planning-profile-mappers";
import { mapSprint } from "@/lib/planning-sprint-mappers";
import { mapTaskRelation } from "@/lib/planning-row-mappers";
import type { DbProfile, DbProfileUiPreference, DbSprint, DbTask, DbTaskRelation } from "@/lib/planning-row-types";
import { taskStatuses } from "@/lib/status";
import { strategicPlanningStatuses } from "@/features/tasks/model/planning-item-capabilities";
import type { Task, TaskStatus } from "@/lib/types";
import type { PlanningWorkspaceLoadContext, PlanningWorkspaceLoadResult } from "../model/planning-workspace-model";
import { observeRuntimePhase } from "@/lib/runtime-logging";
import type { PlanningBoardColumnOutcome, PlanningBoardOutcome, PlanningBoardFailureFrame, PlanningBoardQueryLoadResult, PlanningBoardSummaryOutcome } from "@/features/planning/model/planning-board-delivery";
import type { PlanningBoardSummaryFrame, PlanningBoardSummaryLoadResult, PlanningBoardSummaryRequest } from "@/features/planning/model/planning-board-summaries";
import { isHttpUrl } from "@/lib/planning-task-mappers";
import { planningAttentionSignalsFromIds, type TaskAttentionSignal } from "@/features/tasks/model/task-attention-signals";

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
  epic_options?: Array<{ id: string; title: string }>;
  status_options?: TaskStatus[];
  workspace_revision: { activeTaskCount: number; latestUpdatedAt: string };
};
type Cursor = { offset: number; source: string; evaluatedAt: string; temporalKey: string; validUntil: string | null; authorityDeadline: number | null; binding: string };
type ChildProgress = NonNullable<import("@/features/planning/model/planning-board-query").PlanningBoardResult["childProgressById"][string]>;
type SummaryBasis = { readId: string; query: ReturnType<typeof normalizePlanningBoardQuery>; cardIds: string[]; source: string; evaluatedAt: string; temporalKey: string; validUntil: string | null; authorityDeadline: number | null };
const statuses: TaskStatus[] = [...taskStatuses, "Pausiert"];
const selectedOmittedFields: readonly (keyof Task)[] = [...planningCardOmittedFields, "dependsOn", "evidenceLink"];

async function readSourceRevision(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext) {
  if (context.publicationSource) {
    const source = await context.publicationSource.read(context.signal);
    return source.status === "ready" ? { data: source.revision, error: null, status: 200 }
      : { data: null, error: { message: "Planning publication source unavailable" }, status: source.status === "forbidden" ? 403 : 503 };
  }
  // Direct trusted reference loaders and the existing local profile override
  // retain their admitted service-backed read; ordinary callers supply the port.
  const read = supabase.rpc("planning_source_version");
  return context.signal ? read.abortSignal(context.signal) : read;
}

async function loadSelectedSummaries(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, selected: Pick<Selection, "card_ids" | "source_revision" | "evaluated_at" | "valid_until">): Promise<
  | { status: "ready"; progress: Record<string, ChildProgress>; attention: Record<string, TaskAttentionSignal[]> }
  | { status: "forbidden" | "staleContinuation" | "unavailable" }
> {
  if (!selected.card_ids.length) return { status: "ready" as const, progress: {}, attention: {} };
  try {
  const read = supabase.rpc("planning_deliverable_summaries", { p_actor_profile_id: context.actorProfileId,
    p_selected_ids: selected.card_ids, p_source_revision: selected.source_revision,
    p_evaluated_at: selected.evaluated_at, p_valid_until: selected.valid_until });
  const result = await observeRuntimePhase("board.summaries", () => context.signal ? read.abortSignal(context.signal) : read);
  if (result.error || !result.data) return { status: result.status === 401 || result.status === 403 ? "forbidden" as const : "unavailable" as const };
  const summary = result.data as { status: string; source_revision: string; evaluated_at: string; child_progress: Record<string, ChildProgress>;
    attention_inputs: Record<string, { signal_ids: string[]; evidence_required: boolean; evidence_urls: string[] }> };
  if (summary.status === "forbidden" || summary.status === "staleContinuation") return { status: summary.status };
  if (summary.status !== "ready" || summary.source_revision !== selected.source_revision
    || Date.parse(summary.evaluated_at) !== Date.parse(selected.evaluated_at)
    || selected.card_ids.some(id => {
      const progress = summary.child_progress?.[id];
      return !progress || ![progress.completed, progress.total, progress.unfinished, progress.percentage].every(Number.isSafeInteger)
        || progress.completed < 0 || progress.unfinished < 0 || progress.total !== progress.completed + progress.unfinished
        || progress.percentage !== (progress.total ? Math.round((progress.completed / progress.total) * 100) : 0);
    })) return { status: "unavailable" as const };
  const attention: Record<string, TaskAttentionSignal[]> = {};
  for (const id of selected.card_ids) {
    const input = summary.attention_inputs?.[id];
    if (!input || !Array.isArray(input.signal_ids) || input.signal_ids.some(value => typeof value !== "string")
      || new Set(input.signal_ids).size !== input.signal_ids.length || typeof input.evidence_required !== "boolean"
      || !Array.isArray(input.evidence_urls) || input.evidence_urls.some(value => typeof value !== "string")) return { status: "unavailable" };
    const ids = [...input.signal_ids];
    if (input.evidence_required && !input.evidence_urls.some(isHttpUrl)) ids.push("evidence-missing");
    const signals = planningAttentionSignalsFromIds(ids);
    if (!signals) return { status: "unavailable" };
    attention[id] = signals;
  }
  return { status: "ready" as const, progress: summary.child_progress, attention };
  } catch (error) {
    return { status: typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403) ? "forbidden" as const : "unavailable" as const };
  }
}

function signSummary(context: PlanningWorkspaceLoadContext, basis: SummaryBasis) {
  return createHmac("sha256", context.authorityKey || context.actorProfileId || "local-planning")
    .update(JSON.stringify(["planning-summary-v1", context.actorProfileId, planningBoardQueryKey(basis.query), basis])).digest("hex");
}

function summaryRequest(context: PlanningWorkspaceLoadContext, basis: SummaryBasis): PlanningBoardSummaryRequest {
  return { token: Buffer.from(JSON.stringify({ ...basis, binding: signSummary(context, basis) })).toString("base64url"), cardIds: basis.cardIds, status: "loading" };
}

async function loadSelectedTableRisks(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, basis: SummaryBasis): Promise<
  | { status: "ready"; risks: import("@/features/planning/model/planning-table-result").PlanningTableRiskFrame["risksById"] }
  | { status: "forbidden" | "staleContinuation" | "unavailable" }
> {
  const read = supabase.rpc("planning_table_risks", { p_actor_profile_id: context.actorProfileId, p_selected_ids: basis.cardIds,
    p_source_revision: basis.source, p_evaluated_at: basis.evaluatedAt, p_valid_until: basis.validUntil });
  const result = await observeRuntimePhase("table.risks", () => context.signal ? read.abortSignal(context.signal) : read);
  if (result.error || !result.data) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
  const value = result.data as { status: string; source_revision: string; evaluated_at: string;
    relations: Record<string, { waitsOn: number; blocks: number; hasOpenWait: boolean }>;
    attention_inputs: Record<string, { signal_ids: string[]; evidence_required: boolean; evidence_urls: string[] }> };
  if (value.status === "forbidden" || value.status === "staleContinuation") return { status: value.status };
  if (value.status !== "ready" || value.source_revision !== basis.source || Date.parse(value.evaluated_at) !== Date.parse(basis.evaluatedAt)) return { status: "unavailable" };
  const risks: import("@/features/planning/model/planning-table-result").PlanningTableRiskFrame["risksById"] = {};
  for (const id of basis.cardIds) {
    const input = value.attention_inputs?.[id], relations = value.relations?.[id];
    if (!input || !relations || ![relations.waitsOn, relations.blocks].every(count => Number.isSafeInteger(count) && count >= 0)
      || typeof relations.hasOpenWait !== "boolean" || relations.hasOpenWait && relations.waitsOn === 0
      || !Array.isArray(input.signal_ids) || input.signal_ids.some(signal => typeof signal !== "string") || new Set(input.signal_ids).size !== input.signal_ids.length
      || typeof input.evidence_required !== "boolean" || !Array.isArray(input.evidence_urls) || input.evidence_urls.some(url => typeof url !== "string")) return { status: "unavailable" };
    const ids = [...input.signal_ids];
    if (input.evidence_required && !input.evidence_urls.some(isHttpUrl)) ids.push("evidence-missing");
    const attention = planningAttentionSignalsFromIds(ids);
    if (!attention || attention.some(signal => signal.id === "waiting") !== relations.hasOpenWait) return { status: "unavailable" };
    risks[id] = { attention, ...relations };
  }
  return { status: "ready", risks };
}

export async function loadPlanningDeliverableSummaries(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, token: string): Promise<PlanningBoardSummaryLoadResult> {
  if (!context.authorized) return { status: "forbidden" };
  let basis: SummaryBasis;
  try {
    if (token.length > 90000) return { status: "staleContinuation" };
    const { binding, ...parsed } = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (typeof parsed.readId !== "string" || !parsed.readId || !parsed.query || !Array.isArray(parsed.cardIds)
      || parsed.cardIds.length > taskStatuses.length * 20 || parsed.cardIds.some((id: unknown) => typeof id !== "string" || !id || id.length > 512)
      || new Set(parsed.cardIds).size !== parsed.cardIds.length || typeof parsed.source !== "string" || typeof parsed.temporalKey !== "string"
      || !Number.isFinite(Date.parse(parsed.evaluatedAt)) || !(parsed.validUntil === null || typeof parsed.validUntil === "string" && Number.isFinite(Date.parse(parsed.validUntil)))
      || !(parsed.authorityDeadline === null || typeof parsed.authorityDeadline === "number" && Number.isFinite(parsed.authorityDeadline))
      || typeof binding !== "string" || !/^[a-f0-9]{64}$/.test(binding)
      || !timingSafeEqual(Buffer.from(binding, "hex"), Buffer.from(signSummary(context, parsed), "hex"))) return { status: "staleContinuation" };
    basis = parsed;
  } catch { return { status: "staleContinuation" }; }
  if (basis.authorityDeadline !== null && basis.authorityDeadline <= Date.now()) return { status: "forbidden" };
  if (basis.validUntil && Date.parse(basis.validUntil) <= Date.now()) return { status: "staleContinuation" };
  try {
    if (basis.query.view === "table") {
      const result = await loadSelectedTableRisks(supabase, context, basis);
      if (result.status !== "ready") return result;
      const fence = await readSourceRevision(supabase, context);
      if (fence.error || typeof fence.data !== "string") return { status: fence.status === 401 || fence.status === 403 ? "forbidden" : "unavailable" };
      if (basis.authorityDeadline !== null && basis.authorityDeadline <= Date.now()) return { status: "forbidden" };
      if (fence.data !== basis.source || basis.validUntil && Date.parse(basis.validUntil) <= Date.now()) return { status: "staleContinuation" };
      return { status: "ready", summaries: { kind: "table-risks", readId: basis.readId, token, cardIds: basis.cardIds,
        scopeRevision: basis.source, queryRevision: createHash("sha256").update(JSON.stringify([basis.source, basis.temporalKey])).digest("hex"),
        observedAt: basis.evaluatedAt, validUntil: basis.validUntil, authorityDeadline: basis.authorityDeadline, risksById: result.risks } };
    }
    const result = await loadSelectedSummaries(supabase, context, { card_ids: basis.cardIds, source_revision: basis.source, evaluated_at: basis.evaluatedAt, valid_until: basis.validUntil });
    if (result.status !== "ready") return result;
    const fence = await readSourceRevision(supabase, context);
    if (fence.error || typeof fence.data !== "string") return { status: fence.status === 401 || fence.status === 403 ? "forbidden" : "unavailable" };
    if (basis.authorityDeadline !== null && basis.authorityDeadline <= Date.now()) return { status: "forbidden" };
    if (fence.data !== basis.source || basis.validUntil && Date.parse(basis.validUntil) <= Date.now()) return { status: "staleContinuation" };
    return { status: "ready", summaries: { kind: "summaries", readId: basis.readId, token, cardIds: basis.cardIds,
      scopeRevision: basis.source, queryRevision: createHash("sha256").update(JSON.stringify([basis.source, basis.temporalKey])).digest("hex"),
      observedAt: basis.evaluatedAt, validUntil: basis.validUntil, authorityDeadline: basis.authorityDeadline, childProgressById: result.progress, attentionById: result.attention } };
  } catch (error) {
    return { status: typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403) ? "forbidden" : "unavailable" };
  }
}

async function resolveQuery(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext): Promise<PlanningWorkspaceLoadResult | { status: "query"; query: ReturnType<typeof normalizePlanningBoardQuery>; preferenceRevision?: string }> {
  const input = context.query || {};
  let query = normalizePlanningBoardQuery(input);
  let preferenceRevision: string | undefined;
  if (!input.continuation && (!input.filters || !input.view)) {
    const version = await readSourceRevision(supabase, context);
    if (version.error || typeof version.data !== "string") return { status: version.status === 401 || version.status === 403 ? "forbidden" : "unavailable" };
    preferenceRevision = version.data;
    const preferenceRead = supabase.from("profile_ui_preferences").select("profile_id,default_workspace,default_task_view,planning_filters,expanded_item_ids,created_at,updated_at").eq("profile_id", context.actorProfileId || "");
    const preferenceResult = await (context.signal ? preferenceRead.abortSignal(context.signal) : preferenceRead).maybeSingle();
    if (preferenceResult.error) return { status: "unavailable" };
    const preference = preferenceResult.data ? mapProfileUiPreference(preferenceResult.data as DbProfileUiPreference) : undefined;
    const filters = preference && { ...preference.planningFilters, ...(preference.defaultWorkspace === "mine" ? { assignee: "Alle", quick: [...preference.planningFilters.quick, "mine"] } : {}) };
    if (!input.view && preference?.defaultTaskView === "gantt") {
      if (preference.profileId !== context.actorProfileId) return { status: "unavailable" };
      // This is only the admitted mount context; selected Gantt data starts in its visible client owner.
      const projectRead = supabase.from("projects").select("id,name,range_label,review_objection_window_hours").eq("id", planningProjectId).single<Parameters<typeof mapPlanningProject>[0]>();
      const selfRead = supabase.from("profiles").select(planningProfileSelect).eq("id", context.actorProfileId || "").single<DbProfile>();
      const [project, self] = await Promise.all([
        context.signal ? projectRead.abortSignal(context.signal) : projectRead,
        context.signal ? selfRead.abortSignal(context.signal) : selfRead,
      ]);
      if (project.error || !project.data || project.data.id !== planningProjectId || typeof project.data.name !== "string"
        || self.error || !self.data || self.data.id !== context.actorProfileId || typeof self.data.name !== "string") return { status: "unavailable" };
      const publication = await readSourceRevision(supabase, context);
      if (publication.error || publication.data !== preferenceRevision || context.signal?.aborted) return { status: "unavailable" };
      if (context.authorityDeadline !== undefined && context.authorityDeadline <= Date.now()) return { status: "forbidden" };
      return { status: "ready", authorityDeadline: context.authorityDeadline, model: {
        revision: preferenceRevision, scopeRevision: preferenceRevision, project: mapPlanningProject(project.data),
        items: [], people: [mapProfile(self.data)], sprints: [], relationships: [], preferences: [{ ...preference, planningFilters: normalizePlanningBoardQuery({ ...input, filters: input.filters || filters }).filters }],
        coverage: { items: "partial", people: "partial", sprints: "partial", relationships: "partial", preferences: "partial", strategies: "partial", raci: "partial", links: "partial", blockers: "partial" },
      } };
    }
    query = normalizePlanningBoardQuery({ ...input, view: input.view || (preference?.defaultTaskView === "table" ? "table" : preference?.defaultTaskView && preference.defaultTaskView !== "board" ? "complete" : "board"), filters: input.filters || filters });
    if (query.view === "complete") {
      const complete = await loadPlanningWorkspaceModel(supabase, { ...context, query });
      return complete.status === "ready" && complete.model.scopeRevision !== preferenceRevision ? { status: "unavailable" as const } : complete;
    }
  }
  return { status: "query" as const, query, preferenceRevision };
}

function cursorSigner(context: PlanningWorkspaceLoadContext, query: ReturnType<typeof normalizePlanningBoardQuery>, column: TaskStatus | undefined) {
  return (cursor: Omit<Cursor, "binding">) => createHmac("sha256", context.authorityKey || context.actorProfileId || "local-planning")
    .update(JSON.stringify([context.actorProfileId, planningBoardQueryKey(query), column, query.ordering, cursor])).digest("hex");
}

export async function loadPlanningDeliverableBoard(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext): Promise<PlanningWorkspaceLoadResult> {
  if (!context.authorized) return { status: "forbidden" };
  return loadSelectedPlanningPage(supabase, context, await resolveQuery(supabase, context));
}

async function loadSelectedPlanningPage(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, resolved: Awaited<ReturnType<typeof resolveQuery>>): Promise<PlanningWorkspaceLoadResult> {
  if (resolved.status !== "query") return resolved;
  const input = context.query || {};
  const { query, preferenceRevision } = resolved;
  const queryKey = planningBoardQueryKey(query);
  const tableView = query.view === "table";
  const allowedStatuses: readonly TaskStatus[] = query.level === "deliverable" ? statuses : strategicPlanningStatuses;
  const column = tableView ? undefined : input.column || (input.continuation ? "Erledigt" : query.filters.status !== "Alle" && statuses.includes(query.filters.status as TaskStatus) ? query.filters.status as TaskStatus : "Offen");
  if (tableView ? Boolean(input.column) : !column || !allowedStatuses.includes(column)) return { status: "staleContinuation" };
  const sign = cursorSigner(context, query, column);
  let cursor: Cursor | undefined;
  if (input.continuation) {
    try {
      const parsed = JSON.parse(Buffer.from(input.continuation, "base64url").toString("utf8"));
      const { binding, ...basis } = parsed;
      if (!Number.isSafeInteger(basis.offset) || basis.offset < 1 || typeof basis.source !== "string" || typeof basis.temporalKey !== "string"
        || !Number.isFinite(Date.parse(basis.evaluatedAt)) || !(basis.validUntil === null || typeof basis.validUntil === "string" && Number.isFinite(Date.parse(basis.validUntil)))
        || !(basis.authorityDeadline === null || typeof basis.authorityDeadline === "number" && Number.isFinite(basis.authorityDeadline))
        || typeof binding !== "string" || !/^[a-f0-9]{64}$/.test(binding) || !timingSafeEqual(Buffer.from(binding, "hex"), Buffer.from(sign(basis), "hex"))) return { status: "staleContinuation" };
      cursor = parsed;
    } catch { return { status: "staleContinuation" }; }
  }
  const ceiling = Math.min(context.authorityDeadline ?? Infinity, cursor?.authorityDeadline ?? Infinity);
  const authorityDeadline = Number.isFinite(ceiling) ? ceiling : null;
  if (authorityDeadline !== null && authorityDeadline <= Date.now()) return { status: "forbidden" };
  if (cursor?.validUntil && Date.parse(cursor.validUntil) <= Date.now()) return { status: "staleContinuation" };
  const deadlineSignal = authorityDeadline === null ? undefined : AbortSignal.timeout(Math.max(0, Math.ceil(authorityDeadline - Date.now())));
  context = { ...context, authorityDeadline: authorityDeadline ?? undefined,
    signal: context.signal && deadlineSignal ? AbortSignal.any([context.signal, deadlineSignal]) : context.signal || deadlineSignal };
  const read = supabase.rpc("planning_deliverable_selection", {
    p_actor_profile_id: context.actorProfileId, p_query: { ...query, ...(context.structureParentId ? { structureParentId: context.structureParentId } : {}) }, p_column: column ?? null, p_offset: cursor?.offset || 0,
    p_limit: Math.min(20, Math.max(1, Math.trunc(Number(input.limit) || 20))), p_source_revision: cursor?.source || null, p_evaluated_at: cursor?.evaluatedAt || null,
  });
  const result = await observeRuntimePhase("board.selection", () => context.signal ? read.abortSignal(context.signal) : read);
  if (authorityDeadline !== null && authorityDeadline <= Date.now()) return { status: "forbidden" };
  if (result.error || !result.data) return { status: "unavailable" };
  const selected = result.data as Selection;
  if (selected.status === "forbidden" || selected.status === "staleContinuation") return { status: selected.status };
  if (selected.status !== "ready" || !selected.project?.id || typeof selected.source_revision !== "string" || !Array.isArray(selected.rows) || !Array.isArray(selected.card_ids)
    || !Number.isFinite(Date.parse(selected.evaluated_at)) || typeof selected.temporal_key !== "string"
    || !(selected.valid_until === null || typeof selected.valid_until === "string" && Number.isFinite(Date.parse(selected.valid_until)))
    || !Array.isArray(selected.workstreams) || selected.workstreams.some(value => typeof value !== "string")
    || !Array.isArray(selected.initiative_options) || selected.initiative_options.some(value => !value || typeof value.id !== "string" || typeof value.title !== "string")
    || query.level === "initiative" && (!Array.isArray(selected.epic_options) || selected.epic_options.some(value => !value || typeof value.id !== "string" || typeof value.title !== "string"))
    || !selected.columns || !selected.metrics) return { status: "unavailable" };
  if (cursor && (cursor.source !== selected.source_revision || cursor.temporalKey !== selected.temporal_key)) return { status: "staleContinuation" };
  if (preferenceRevision && preferenceRevision !== selected.source_revision) return { status: "unavailable" };
  if (tableView && (!Array.isArray(selected.status_options) || new Set(selected.status_options).size !== selected.status_options.length
    || selected.status_options.some(status => !statuses.includes(status)))) return { status: "unavailable" };
  const avatarController = new AbortController();
  const avatarSignal = context.signal ? AbortSignal.any([context.signal, avatarController.signal]) : avatarController.signal;
  const peopleRead = withWorkspaceProfileAvatars(selected.profiles.map(mapProfile), supabase, avatarSignal);
  const summaries = tableView ? null : await loadSelectedSummaries(supabase, context, selected);
  if (authorityDeadline !== null && authorityDeadline <= Date.now() || summaries?.status === "forbidden") {
    avatarController.abort();
    return { status: "forbidden" };
  }
  // The initial JSON read has no accepted page basis to continue. Preserve its
  // established unavailable result when the new summary detects a source shift.
  if (summaries?.status === "staleContinuation") {
    avatarController.abort();
    return { status: cursor ? "staleContinuation" : "unavailable" };
  }
  const people = await peopleRead;
  if (authorityDeadline !== null && authorityDeadline <= Date.now()) return { status: "forbidden" };
  // The SQL statement covers selection and hydration. Avatar identity is a
  // separate read, so retain a matching source fence across that supporting work.
  const fence = await readSourceRevision(supabase, context);
  if (authorityDeadline !== null && authorityDeadline <= Date.now()) return { status: "forbidden" };
  if (fence.error || typeof fence.data !== "string") return { status: fence.status === 401 || fence.status === 403 ? "forbidden" : "unavailable" };
  if (fence.data !== selected.source_revision || selected.valid_until && Date.parse(selected.valid_until) <= Date.now()) return { status: cursor ? "staleContinuation" : "unavailable" };
  const revision = createHash("sha256").update(JSON.stringify([selected.source_revision, selected.temporal_key])).digest("hex");
  const request = summaryRequest(context, { readId: randomUUID(), query, cardIds: selected.card_ids, source: selected.source_revision,
    evaluatedAt: selected.evaluated_at, temporalKey: selected.temporal_key, validUntil: selected.valid_until, authorityDeadline: context.authorityDeadline ?? null });
  const content = {
    revision: selected.workspace_revision.latestUpdatedAt, scopeRevision: selected.source_revision, query, queryRevision: revision,
    project: mapPlanningProject(selected.project),
    items: mapPlanningItemRows(selected.rows, people, [], [], []).map(task => compactPlanningCard(task, selectedOmittedFields)),
    people, sprints: selected.sprints.map(mapSprint), preferences: selected.preferences.map(mapProfileUiPreference),
    relationships: selected.relationships.map(mapTaskRelation), blockers: [], taskOmittedFields: selectedOmittedFields,
    coverage: { items: "partial", people: "complete", sprints: "complete", preferences: "complete", strategies: "partial", raci: "partial", links: "partial", relationships: "partial", blockers: "partial" },
  } satisfies import("../model/planning-workspace-model").PlanningWorkspaceModel;
  if (tableView) {
    const next = (cursor?.offset || 0) + selected.card_ids.length, total = selected.metrics.total;
    const basis = { offset: next, source: selected.source_revision, evaluatedAt: selected.evaluated_at, temporalKey: selected.temporal_key, validUntil: selected.valid_until, authorityDeadline };
    return { status: "ready", authorityDeadline: authorityDeadline ?? undefined, model: { ...content,
      table: { query, queryKey, revision, observedAt: selected.evaluated_at, validUntil: selected.valid_until,
        rowIds: selected.card_ids, statusOptions: selected.status_options, page: { total, loaded: selected.card_ids.length, completeness: next >= total ? "complete" : "partial",
          continuation: next < total ? Buffer.from(JSON.stringify({ ...basis, binding: sign(basis) })).toString("base64url") : null },
        metrics: selected.metrics, workstreams: selected.workstreams, initiativeOptions: selected.initiative_options,
        summaryRequests: selected.card_ids.length ? [request] : [],
        risksById: Object.fromEntries(selected.card_ids.map(id => [id, null])),
        workspaceRevision: selected.workspace_revision },
    } };
  }
  if (!summaries) return { status: "unavailable" };
  const columns = Object.fromEntries(statuses.map(status => {
    const total = selected.columns[status]?.total;
    const loaded = status === column ? selected.card_ids.length : 0;
    const next = (cursor?.offset || 0) + loaded;
    const basis = { offset: next, source: selected.source_revision, evaluatedAt: selected.evaluated_at, temporalKey: selected.temporal_key, validUntil: selected.valid_until, authorityDeadline };
    return [status, { total: status === column ? total : null, loaded, availability: status === column ? "ready" : "not-loaded", completeness: status === column && next >= total ? "complete" : "partial",
      continuation: status === column && next < total ? Buffer.from(JSON.stringify({ ...basis, binding: sign(basis) })).toString("base64url") : null } satisfies PlanningBoardColumn];
  })) as Record<TaskStatus, PlanningBoardColumn>;
  return { status: "ready", authorityDeadline: authorityDeadline ?? undefined, model: {
    ...content,
    board: { query, column, queryKey, revision, observedAt: selected.evaluated_at, validUntil: selected.valid_until,
      cardIds: selected.card_ids, columns, metrics: selected.metrics, levelTotals: selected.level_totals,
      summaryRequests: selected.card_ids.length ? [{ ...request, status: summaries.status === "ready" ? "current" : "unavailable" }] : [],
      workstreams: selected.workstreams, initiativeOptions: selected.initiative_options,
      epicOptions: query.level === "initiative" ? selected.epic_options : undefined,
      childProgressById: summaries.status === "ready" ? summaries.progress : Object.fromEntries(selected.card_ids.map(id => [id, null])),
      attentionById: summaries.status === "ready" ? summaries.attention : Object.fromEntries(selected.card_ids.map(id => [id, null])),
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
    if (query.view === "table") {
      const result = await loadSelectedPlanningPage(supabase, bound, resolved);
      cleanup(); return result;
    }
    const visibleStatuses: readonly TaskStatus[] = query.level === "deliverable" ? taskStatuses : strategicPlanningStatuses;
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
      || query.level === "initiative" && (!Array.isArray(plan.epic_options) || plan.epic_options.some(value => !value || typeof value.id !== "string" || typeof value.title !== "string"))
      || statuses.some(status => !Number.isSafeInteger(plan.columns?.[status]?.total) || plan.columns[status].total < 0 || !Array.isArray(plan.columns[status].ids)
        || plan.columns[status].ids.some(id => typeof id !== "string") || new Set(plan.columns[status].ids).size !== plan.columns[status].ids.length
        || plan.columns[status].ids.length !== (visibleStatuses.includes(status) ? Math.min(limit, plan.columns[status].total) : 0))
      || !plan.metrics || !plan.level_totals || !plan.workspace_revision || !plan.personal_children) { cleanup(); return { status: "unavailable" }; }
    if (preferenceRevision && plan.source_revision !== preferenceRevision) { cleanup(); return { status: "unavailable" }; }
    const pending = visibleStatuses.filter(status => plan.columns[status].ids.length > 0);
    const id = randomUUID(), summaryIds = pending.flatMap(column => plan.columns[column].ids);
    const request = summaryRequest(context, { readId: id, query, cardIds: summaryIds, source: plan.source_revision,
      evaluatedAt: plan.evaluated_at, temporalKey: plan.temporal_key, validUntil: plan.valid_until, authorityDeadline: context.authorityDeadline ?? null });
    // Only bounded, server-selected raw reads overlap the common metadata work.
    // Nothing is mapped or published until avatars and the initial fence finish.
    const rawReads = new Map(pending.map(column => {
      const ids = plan.columns[column].ids;
      const read = supabase.rpc("planning_deliverable_column", { p_actor_profile_id: context.actorProfileId, p_selected_ids: ids,
        p_source_revision: plan.source_revision, p_evaluated_at: plan.evaluated_at, p_valid_until: plan.valid_until });
      const response = observeRuntimePhase("board.items", () => read.abortSignal(controller.signal));
      // Common work can fail before hydration is awaited. Consume rejection now;
      // the query-local outcome is classified only after the common fence.
      return [column, response.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }))] as const;
    }));
    const rawSummaries = summaryIds.length ? loadSelectedSummaries(supabase, bound, { card_ids: summaryIds,
      source_revision: plan.source_revision, evaluated_at: plan.evaluated_at, valid_until: plan.valid_until }) : undefined;
    const people = await withWorkspaceProfileAvatars(plan.profiles.map(mapProfile), supabase, controller.signal);
    const initialFence = await readSourceRevision(supabase, bound);
    if (initialFence.error) { abort(); return { status: initialFence.status === 401 || initialFence.status === 403 ? "forbidden" : "unavailable" }; }
    if (initialFence.data !== plan.source_revision || plan.valid_until && Date.parse(plan.valid_until) <= Date.now()) { abort(); return { status: "unavailable" }; }
    const revision = createHash("sha256").update(JSON.stringify([plan.source_revision, plan.temporal_key])).digest("hex");
    const columns = Object.fromEntries(statuses.map(status => [status, { total: plan.columns[status].total, loaded: 0,
      availability: plan.columns[status].total === 0 ? "ready" : "not-loaded", completeness: plan.columns[status].total === 0 ? "complete" : "partial", continuation: null } satisfies PlanningBoardColumn])) as Record<TaskStatus, PlanningBoardColumn>;
    const model = {
      revision: plan.workspace_revision.latestUpdatedAt, scopeRevision: plan.source_revision, query, queryRevision: revision,
      project: mapPlanningProject(plan.project), items: [], people, sprints: plan.sprints.map(mapSprint), preferences: plan.preferences.map(mapProfileUiPreference),
      relationships: [], blockers: [], taskOmittedFields: selectedOmittedFields,
      coverage: { items: "partial", people: "complete", sprints: "complete", preferences: "complete", strategies: "partial", raci: "partial", links: "partial", relationships: "partial", blockers: "partial" },
      board: { query, queryKey: planningBoardQueryKey(query), revision, observedAt: plan.evaluated_at, validUntil: plan.valid_until, delivery: { id, columns: pending },
        summaryRequests: summaryIds.length ? [request] : [],
        cardIds: [], columns, metrics: plan.metrics, levelTotals: plan.level_totals,
        workstreams: plan.workstreams, initiativeOptions: plan.initiative_options, epicOptions: query.level === "initiative" ? plan.epic_options : undefined,
        childProgressById: {}, attentionById: {}, viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: plan.workspace_revision },
    } satisfies import("../model/planning-workspace-model").PlanningWorkspaceModel;
    let terminal: PlanningBoardFailureFrame | undefined;
    function failure(column: TaskStatus | undefined, status: 403 | 409 | 503, area?: "summaries"): PlanningBoardFailureFrame {
      const outcome = { kind: "failure" as const, readId: id, column, status,
        ...(area ? { area, token: request.token } : {}),
        error: status === 403 ? "Planung darf nicht geladen werden." : status === 409 ? "Die Ergebnisliste hat sich geändert. Bitte erneut laden." : area ? "Fortschritt und Signale konnten nicht geladen werden." : "Die Spalte konnte nicht geladen werden.",
        ...(status === 409 ? { code: "stale_continuation" } : {}) };
      if (status !== 503) { terminal ||= outcome; abort(); }
      return terminal || outcome;
    }
    async function summarize(): Promise<PlanningBoardSummaryOutcome> {
      const summary = await rawSummaries!;
      if (terminal) return terminal;
      if (summary.status !== "ready") return failure(undefined, summary.status === "forbidden" ? 403 : summary.status === "staleContinuation" ? 409 : 503, "summaries");
      const outcome: PlanningBoardSummaryFrame = { kind: "summaries", readId: id, token: request.token, scopeRevision: plan.source_revision, queryRevision: revision,
        observedAt: plan.evaluated_at, validUntil: plan.valid_until, authorityDeadline: context.authorityDeadline ?? null, cardIds: summaryIds, childProgressById: summary.progress, attentionById: summary.attention };
      if (query.level === "epic") { summaryReservation.outcome = outcome; summaryReservation.digest = payloadDigest(outcome); }
      return outcome;
    }
    async function hydrate(column: TaskStatus): Promise<PlanningBoardColumnOutcome> {
      try {
        const ids = plan.columns[column].ids;
        const raw = await rawReads.get(column)!;
        if (!raw.ok) throw raw.error;
        const response = raw.value;
        if (terminal) return terminal;
        if (response.error || !response.data) return failure(column, response.status === 401 || response.status === 403 ? 403 : 503);
        const selected = response.data as SelectedColumn;
        if (selected.status === "forbidden") return failure(column, 403);
        if (selected.status === "staleContinuation") return failure(column, 409);
        if (selected.status !== "ready" || selected.source_revision !== plan.source_revision || !Array.isArray(selected.rows) || !Array.isArray(selected.relationships)
          || !Array.isArray(selected.card_ids) || JSON.stringify(selected.card_ids) !== JSON.stringify(ids)) return failure(column, 503);
        const basis = { offset: ids.length, source: plan.source_revision, evaluatedAt: plan.evaluated_at, temporalKey: plan.temporal_key, validUntil: plan.valid_until, authorityDeadline: context.authorityDeadline ?? null };
        const total = plan.columns[column].total;
        const outcome: Extract<PlanningBoardColumnOutcome, { kind: "column" }> = { kind: "column", readId: id, column, scopeRevision: plan.source_revision, queryRevision: revision, observedAt: plan.evaluated_at, validUntil: plan.valid_until,
          cardIds: ids, items: mapPlanningItemRows(selected.rows, people, [], [], []).map(task => compactPlanningCard(task, selectedOmittedFields)),
          relationships: selected.relationships.map(mapTaskRelation), taskOmittedFields: selectedOmittedFields,
          personalChildren: Object.fromEntries(ids.filter(cardId => plan.personal_children[cardId]?.length).map(cardId => [cardId, plan.personal_children[cardId]])),
          columnState: { total, loaded: ids.length, availability: "ready", completeness: ids.length >= total ? "complete" : "partial",
            continuation: ids.length < total ? Buffer.from(JSON.stringify({ ...basis, binding: cursorSigner(context, query, column)(basis) })).toString("base64url") : null },
        };
        if (query.level === "epic") unpublished.set(column, { outcome, digest: payloadDigest(outcome) });
        return outcome;
      } catch (error) {
        const status = typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403) ? 403 : 503;
        return terminal || failure(column, status);
      }
    }
    const unpublished = new Map<TaskStatus, { outcome: PlanningBoardColumnOutcome; digest: string } | undefined>(pending.map(column => [column, undefined]));
    const summaryReservation = { pending: Boolean(rawSummaries), outcome: undefined as PlanningBoardSummaryFrame | undefined, digest: "" };
    function payloadDigest(outcome: PlanningBoardOutcome) { return createHash("sha256").update(JSON.stringify(outcome)).digest("hex"); }
    async function checkPublication<T extends PlanningBoardOutcome>(outcome: T, initialSummary?: PlanningBoardSummaryFrame): Promise<T | PlanningBoardFailureFrame> {
      if (terminal) return terminal;
      const column = outcome.kind === "summaries" ? undefined : outcome.column;
      const area = outcome.kind === "summaries" || outcome.kind === "failure" && outcome.area === "summaries" ? "summaries" : undefined;
      if (initialSummary) {
        const columnReservation = column ? unpublished.get(column) : undefined;
        if (query.level !== "epic" || outcome.kind !== "column" || !columnReservation || columnReservation.outcome !== outcome
          || columnReservation.digest !== payloadDigest(outcome) || !summaryReservation.pending
          || summaryReservation.outcome !== initialSummary || summaryReservation.digest !== payloadDigest(initialSummary)
          || initialSummary.readId !== id || initialSummary.token !== request.token || initialSummary.scopeRevision !== plan.source_revision
          || initialSummary.queryRevision !== revision || initialSummary.observedAt !== plan.evaluated_at
          || initialSummary.validUntil !== plan.valid_until || (initialSummary.authorityDeadline ?? null) !== (context.authorityDeadline ?? null)
          || JSON.stringify(initialSummary.cardIds) !== JSON.stringify(summaryIds)
          || JSON.stringify(initialSummary.cardIds) !== JSON.stringify(outcome.cardIds)) return failure(column, 503, "summaries");
        // Claim both existing reservations synchronously, before the live check.
        // A competing or late caller cannot reuse either admitted payload.
        unpublished.delete(outcome.column);
        summaryReservation.pending = false;
      } else if (query.level === "epic" && (column && !unpublished.has(column) || area && !summaryReservation.pending)) {
        return failure(column, 503, area);
      }
      try {
        if (outcome.kind === "failure" && outcome.status !== 503) return outcome;
        // Run at the actual HTTP/SSR publication boundary, even if hydration
        // settled earlier. The guarded client rechecks original JWT/live access.
        const fence = await readSourceRevision(supabase, bound);
        if (terminal) return terminal;
        if (fence.error || typeof fence.data !== "string") return failure(column, fence.status === 401 || fence.status === 403 ? 403 : 503, area);
        if (fence.data !== plan.source_revision || plan.valid_until && Date.parse(plan.valid_until) <= Date.now()) return failure(column, 409, area);
        return outcome;
      } catch (error) {
        const status = typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403) ? 403 : 503;
        return terminal || failure(column, status, area);
      } finally {
        if (column) unpublished.delete(column);
        if (area) summaryReservation.pending = false;
        if (!unpublished.size && !summaryReservation.pending) cleanup();
      }
    }
    // Start every nonempty column now. No column waits for Offen or a sibling.
    const results = Object.fromEntries(pending.map(column => [column, hydrate(column)])) as Partial<Record<TaskStatus, Promise<PlanningBoardColumnOutcome>>>;
    if (!pending.length) cleanup();
    return { status: "ready", model, delivery: { id, columns: results, summaries: rawSummaries ? summarize() : undefined, abort, checkPublication } };
  } catch (error) {
    cleanup(); abort();
    return { status: typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403) ? "forbidden" : "unavailable" };
  }
}
