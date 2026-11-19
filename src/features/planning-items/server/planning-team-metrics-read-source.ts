import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TeamMetricsLoadResult, TeamMetricsModel } from "@/features/team/model/team-read-model";
import type { PlanningWorkspaceLoadContext } from "../model/planning-workspace-model";

type MetricsFrame = { status: string; source_revision: string; evaluated_at: string; valid_until: null; coverage: string; metrics_by_profile_id: TeamMetricsModel["metricsByProfileId"] };
export async function loadPlanningTeamMetrics(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext): Promise<TeamMetricsLoadResult> {
  if (!context.authorized || !context.actorProfileId || !context.actorUserId) return { status: "forbidden" };
  if (!context.publicationSource || !context.authorityDeadline) return { status: "unavailable" };
  if (context.authorityDeadline <= Date.now()) return { status: "forbidden" };
  const read = supabase.rpc("planning_team_metrics", { p_actor_profile_id: context.actorProfileId, p_actor_user_id: context.actorUserId, p_evaluated_at: null });
  const result = await (context.signal ? read.abortSignal(context.signal) : read);
  if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
  const frame: MetricsFrame = result.data;
  if (frame?.status === "forbidden") return { status: "forbidden" };
  const metrics = frame?.metrics_by_profile_id;
  if (frame?.status !== "ready" || frame.coverage !== "complete" || !frame.source_revision || typeof frame.source_revision !== "string"
    || !Number.isFinite(Date.parse(frame.evaluated_at)) || frame.valid_until !== null
    || !metrics || typeof metrics !== "object" || Array.isArray(metrics) || !Object.hasOwn(metrics, context.actorProfileId)
    || Object.entries(metrics).some(([id, value]) => !id || !value || !Number.isSafeInteger(value.openTasks) || value.openTasks < 0
      || !Number.isSafeInteger(value.highPriorityTasks) || value.highPriorityTasks < 0 || value.highPriorityTasks > value.openTasks
      || !Number.isSafeInteger(value.loadHours))) return { status: "unavailable" };
  const publication = await context.publicationSource.read(context.signal);
  if (publication.status !== "ready") return { status: publication.status };
  if (context.signal?.aborted) return { status: "unavailable" };
  if (context.authorityDeadline <= Date.now()) return { status: "forbidden" };
  if (publication.revision !== frame.source_revision) return { status: "staleContinuation" };
  return { status: "ready", model: { revision: frame.source_revision, scopeRevision: frame.source_revision, observedAt: frame.evaluated_at,
    validUntil: null, coverage: "complete", metricsByProfileId: Object.fromEntries(Object.entries(metrics).map(([id, value]) => [id, { openTasks: value.openTasks, highPriorityTasks: value.highPriorityTasks, loadHours: value.loadHours }])) } };
}
