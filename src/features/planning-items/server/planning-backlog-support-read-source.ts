import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BacklogLoadResult } from "@/features/backlog/model/backlog-read-model";
import { validBacklogControls, validBacklogBuckets, type BacklogSupportQuery } from "@/features/backlog/model/backlog-support";
import type { PlanningWorkspaceLoadContext } from "../model/planning-workspace-model";

export async function loadPlanningBacklogSupport(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, query: BacklogSupportQuery): Promise<BacklogLoadResult> {
  if (!context.authorized || !context.actorProfileId) return { status: "forbidden" };
  if (!context.authorityDeadline || !context.publicationSource) return { status: "unavailable" };
  if (context.authorityDeadline <= Date.now()) return { status: "forbidden" };
  try {
    const request = supabase.rpc("planning_backlog_support", { p_actor_profile_id: context.actorProfileId, p_area: query.area, p_day: query.day });
    const result = await (context.signal ? request.abortSignal(context.signal) : request);
    if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
    const basis = result.data;
    if (basis?.status === "forbidden") return { status: "forbidden" };
    if (basis?.status !== "ready" || typeof basis.source_revision !== "string" || !basis.source_revision
      || !Number.isFinite(Date.parse(basis.observed_at)) || !Number.isFinite(Date.parse(basis.valid_until))
      || query.area === "controls" && !validBacklogControls(basis.controls)
      || query.area === "sprints" && !validBacklogBuckets(basis.buckets)) return { status: "unavailable" };
    const deadline = Math.min(context.authorityDeadline, Date.parse(basis.valid_until));
    if (deadline <= Date.now()) return { status: "unavailable" };
    const publication = await context.publicationSource.read(context.signal);
    if (publication.status !== "ready") return { status: publication.status };
    if (publication.revision !== basis.source_revision) return { status: "staleContinuation" };
    if (context.signal?.aborted || deadline <= Date.now()) return { status: "unavailable" };
    const receipt = { coverage: "complete" as const, sourceRevision: basis.source_revision,
      scopeRevision: createHash("sha256").update(JSON.stringify([query, basis.source_revision])).digest("hex"),
      observedAt: basis.observed_at, validUntil: new Date(deadline).toISOString() };
    return { status: "ready", authorityDeadline: deadline, model: {
      revision: basis.source_revision, coverage: { items: "partial", people: "partial", sprints: "partial", commitments: "partial", strategies: "partial", raci: "partial", links: "partial" },
      items: [], people: [], sprints: [], commitments: [],
      ...(query.area === "controls" ? { controls: { ...basis.controls, ...receipt } } : { sprintBasis: { ...receipt, day: query.day, buckets: basis.buckets } }),
    } };
  } catch { return { status: "unavailable" }; }
}
