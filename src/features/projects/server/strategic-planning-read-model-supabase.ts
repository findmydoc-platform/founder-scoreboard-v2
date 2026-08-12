import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StrategicPlanningReadModel } from "@/features/projects/model/strategic-planning-read-model";
import { loadPlanningWorkspaceModel } from "@/features/planning-items/server/planning-workspace-read-source";

export function createSupabaseStrategicPlanningReadModel(supabase: SupabaseClient): StrategicPlanningReadModel {
  return { load: (context) => loadPlanningWorkspaceModel(supabase, context) };
}
