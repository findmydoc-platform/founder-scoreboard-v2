import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanningMutationTable = "packages" | "tasks";

export type ActivePlanningItemGuardResult =
  | { ok: true }
  | { ok: false; status: 404 | 409 | 500; error: string };

const itemLabels: Record<PlanningMutationTable, string> = {
  packages: "Initiative",
  tasks: "Aufgabe",
};

/**
 * Application-level fail-closed guard for planning mutations.
 * Database triggers remain the final authority for concurrent writes.
 */
export async function requireActivePlanningItem(
  supabase: SupabaseClient,
  table: PlanningMutationTable,
  id: string,
): Promise<ActivePlanningItemGuardResult> {
  const label = itemLabels[table];
  const { data, error } = await supabase
    .from(table)
    .select("id,trashed_at")
    .eq("id", id)
    .maybeSingle<{ id: string; trashed_at: string | null }>();

  if (error) return { ok: false, status: 500, error: error.message };
  if (!data) return { ok: false, status: 404, error: `${label} wurde nicht gefunden.` };
  if (data.trashed_at) {
    return {
      ok: false,
      status: 409,
      error: `${label} befindet sich im Papierkorb und kann nicht geändert werden.`,
    };
  }

  return { ok: true };
}
