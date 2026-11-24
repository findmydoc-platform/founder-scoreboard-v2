import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningBoardReadModel } from "@/features/planning/model/planning-board-read-model";
import { loadPlanningWorkspaceModel } from "@/features/planning-items/server/planning-workspace-read-source";

// Preserve the complete pre-selection TypeScript reference independently from
// the SQL adapter. Mock-provider reference cases are not real SQL evidence.
export function createCompletePlanningReference(supabase: SupabaseClient): PlanningBoardReadModel {
  return { load: context => loadPlanningWorkspaceModel(supabase, { ...context, query: context.query || { view: "complete" } }) };
}
