import type { PlanningWorkspaceLoadContext, PlanningWorkspaceLoadResult } from "@/features/planning-items/model/planning-workspace-model";

export interface StrategicPlanningReadModel {
  load(context: PlanningWorkspaceLoadContext): Promise<PlanningWorkspaceLoadResult>;
}
