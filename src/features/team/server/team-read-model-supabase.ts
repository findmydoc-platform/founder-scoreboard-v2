import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPlanningItemsForReadModel, planningProfileSelect } from "@/features/planning-items/server/planning-workspace-read-source";
import { mapProfile } from "@/lib/planning-profile-mappers";
import type { DbProfile } from "@/lib/planning-row-types";
import type { PlanningWorkspaceLoadContext } from "@/features/planning-items/model/planning-workspace-model";
import type { TeamLoadResult, TeamReadModel } from "@/features/team/model/team-read-model";

export function createSupabaseTeamReadModel(supabase: SupabaseClient): TeamReadModel {
  return {
    async load(context) {
      if (!context.authorized) return { status: "forbidden" };
      const state = await loadPlanningItemsForReadModel(supabase);
      if (!state) return { status: "unavailable" };
      return {
        status: "ready",
        model: {
          revision: state.items.reduce<string>((latest, item) => item.updatedAt && item.updatedAt > latest ? item.updatedAt : latest, ""),
          readCoverage: state.readCoverage,
          people: state.people,
          items: state.items,
        },
      };
    },
  };
}

export async function loadSupabaseTeamPeople(supabase: SupabaseClient, context: Pick<PlanningWorkspaceLoadContext, "authorized" | "actorProfileId" | "authorityDeadline" | "publicationSource" | "signal"> & { publicationBarrier?: Promise<unknown> }): Promise<TeamLoadResult> {
  if (!context.authorized || !context.actorProfileId) return { status: "forbidden" };
  if (!context.publicationSource || !context.authorityDeadline) return { status: "unavailable" };
  if (context.authorityDeadline <= Date.now()) return { status: "forbidden" };
  const source = await context.publicationSource.read(context.signal);
  if (source.status !== "ready") return { status: source.status };
  const observedAt = new Date().toISOString(), rows: DbProfile[] = [];
  let expectedCount: number | undefined;
  do {
    const query = supabase.from("profiles").select(planningProfileSelect, { count: "exact" }).order("name").order("id").range(rows.length, rows.length + 999);
    const page = await (context.signal ? query.abortSignal(context.signal) : query);
    if (page.error) return { status: page.status === 401 || page.status === 403 ? "forbidden" : "unavailable" };
    if (!Array.isArray(page.data) || typeof page.count !== "number" || !Number.isSafeInteger(page.count) || page.count < 0
      || expectedCount !== undefined && page.count !== expectedCount) return { status: "unavailable" };
    expectedCount = page.count;
    if (!page.data.length && rows.length < expectedCount) return { status: "unavailable" };
    rows.push(...page.data);
    if (rows.length > expectedCount || new Set(rows.map(row => row.id)).size !== rows.length) return { status: "unavailable" };
  } while (rows.length < expectedCount);
  if (!rows.some(row => row.id === context.actorProfileId)) return { status: "forbidden" };
  if (rows.some(row => typeof row.id !== "string" || !row.id || typeof row.name !== "string")) return { status: "unavailable" };
  // SSR waits for its independent Header slots before the only final publication check.
  if (context.publicationBarrier) await context.publicationBarrier;
  const publication = await context.publicationSource.read(context.signal);
  if (publication.status !== "ready") return { status: publication.status };
  if (context.signal?.aborted || publication.revision !== source.revision) return { status: "unavailable" };
  if (context.authorityDeadline <= Date.now()) return { status: "forbidden" };
  return { status: "ready", model: { revision: source.revision, scopeRevision: source.revision, observedAt,
    people: rows.map(mapProfile), items: [], readCoverage: { people: "complete", items: "partial", strategies: "partial", raci: "partial", links: "partial" } } };
}
