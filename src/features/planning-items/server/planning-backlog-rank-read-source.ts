import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BacklogLoadResult } from "@/features/backlog/model/backlog-read-model";
import type { BacklogRankQuery } from "@/features/backlog/model/backlog-rank-target";
import type { PlanningWorkspaceLoadContext } from "../model/planning-workspace-model";
import { hydrateBacklogItems } from "./planning-backlog-read-source";
import { planningCardOmittedFields } from "./planning-card-summary";

export async function loadPlanningBacklogRankTarget(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, query: BacklogRankQuery): Promise<BacklogLoadResult> {
  if (!context.authorized || !context.actorProfileId) return { status: "forbidden" };
  if (!context.authorityDeadline || !context.publicationSource) return { status: "unavailable" };
  if (context.authorityDeadline <= Date.now()) return { status: "forbidden" };
  try {
    const request = supabase.rpc("planning_backlog_rank_target", { p_actor_profile_id: context.actorProfileId, p_source_id: query.sourceId,
      p_source_updated_at: query.sourceUpdatedAt, p_source_revision: query.sourceRevision, p_action: query.action });
    const result = await (context.signal ? request.abortSignal(context.signal) : request);
    if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
    const basis = result.data;
    if (basis?.status === "forbidden" || basis?.status === "staleContinuation") return { status: basis.status };
    if (basis?.status !== "ready" || basis.source_revision !== query.sourceRevision
      || !Number.isFinite(Date.parse(basis.observed_at)) || !Number.isFinite(Date.parse(basis.valid_until))
      || typeof basis.noop !== "boolean" || basis.noop !== (basis.target_id === null)
      || !basis.noop && (typeof basis.target_id !== "string" || !basis.target_id || basis.target_id === query.sourceId
        || basis.placement !== (query.action === "up" || query.action === "top" ? "before" : "after"))
      || basis.noop && basis.placement !== null) return { status: "unavailable" };
    const deadline = Math.min(context.authorityDeadline, Date.parse(basis.valid_until));
    const hydrated = await hydrateBacklogItems(supabase, context, basis.noop ? [] : [basis.target_id]);
    if (!hydrated || hydrated.items.some(item => item.taskType !== "deliverable")) return { status: "unavailable" };
    const publication = await context.publicationSource.read(context.signal);
    if (publication.status !== "ready") return { status: publication.status };
    if (publication.revision !== basis.source_revision) return { status: "staleContinuation" };
    if (context.signal?.aborted || deadline <= Date.now()) return { status: "unavailable" };
    return { status: "ready", authorityDeadline: deadline, model: {
      revision: basis.source_revision, taskOmittedFields: planningCardOmittedFields,
      coverage: { items: "partial", people: "partial", sprints: "partial", commitments: "partial", strategies: "partial", raci: "partial", links: "partial" },
      ...hydrated, commitments: [], rankTarget: { ...query, targetId: basis.target_id, placement: basis.placement, noop: basis.noop,
        scopeRevision: createHash("sha256").update(JSON.stringify([query, basis.source_revision])).digest("hex"),
        observedAt: basis.observed_at, validUntil: new Date(deadline).toISOString() },
    } };
  } catch { return { status: "unavailable" }; }
}
