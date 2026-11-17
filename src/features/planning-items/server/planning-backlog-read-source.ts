import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BacklogLoadResult } from "@/features/backlog/model/backlog-read-model";
import type { BacklogSelectionQuery } from "@/features/backlog/model/backlog-selection";
import type { PlanningWorkspaceLoadContext } from "../model/planning-workspace-model";
import type { DbProfile, DbSprint, DbTask, DbPlanningItemStrategy } from "@/lib/planning-row-types";
import { taskRowSelect } from "@/lib/planning-row-types";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import { mapProfile } from "@/lib/planning-profile-mappers";
import { mapSprint } from "@/lib/planning-sprint-mappers";
import { compactPlanningCard, planningCardOmittedFields } from "./planning-card-summary";

type Cursor = { offset: number; source: string; observedAt: string; validUntil: string; deadline: number; binding: string };
const profileSelect = "id,name,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity,profile_color";
const sprintSelect = "id,name,status,start_date,end_date,review_due_at,score_locked,updated_at";
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === "string" && id.length > 0) && new Set(value).size === value.length;
function signature(context: PlanningWorkspaceLoadContext, query: BacklogSelectionQuery, cursor: Omit<Cursor, "binding">) {
  return createHmac("sha256", context.authorityKey!).update(JSON.stringify(["backlog-selection-v1", context.actorProfileId, query.filters, query.limit, cursor, ...(query.section ? [query.section] : [])])).digest("hex");
}

export async function loadPlanningBacklogSelection(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, query: BacklogSelectionQuery): Promise<BacklogLoadResult> {
  if (!context.authorized || !context.actorProfileId) return { status: "forbidden" };
  if (!context.authorityKey || !context.authorityDeadline || !context.publicationSource) return { status: "unavailable" };
  let cursor: Omit<Cursor, "binding"> | undefined;
  if (query.continuation) {
    try {
      const { binding, ...value } = JSON.parse(Buffer.from(query.continuation, "base64url").toString("utf8")) as Cursor;
      if (!Number.isSafeInteger(value.offset) || value.offset < 1 || typeof value.source !== "string" || !value.source
        || !Number.isFinite(Date.parse(value.observedAt)) || !Number.isFinite(Date.parse(value.validUntil)) || !Number.isFinite(value.deadline)
        || typeof binding !== "string" || !/^[a-f0-9]{64}$/.test(binding)
        || !timingSafeEqual(Buffer.from(binding, "hex"), Buffer.from(signature(context, query, value), "hex"))
        || value.deadline <= Date.now() || Date.parse(value.validUntil) <= Date.now()) return { status: "staleContinuation" };
      cursor = value;
    } catch { return { status: "staleContinuation" }; }
  }
  const deadline = Math.min(context.authorityDeadline, cursor?.deadline ?? Infinity);
  if (deadline <= Date.now()) return { status: "forbidden" };
  try {
    const request = supabase.rpc("planning_backlog_selection", { p_actor_profile_id: context.actorProfileId, p_filters: { ...query.filters, ...(query.section ? { section: query.section } : {}) }, p_limit: query.limit,
      p_offset: cursor?.offset ?? 0, p_source_revision: cursor?.source ?? null, p_evaluated_at: cursor?.observedAt ?? null, p_valid_until: cursor?.validUntil ?? null });
    const result = await (context.signal ? request.abortSignal(context.signal) : request);
    if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
    const selected = result.data;
    if (selected?.status === "forbidden" || selected?.status === "staleContinuation") return { status: selected.status };
    if (selected?.status !== "ready" || !ids(selected.item_ids) || !ids(selected.context_ids)
      || selected.item_ids.length > query.limit || selected.context_ids.length > query.limit * 3
      || selected.context_ids.some((id: string) => selected.item_ids.includes(id))
      || !Number.isSafeInteger(selected.total) || selected.total < 0 || selected.item_ids.length !== Math.min(query.limit, Math.max(0, selected.total - (cursor?.offset ?? 0)))
      || !selected.rank_by_id || selected.item_ids.some((id: string) => !Number.isSafeInteger(selected.rank_by_id[id]) || selected.rank_by_id[id] < 1)
      || typeof selected.source_revision !== "string" || !selected.source_revision || !Number.isFinite(Date.parse(selected.observed_at)) || !Number.isFinite(Date.parse(selected.valid_until))) return { status: "unavailable" };
    if (cursor && (selected.source_revision !== cursor.source || selected.observed_at !== cursor.observedAt || selected.valid_until !== cursor.validUntil)) return { status: "staleContinuation" };
    const selectedIds: string[] = [...selected.item_ids, ...selected.context_ids];
    const hydrated = await hydrateBacklogItems(supabase, context, selectedIds);
    const selectedType = query.section === "orphanInitiatives" ? "initiative" : query.section === "orphanDeliverables" ? "deliverable" : query.filters.level;
    if (!hydrated || selected.item_ids.some((id: string) => hydrated.items.find(item => item.id === id)?.taskType !== selectedType
      || query.section && hydrated.items.find(item => item.id === id)?.parentTaskId)) return { status: "unavailable" };
    const publication = await context.publicationSource.read(context.signal);
    if (publication.status !== "ready") return { status: publication.status };
    if (context.signal?.aborted) return { status: "unavailable" };
    if (deadline <= Date.now()) return { status: "forbidden" };
    if (publication.revision !== selected.source_revision || Date.parse(selected.valid_until) <= Date.now()) return { status: "staleContinuation" };
    const offset = (cursor?.offset ?? 0) + selected.item_ids.length;
    const next = { offset, source: selected.source_revision, observedAt: selected.observed_at, validUntil: selected.valid_until, deadline };
    return { status: "ready", authorityDeadline: deadline, model: {
      revision: selected.source_revision, taskOmittedFields: planningCardOmittedFields,
      coverage: { items: "partial", people: "partial", sprints: "partial", commitments: "partial", strategies: "partial", raci: "partial", links: "partial" },
      ...hydrated, commitments: [],
      selection: { query, itemIds: selected.item_ids, contextIds: selected.context_ids, rankById: selected.rank_by_id, total: selected.total,
        coverage: offset >= selected.total ? "complete" : "partial", continuation: offset >= selected.total ? null : Buffer.from(JSON.stringify({ ...next, binding: signature(context, query, next) })).toString("base64url"),
        sourceRevision: selected.source_revision, observedAt: selected.observed_at, validUntil: selected.valid_until,
        scopeRevision: createHash("sha256").update(JSON.stringify([query.filters, selected.source_revision, ...(query.section ? [query.section] : [])])).digest("hex"),
      },
    } };
  } catch { return { status: "unavailable" }; }
}

