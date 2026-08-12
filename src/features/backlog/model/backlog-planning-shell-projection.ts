import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { mapLegacyMilestoneFromEpic, mapLegacyPackageFromInitiative } from "@/lib/planning-profile-mappers";
import type { PlanningShellState } from "@/lib/types";

export function backlogModelToPlanningShellState(model: BacklogModel): PlanningShellState {
  return {
    ...emptyPlanningShellState,
    profiles: [...model.people],
    packages: model.items.filter((item) => item.taskType === "initiative").map(mapLegacyPackageFromInitiative),
    milestones: model.items.filter((item) => item.taskType === "epic").map(mapLegacyMilestoneFromEpic),
    tasks: [...model.items],
    sprints: [...model.sprints],
    sprintCommitments: [...model.commitments],
  };
}
