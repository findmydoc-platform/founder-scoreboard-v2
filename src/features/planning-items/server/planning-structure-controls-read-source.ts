import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningStructureControlsModel } from "@/features/planning/model/planning-structure-controls";
import type { PlanningWorkspaceLoadContext } from "../model/planning-workspace-model";
const options = (value: unknown, label: "name" | "title"): boolean => Array.isArray(value)
  && value.every(row => row && typeof row.id === "string" && row.id && typeof row[label] === "string")
  && new Set(value.map(row => row.id)).size === value.length;
type Result = { status: "ready"; model: PlanningStructureControlsModel; authorityDeadline: number } | { status: "forbidden" | "unavailable" | "staleContinuation" };
export async function loadPlanningStructureControls(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext): Promise<Result> {
  if (!context.authorized || !context.actorProfileId) return { status: "forbidden" };
  const deadline = context.authorityDeadline;
  if (!deadline || !Number.isFinite(deadline) || !context.publicationSource) return { status: "unavailable" };
  if (deadline <= Date.now()) return { status: "forbidden" };
  try {
    const request = supabase.rpc("planning_structure_controls", { p_actor_profile_id: context.actorProfileId });
    const result = await (context.signal ? request.abortSignal(context.signal) : request);
    if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
    const value = result.data;
    if (value?.status === "forbidden") return { status: "forbidden" };
    if (value?.status !== "ready" || typeof value.source_revision !== "string" || !value.source_revision || !Number.isFinite(Date.parse(value.observed_at))
      || !options(value.people, "name") || !options(value.sprints, "name") || !options(value.initiatives, "title")
      || !Array.isArray(value.workstreams) || value.workstreams.some((row: unknown) => typeof row !== "string" || !row)
      || new Set(value.workstreams).size !== value.workstreams.length) return { status: "unavailable" };
    const source = await context.publicationSource.read(context.signal);
    if (source.status !== "ready") return { status: source.status };
    if (context.signal?.aborted) return { status: "unavailable" };
    if (deadline <= Date.now()) return { status: "forbidden" };
    if (source.revision !== value.source_revision) return { status: "staleContinuation" };
    return { status: "ready", authorityDeadline: deadline, model: { revision: value.source_revision, controls: {
      people: value.people, sprints: value.sprints, initiatives: value.initiatives, workstreams: value.workstreams, coverage: "complete",
      sourceRevision: value.source_revision, scopeRevision: createHash("sha256").update(JSON.stringify(["structure-controls-v1", value.source_revision])).digest("hex"),
      observedAt: value.observed_at, validUntil: new Date(deadline).toISOString(),
    } } };
  } catch { return { status: "unavailable" }; }
}