export async function hydrateBacklogItems(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, selectedIds: string[], options: { hierarchyRoots?: boolean } = {}) {
  const taskRows: DbTask[] = [];
  for (let from = 0; from < selectedIds.length; from += 50) {
    const read = supabase.from("active_tasks").select(taskRowSelect).eq("project_id", "findmydoc-founder-execution").in("id", selectedIds.slice(from, from + 50)).returns<DbTask[]>();
    const rows = await (context.signal ? read.abortSignal(context.signal) : read);
    if (rows.error || !rows.data) return null;
    taskRows.push(...rows.data);
  }
  const rowById = new Map(taskRows.map(row => [row.id, row]));
  if (taskRows.length !== selectedIds.length || rowById.size !== selectedIds.length || selectedIds.some((id: string) => !rowById.has(id))) return null;
  const peopleIds = [...new Set(taskRows.flatMap(row => [row.assignee, row.owner, row.created_by]).filter((id): id is string => Boolean(id)))];
  const sprintIds = [...new Set(taskRows.map(row => row.sprint_id).filter((id): id is string => Boolean(id)))];
  const peopleRows: DbProfile[] = [], sprintRows: DbSprint[] = [];
  for (let from = 0; from < peopleIds.length; from += 50) {
    const read = supabase.from("profiles").select(profileSelect).in("id", peopleIds.slice(from, from + 50)).returns<DbProfile[]>();
    const rows = await (context.signal ? read.abortSignal(context.signal) : read);
    if (rows.error) return null;
    peopleRows.push(...rows.data || []);
  }
  for (let from = 0; from < sprintIds.length; from += 50) {
    const read = supabase.from("sprints").select(sprintSelect).in("id", sprintIds.slice(from, from + 50)).returns<DbSprint[]>();
    const rows = await (context.signal ? read.abortSignal(context.signal) : read);
    if (rows.error) return null;
    sprintRows.push(...rows.data || []);
  }
  const strategies: DbPlanningItemStrategy[] = [];
  if (options.hierarchyRoots) for (let from = 0; from < selectedIds.length; from += 50) {
    const read = supabase.from("planning_item_strategy").select("task_id,goal,success_criteria,scope_constraints").in("task_id", selectedIds.slice(from, from + 50)).returns<DbPlanningItemStrategy[]>();
    const rows = await (context.signal ? read.abortSignal(context.signal) : read);
    if (rows.error || !rows.data) return null;
    strategies.push(...rows.data);
  }
  const people = peopleRows.map(mapProfile), strategyById = new Map(strategies.map(row => [row.task_id, row]));
  const omitted = options.hierarchyRoots ? planningCardOmittedFields.filter(field => field !== "description" && field !== "strategy") : planningCardOmittedFields;
  return { items: selectedIds.map(id => compactPlanningCard(mapTaskRow(rowById.get(id)!, people, { strategy: strategyById.get(id) }), omitted)), people, sprints: sprintRows.map(mapSprint) };
}
