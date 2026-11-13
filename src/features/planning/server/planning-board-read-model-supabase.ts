import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningProgressiveBoardReadModel } from "@/features/planning/model/planning-board-read-model";
import { loadPlanningWorkspaceModel } from "@/features/planning-items/server/planning-workspace-read-source";
import { loadPlanningDeliverableBoard, startPlanningDeliverableQuery } from "@/features/planning-items/server/planning-deliverable-read-source";
import { normalizePlanningBoardQuery } from "../model/planning-board-query";

export function createSupabasePlanningBoardReadModel(supabase: SupabaseClient): PlanningProgressiveBoardReadModel {
  // Earlier browser clients omit scope and search the complete authorized collection locally.
  return { startQuery: (context) => {
    const query = context.query || { view: "complete" as const };
    const normalized = normalizePlanningBoardQuery(query);
    return normalized.view === "board" && normalized.level === "deliverable"
      ? startPlanningDeliverableQuery(supabase, { ...context, query })
      : loadPlanningWorkspaceModel(supabase, { ...context, query });
  }, load: (context) => {
    const query = context.query || { view: "complete" as const };
    const normalized = normalizePlanningBoardQuery(query);
    return normalized.view === "board" && normalized.level === "deliverable"
      ? loadPlanningDeliverableBoard(supabase, { ...context, query })
      : loadPlanningWorkspaceModel(supabase, { ...context, query });
  } };
}
