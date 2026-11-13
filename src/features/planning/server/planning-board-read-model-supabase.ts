import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningBoardReadModel } from "@/features/planning/model/planning-board-read-model";
import { loadPlanningWorkspaceModel } from "@/features/planning-items/server/planning-workspace-read-source";
import { loadPlanningDeliverableBoard } from "@/features/planning-items/server/planning-deliverable-read-source";
import { normalizePlanningBoardQuery } from "../model/planning-board-query";

export function createSupabasePlanningBoardReadModel(supabase: SupabaseClient): PlanningBoardReadModel {
  // Earlier browser clients omit scope and search the complete authorized collection locally.
  return { load: (context) => {
    const query = context.query || { view: "complete" as const };
    const normalized = normalizePlanningBoardQuery(query);
    return normalized.view === "board" && normalized.level === "deliverable"
      ? loadPlanningDeliverableBoard(supabase, { ...context, query })
      : loadPlanningWorkspaceModel(supabase, { ...context, query });
  } };
}
