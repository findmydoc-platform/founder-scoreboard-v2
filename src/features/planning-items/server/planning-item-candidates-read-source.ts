import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningItemCandidate, PlanningItemCandidatePage, PlanningItemCandidateQuery } from "../model/planning-item-candidates";
import type { PlanningWorkspaceLoadContext } from "../model/planning-workspace-model";

type Cursor = { offset: number; source: string; observedAt: string; validUntil: string; deadline: number; binding: string };
type CandidateResult = { status: "ready"; candidates: PlanningItemCandidatePage; authorityDeadline: number }
  | { status: "forbidden" | "unavailable" | "staleContinuation" };

function sign(context: PlanningWorkspaceLoadContext, query: PlanningItemCandidateQuery, cursor: Omit<Cursor, "binding">) {
  return createHmac("sha256", context.authorityKey!).update(JSON.stringify(["initiative-candidates-v1", context.actorProfileId, query.kind, query.query, query.limit, cursor])).digest("hex");
}

function validCandidate(value: unknown, kind: PlanningItemCandidateQuery["kind"]): value is PlanningItemCandidate {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && typeof item.title === "string" && item.taskType === kind
    && (kind !== "deliverable" || typeof item.parentTitle === "string" || item.parentTitle === null)
    && typeof item.parentTaskId === "string" && typeof item.approvalStatus === "string" && typeof item.updatedAt === "string";
}

export async function loadPlanningItemCandidates(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, query: PlanningItemCandidateQuery): Promise<CandidateResult> {
  if (!context.authorized || !context.actorProfileId) return { status: "forbidden" };
  if (!context.authorityKey || !context.authorityDeadline || !context.publicationSource) return { status: "unavailable" };
  let cursor: Omit<Cursor, "binding"> | undefined;
  if (query.continuation) {
    try {
      const { binding, ...value } = JSON.parse(Buffer.from(query.continuation, "base64url").toString("utf8")) as Cursor;
      if (!Number.isSafeInteger(value.offset) || value.offset < 1 || typeof value.source !== "string" || !value.source
        || !Number.isFinite(Date.parse(value.observedAt)) || !Number.isFinite(Date.parse(value.validUntil)) || !Number.isFinite(value.deadline)
        || typeof binding !== "string" || !/^[a-f0-9]{64}$/.test(binding)
        || !timingSafeEqual(Buffer.from(binding, "hex"), Buffer.from(sign(context, query, value), "hex"))
        || value.deadline <= Date.now() || Date.parse(value.validUntil) <= Date.now()) return { status: "staleContinuation" };
      cursor = value;
    } catch { return { status: "staleContinuation" }; }
  }
  const deadline = Math.min(context.authorityDeadline, cursor?.deadline ?? Infinity);
  if (deadline <= Date.now()) return { status: "forbidden" };
  try {
    const read = supabase.rpc("planning_item_candidates", { p_actor_profile_id: context.actorProfileId, p_kind: query.kind, p_query: query.query,
      p_limit: query.limit, p_offset: cursor?.offset ?? 0, p_source_revision: cursor?.source ?? null,
      p_evaluated_at: cursor?.observedAt ?? null, p_valid_until: cursor?.validUntil ?? null });
    const result = await (context.signal ? read.abortSignal(context.signal) : read);
    if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
    const page = result.data;
    if (page?.status === "forbidden" || page?.status === "staleContinuation") return { status: page.status };
    if (page?.status !== "ready" || typeof page.source_revision !== "string" || !page.source_revision
      || !Number.isFinite(Date.parse(page.observed_at)) || !Number.isFinite(Date.parse(page.valid_until))
      || !Number.isSafeInteger(page.total) || page.total < 0 || !Array.isArray(page.items) || page.items.length > query.limit
      || page.items.some((item: unknown) => !validCandidate(item, query.kind))
      || query.kind === "epic" && (!("default_candidate" in page) || page.default_candidate !== null && !validCandidate(page.default_candidate, "epic"))
      || new Set(page.items.map((item: { id: string }) => item.id)).size !== page.items.length
      || page.items.length !== Math.min(query.limit, Math.max(0, page.total - (cursor?.offset ?? 0)))) return { status: "unavailable" };
    if (cursor && (page.source_revision !== cursor.source || page.observed_at !== cursor.observedAt || page.valid_until !== cursor.validUntil)) return { status: "staleContinuation" };
    const publication = await context.publicationSource.read(context.signal);
    if (publication.status !== "ready") return { status: publication.status };
    if (context.signal?.aborted) return { status: "unavailable" };
    if (deadline <= Date.now()) return { status: "forbidden" };
    if (publication.revision !== page.source_revision || Date.parse(page.valid_until) <= Date.now()) return { status: "staleContinuation" };
    const offset = (cursor?.offset ?? 0) + page.items.length;
    const next = { offset, source: page.source_revision, observedAt: page.observed_at, validUntil: page.valid_until, deadline };
    const common = { items: page.items, total: page.total,
      coverage: offset >= page.total ? "complete" as const : "partial" as const,
      continuation: offset >= page.total ? null : Buffer.from(JSON.stringify({ ...next, binding: sign(context, query, next) })).toString("base64url"),
      sourceRevision: page.source_revision, observedAt: page.observed_at, validUntil: page.valid_until };
    return { status: "ready", authorityDeadline: deadline, candidates: query.kind === "epic"
      ? { ...common, kind: "epic", defaultCandidate: page.default_candidate } : query.kind === "deliverable" ? { ...common, kind: "deliverable" } : common };
  } catch { return { status: "unavailable" }; }
}
