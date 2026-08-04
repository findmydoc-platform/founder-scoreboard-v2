import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { mapLegacyMilestoneFromEpic, mapLegacyPackageFromInitiative } from "@/lib/planning-profile-mappers";
import {
  taskRowSelect,
  type DbPlanningItemRaciAssignment,
  type DbPlanningItemStrategy,
  type DbTask,
} from "@/lib/planning-data-row-types";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import type { Milestone, Package, Task } from "@/lib/types";

type StrategicTaskType = "epic" | "initiative";

export type CanonicalStrategicItem = {
  id: string;
  raw: DbTask;
  task: Task;
};

function legacySourceKind(taskType: StrategicTaskType) {
  return taskType === "epic" ? "milestone" : "package";
}

/**
 * Resolves a retained Milestone/Package id to its canonical Task id.  New
 * callers already use the Task id, so the direct lookup remains the fast
 * path.  The old id is never written back into the active model.
 */
export async function resolveCanonicalStrategicItemId(
  supabase: SupabaseClient,
  candidateId: string,
  taskType: StrategicTaskType,
) {
  const id = candidateId.trim();
  if (!id) return null;

  const { data: direct, error: directError } = await supabase
    .from("tasks")
    .select("id")
    .eq("id", id)
    .eq("task_type", taskType)
    .maybeSingle<{ id: string }>();
  if (directError) throw new Error(directError.message);
  if (direct) return direct.id;

  const { data: legacy, error: legacyError } = await supabase
    .from("planning_item_legacy_ids")
    .select("task_id")
    .eq("source_kind", legacySourceKind(taskType))
    .eq("legacy_id", id)
    .maybeSingle<{ task_id: string }>();
  if (legacyError) throw new Error(legacyError.message);
  return legacy?.task_id || null;
}

export async function loadCanonicalStrategicItem(
  supabase: SupabaseClient,
  candidateId: string,
  taskType: StrategicTaskType,
  options: { includeTrashed?: boolean } = {},
): Promise<CanonicalStrategicItem | null> {
  const id = await resolveCanonicalStrategicItemId(supabase, candidateId, taskType);
  if (!id) return null;

  let taskQuery = supabase
    .from("tasks")
    .select(taskRowSelect)
    .eq("id", id)
    .eq("task_type", taskType);
  if (!options.includeTrashed) taskQuery = taskQuery.is("trashed_at", null);
  const { data: row, error } = await taskQuery.maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null;

  const [strategyResult, raciResult] = taskType === "initiative"
    ? await Promise.all([
        supabase
          .from("planning_item_strategy")
          .select("task_id,goal,success_criteria,scope_constraints")
          .eq("task_id", id)
          .maybeSingle<DbPlanningItemStrategy>(),
        supabase
          .from("planning_item_raci_assignments")
          .select("task_id,profile_id,role,sort_order")
          .eq("task_id", id)
          .order("sort_order")
          .returns<DbPlanningItemRaciAssignment[]>(),
      ])
    : [{ data: null, error: null }, { data: [], error: null }];
  if (strategyResult.error) throw new Error(strategyResult.error.message);
  if (raciResult.error) throw new Error(raciResult.error.message);

  const raw = row as unknown as DbTask;
  return {
    id,
    raw,
    task: mapTaskRow(raw, new Map(), {
      strategy: strategyResult.data || undefined,
      raciAssignments: raciResult.data || [],
    }),
  };
}

export function legacyInitiativeFromCanonical(item: CanonicalStrategicItem): Package {
  return mapLegacyPackageFromInitiative(item.task);
}

export function legacyMilestoneFromCanonical(item: CanonicalStrategicItem): Milestone {
  return mapLegacyMilestoneFromEpic(item.task);
}
