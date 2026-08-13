import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { PlanningShellState } from "@/lib/types";

export function planningWorkspaceModelToPlanningShellState(model: PlanningWorkspaceModel): PlanningShellState {
  return {
    ...emptyPlanningShellState,
    project: model.project,
    profiles: [...model.people],
    tasks: [...model.items],
    sprints: [...model.sprints],
    taskRelations: [...model.relationships],
    profileUiPreferences: [...model.preferences],
  };
}
