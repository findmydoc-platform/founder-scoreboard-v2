import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningGanttQuery } from "@/features/planning/model/planning-gantt-query";
import { planningGanttQueryKey } from "@/features/planning/model/planning-gantt-query";
import type { PlanningWorkspaceLoadContext, PlanningWorkspaceLoadResult } from "../model/planning-workspace-model";
import type { DbProfile, DbSprint, DbTask, DbTaskRelation } from "@/lib/planning-row-types";
import { mapProfile } from "@/lib/planning-profile-mappers";
import { mapSprint } from "@/lib/planning-sprint-mappers";
import { mapTaskRelation } from "@/lib/planning-row-mappers";
import { mapPlanningItemRows, mapPlanningProject } from "./planning-workspace-read-source";
import { compactPlanningCard, planningCardOmittedFields } from "./planning-card-summary";

type Selection = {
  status: string; source_revision: string; evaluated_at: string; temporal_key: string; valid_until: string | null;
  total: number; card_ids: string[]; context_ids: string[]; rows: DbTask[];
  profiles: DbProfile[]; sprints: DbSprint[]; relationships: DbTaskRelation[];
  fallback_sprint_id: string | null; project: Parameters<typeof mapPlanningProject>[0];
};
const ids = (value: unknown): value is string[] => Array.isArray(value)
  && value.every(id => typeof id === "string" && id.length > 0) && new Set(value).size === value.length;
const omittedFields = [...planningCardOmittedFields, "dependsOn", "evidenceLink"] as const;

export async function loadPlanningGantt(supabase: SupabaseClient, context: PlanningWorkspaceLoadContext, query: PlanningGanttQuery): Promise<PlanningWorkspaceLoadResult> {
  if (!context.authorized || !context.actorProfileId || !context.actorUserId) return { status: "forbidden" };
  if (!context.authorityDeadline || !context.publicationSource) return { status: "unavailable" };
  if (context.authorityDeadline <= Date.now()) return { status: "forbidden" };
  try {
    const read = supabase.rpc("planning_gantt_selection", { p_actor_profile_id: context.actorProfileId,
      p_actor_user_id: context.actorUserId, p_filters: query.filters, p_evaluated_at: null });
    const result = await (context.signal ? read.abortSignal(context.signal) : read);
    if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
    const selected: Selection = result.data;
    if (selected?.status === "forbidden" || selected?.status === "staleContinuation") return { status: selected.status };
    if (selected?.status !== "ready" || typeof selected.source_revision !== "string" || !selected.source_revision
      || typeof selected.evaluated_at !== "string" || !Number.isFinite(Date.parse(selected.evaluated_at))
      || typeof selected.temporal_key !== "string" || !selected.temporal_key
      || selected.valid_until !== null && (typeof selected.valid_until !== "string" || !Number.isFinite(Date.parse(selected.valid_until)))
      || !ids(selected.card_ids) || !ids(selected.context_ids) || !Number.isSafeInteger(selected.total) || selected.total !== selected.card_ids.length
      || !Array.isArray(selected.rows) || !Array.isArray(selected.profiles) || !Array.isArray(selected.sprints) || !Array.isArray(selected.relationships)
      || !selected.project || selected.project.id !== "findmydoc-founder-execution") return { status: "unavailable" };
    const selectedIds = new Set(selected.card_ids), contextIds = new Set(selected.context_ids);
    if (selected.card_ids.some(id => !contextIds.has(id)) || selected.rows.length !== contextIds.size
      || new Set(selected.rows.map(row => row?.id)).size !== selected.rows.length
      || selected.rows.some(row => !row || !contextIds.has(row.id) || row.trashed_at
        || typeof row.title !== "string" || typeof row.updated_at !== "string"
        || selectedIds.has(row.id) && (row.task_type !== "deliverable" || row.approval_status !== "approved"))) return { status: "unavailable" };
    const peopleIds = new Set(selected.rows.flatMap(row => [row.assignee, row.owner, row.created_by, row.review_owner_profile_id]).filter(Boolean));
    const sprintIds = new Set(selected.rows.map(row => row.sprint_id).filter(Boolean));
    if (selected.fallback_sprint_id !== null) {
      if (typeof selected.fallback_sprint_id !== "string" || !selected.fallback_sprint_id) return { status: "unavailable" };
      sprintIds.add(selected.fallback_sprint_id);
    }
    if (new Set(selected.profiles.map(row => row?.id)).size !== selected.profiles.length
      || selected.profiles.some(row => !row || !peopleIds.has(row.id) || typeof row.name !== "string")
      || new Set(selected.sprints.map(row => row?.id)).size !== selected.sprints.length
      || selected.sprints.length !== sprintIds.size || selected.sprints.some(row => !row || !sprintIds.has(row.id))
      || new Set(selected.relationships.map(row => row?.id)).size !== selected.relationships.length
      || selected.relationships.some(row => !row || !contextIds.has(row.task_id) || !contextIds.has(row.related_task_id)
        || !selectedIds.has(row.task_id) && !selectedIds.has(row.related_task_id)
        || !["blocked_by", "blocks", "relates_to"].includes(row.relation_type))) return { status: "unavailable" };
    const people = selected.profiles.map(mapProfile);
    const items = mapPlanningItemRows(selected.rows, people, [], [], []).map(task => compactPlanningCard(task, omittedFields));
    const publication = await context.publicationSource.read(context.signal);
    if (publication.status !== "ready") return { status: publication.status };
    if (context.signal?.aborted) return { status: "unavailable" };
    if (context.authorityDeadline <= Date.now()) return { status: "forbidden" };
    if (publication.revision !== selected.source_revision || selected.valid_until !== null && Date.parse(selected.valid_until) <= Date.now()) return { status: "staleContinuation" };
    const deadline = Math.min(context.authorityDeadline, selected.valid_until === null ? Infinity : Date.parse(selected.valid_until));
    return { status: "ready", authorityDeadline: deadline, model: {
      project: mapPlanningProject(selected.project), revision: selected.source_revision, scopeRevision: selected.source_revision,
      items, people, sprints: selected.sprints.map(mapSprint), relationships: selected.relationships.map(mapTaskRelation), preferences: [],
      coverage: { items: "partial", people: "partial", sprints: "partial", relationships: "partial", preferences: "partial", strategies: "partial", raci: "partial", links: "partial", blockers: "partial" },
      taskOmittedFields: omittedFields,
      gantt: { query, queryKey: planningGanttQueryKey(query), itemIds: selected.card_ids,
        contextIds: selected.context_ids.filter(id => !selectedIds.has(id)), total: selected.total,
        coverage: { items: "complete", hierarchy: "complete", schedule: "complete", relationships: "complete" },
        sourceRevision: selected.source_revision, observedAt: selected.evaluated_at, temporalKey: selected.temporal_key, validUntil: selected.valid_until },
    } };
  } catch { return { status: "unavailable" }; }
}
