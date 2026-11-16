import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BacklogLoadResult } from "@/features/backlog/model/backlog-read-model";
import type { BacklogControls, BacklogSprintBasis, BacklogSupportQuery } from "@/features/backlog/model/backlog-support";
import type { PlanningWorkspaceLoadContext } from "../model/planning-workspace-model";

function options(value: unknown): boolean {
  return Array.isArray(value) && value.every(option => option && typeof option.value === "string" && option.value && typeof option.label === "string")
    && new Set(value.map(option => option.value)).size === value.length;
}
function validControls(value: BacklogControls | undefined) {
  return value && ["epic", "initiative", "deliverable"].every(level => {
    const key = level as keyof BacklogControls["levelTotals"];
    return Number.isSafeInteger(value.levelTotals?.[key]) && value.levelTotals[key] >= 0
      && Array.isArray(value.statuses?.[key]) && value.statuses[key].every(status => typeof status === "string");
  }) && [value.assignees, value.epics, value.initiatives].every(options);
}
function validBuckets(value: unknown): value is BacklogSprintBasis["buckets"] {
  return Array.isArray(value) && value.length <= 5 && new Set(value.map(bucket => bucket?.sprint?.id)).size === value.length
    && value.every(bucket => bucket?.sprint && typeof bucket.sprint.id === "string" && typeof bucket.sprint.name === "string"
      && ["planning", "active", "review"].includes(bucket.sprint.status) && typeof bucket.sprint.startDate === "string" && typeof bucket.sprint.endDate === "string"
      && typeof bucket.sprint.scoreLocked === "boolean" && typeof bucket.sprint.updatedAt === "string"
      && typeof bucket.isCurrent === "boolean" && bucket.locked === bucket.sprint.scoreLocked
      && Number.isFinite(bucket.plannedHours) && bucket.plannedHours >= 0 && bucket.plannedHoursComplete === true
      && (bucket.capacityHours === null || Number.isFinite(bucket.capacityHours) && bucket.capacityHours >= 0)
      && bucket.capacityUnavailable === (bucket.capacityHours === null)
      && Number.isFinite(bucket.overCapacityHours) && bucket.overCapacityHours >= 0 && typeof bucket.overCapacity === "boolean"
      && Number.isFinite(bucket.utilization) && bucket.utilization >= 0);
}

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
      || query.area === "controls" && !validControls(basis.controls)
      || query.area === "sprints" && !validBuckets(basis.buckets)) return { status: "unavailable" };
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
