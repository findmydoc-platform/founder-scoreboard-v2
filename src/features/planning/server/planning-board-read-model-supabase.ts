import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningBoardReadModel } from "@/features/planning/model/planning-board-read-model";
import { loadPlanningWorkspaceModel } from "@/features/planning-items/server/planning-workspace-read-source";

export function createSupabasePlanningBoardReadModel(supabase: SupabaseClient): PlanningBoardReadModel {
  return { load: (context) => loadPlanningWorkspaceModel(supabase, context) };
}
