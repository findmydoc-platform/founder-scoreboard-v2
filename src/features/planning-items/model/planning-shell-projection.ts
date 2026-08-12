import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { mapLegacyMilestoneFromEpic, mapLegacyPackageFromInitiative } from "@/lib/planning-profile-mappers";
import type { PlanningShellState } from "@/lib/types";

export function planningWorkspaceModelToPlanningShellState(model: PlanningWorkspaceModel): PlanningShellState {
  return {
    ...emptyPlanningShellState,
    project: model.project,
    profiles: [...model.people],
    packages: model.items.filter((item) => item.taskType === "initiative").map(mapLegacyPackageFromInitiative),
    milestones: model.items.filter((item) => item.taskType === "epic").map(mapLegacyMilestoneFromEpic),
    tasks: [...model.items],
    sprints: [...model.sprints],
    taskRelations: [...model.relationships],
    profileUiPreferences: [...model.preferences],
  };
}
