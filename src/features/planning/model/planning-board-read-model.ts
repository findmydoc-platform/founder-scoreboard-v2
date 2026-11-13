import type { PlanningWorkspaceLoadContext, PlanningWorkspaceLoadResult } from "@/features/planning-items/model/planning-workspace-model";

export interface PlanningBoardReadModel {
  load(context: PlanningWorkspaceLoadContext): Promise<PlanningWorkspaceLoadResult>;
}

export interface PlanningProgressiveBoardReadModel extends PlanningBoardReadModel {
  startQuery(context: PlanningWorkspaceLoadContext): Promise<import("./planning-board-delivery").PlanningBoardQueryLoadResult>;
}
