import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningBoardReadModel } from "@/features/planning/model/planning-board-read-model";
import { loadPlanningWorkspaceModel } from "@/features/planning-items/server/planning-workspace-read-source";

export function createSupabasePlanningBoardReadModel(supabase: SupabaseClient): PlanningBoardReadModel {
  // Earlier browser clients omit scope and search the complete authorized collection locally.
  return { load: (context) => loadPlanningWorkspaceModel(supabase, { ...context, query: context.query || { view: "complete" } }) };
}
