import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { emptyPlanningData } from "@/lib/planning-data";
import { mapLegacyMilestoneFromEpic, mapLegacyPackageFromInitiative } from "@/lib/planning-profile-mappers";
import type { PlanningData } from "@/lib/types";

export function planningWorkspaceModelToPlanningData(model: PlanningWorkspaceModel): PlanningData {
  return {
    ...emptyPlanningData,
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
