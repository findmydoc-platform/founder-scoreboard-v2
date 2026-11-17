import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningStructureModel, PlanningStructureQuery } from "@/features/planning/model/planning-structure-query";
import type { PlanningWorkspaceLoadContext } from "../model/planning-workspace-model";
import { hydrateBacklogItems } from "./planning-backlog-read-source";
import { loadPlanningDeliverableBoard } from "./planning-deliverable-read-source";
import { planningCardOmittedFields } from "./planning-card-summary";

type Result = { status: "ready"; model: PlanningStructureModel; authorityDeadline: number } | { status: "forbidden" | "unavailable" | "staleContinuation" };
type Cursor = { offset: number; source: string; observedAt: string; validUntil: string; deadline: number; binding: string };
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(id => typeof id === "string" && id.length > 0) && new Set(value).size === value.length;
function signature(context: PlanningWorkspaceLoadContext, query: PlanningStructureQuery, cursor: Omit<Cursor, "binding">) {
  return createHmac("sha256", context.authorityKey!).update(JSON.stringify(["structure-roots-v1", context.actorProfileId, query.area, query.limit, cursor])).digest("hex");
}

async function loadStructureChildren(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, query: Extract<PlanningStructureQuery, { area: "children" }>): Promise<Result> {
  if (!context.authorityKey || !context.authorityDeadline || !context.publicationSource) return { status: "unavailable" };
  let sourceRevision: string | undefined;
  const publicationSource = context.publicationSource;
  const result = await loadPlanningDeliverableBoard(supabase, { ...context, structureParentId: query.parentId,
    query: { view: "table", filters: query.filters, limit: query.limit, continuation: query.continuation },
    authorityKey: createHmac("sha256", context.authorityKey).update(JSON.stringify(["structure-children-v1", query.parentId, query.filters, query.limit])).digest("hex"),
    publicationSource: { async read(signal) { const source = await publicationSource.read(signal); if (source.status === "ready") sourceRevision = source.revision; return source; } },
  });
  if (result.status !== "ready") return result;
  const table = result.model.table;
  if (!table || !sourceRevision || !table.validUntil || !Number.isFinite(Date.parse(table.validUntil))
    || Date.parse(table.validUntil) <= Date.now()) return { status: "unavailable" };
  const deadline = Math.min(context.authorityDeadline, result.authorityDeadline ?? Infinity);
  if (deadline <= Date.now()) return { status: "forbidden" };
  const selectedIds = new Set(table.rowIds);
  return { status: "ready", authorityDeadline: deadline, model: {
    revision: sourceRevision, items: result.model.items, people: result.model.people, taskOmittedFields: result.model.taskOmittedFields || planningCardOmittedFields,
    structure: { query, itemIds: table.rowIds, contextIds: result.model.items.filter(item => !selectedIds.has(item.id)).map(item => item.id),
      total: table.page.total, coverage: table.page.completeness, continuation: table.page.continuation,
      sourceRevision, scopeRevision: createHash("sha256").update(JSON.stringify([query.parentId, query.filters, sourceRevision])).digest("hex"),
      observedAt: table.observedAt, validUntil: table.validUntil },
  } };
}

export async function loadPlanningStructureSelection(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, query: PlanningStructureQuery): Promise<Result> {
  if (!context.authorized || !context.actorProfileId) return { status: "forbidden" };
  if (query.area === "children") return loadStructureChildren(supabase, context, query);
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
    const request = supabase.rpc("planning_structure_selection", { p_actor_profile_id: context.actorProfileId, p_limit: query.limit,
      p_offset: cursor?.offset ?? 0, p_source_revision: cursor?.source ?? null, p_evaluated_at: cursor?.observedAt ?? null, p_valid_until: cursor?.validUntil ?? null });
    const result = await (context.signal ? request.abortSignal(context.signal) : request);
    if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
    const selected = result.data;
    if (selected?.status === "forbidden" || selected?.status === "staleContinuation") return { status: selected.status };
    if (selected?.status !== "ready" || !ids(selected.item_ids) || !ids(selected.context_ids)
      || selected.item_ids.length > query.limit || selected.context_ids.length > query.limit * 3
      || selected.context_ids.some((id: string) => selected.item_ids.includes(id))
      || !Number.isSafeInteger(selected.total) || selected.total < 0 || selected.item_ids.length !== Math.min(query.limit, Math.max(0, selected.total - (cursor?.offset ?? 0)))
      || typeof selected.source_revision !== "string" || !selected.source_revision || !Number.isFinite(Date.parse(selected.observed_at)) || !Number.isFinite(Date.parse(selected.valid_until))) return { status: "unavailable" };
    if (cursor && (selected.source_revision !== cursor.source || selected.observed_at !== cursor.observedAt || selected.valid_until !== cursor.validUntil)) return { status: "staleContinuation" };
    const hydrated = await hydrateBacklogItems(supabase, context, [...selected.item_ids, ...selected.context_ids], { hierarchyRoots: true });
    if (!hydrated || selected.item_ids.some((id: string) => hydrated.items.find(item => item.id === id)?.taskType !== "initiative")) return { status: "unavailable" };
    const publication = await context.publicationSource.read(context.signal);
    if (publication.status !== "ready") return { status: publication.status };
    if (context.signal?.aborted) return { status: "unavailable" };
    if (deadline <= Date.now()) return { status: "forbidden" };
    if (publication.revision !== selected.source_revision || Date.parse(selected.valid_until) <= Date.now()) return { status: "staleContinuation" };
    const offset = (cursor?.offset ?? 0) + selected.item_ids.length;
    const next = { offset, source: selected.source_revision, observedAt: selected.observed_at, validUntil: selected.valid_until, deadline };
    return { status: "ready", authorityDeadline: deadline, model: {
      revision: selected.source_revision, items: hydrated.items, people: hydrated.people,
      taskOmittedFields: planningCardOmittedFields.filter(field => field !== "description" && field !== "strategy"),
      structure: { query, itemIds: selected.item_ids, contextIds: selected.context_ids, total: selected.total,
        coverage: offset >= selected.total ? "complete" : "partial", continuation: offset >= selected.total ? null : Buffer.from(JSON.stringify({ ...next, binding: signature(context, query, next) })).toString("base64url"),
        sourceRevision: selected.source_revision, observedAt: selected.observed_at, validUntil: selected.valid_until,
        scopeRevision: createHash("sha256").update(JSON.stringify([query.area, selected.source_revision])).digest("hex"),
      },
    } };
  } catch { return { status: "unavailable" }; }
}
