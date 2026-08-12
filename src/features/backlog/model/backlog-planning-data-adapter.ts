import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import { emptyPlanningData } from "@/lib/planning-data";
import { mapLegacyMilestoneFromEpic, mapLegacyPackageFromInitiative } from "@/lib/planning-profile-mappers";
import type { PlanningData } from "@/lib/types";

export function backlogModelToPlanningData(model: BacklogModel): PlanningData {
  return {
    ...emptyPlanningData,
    profiles: [...model.people],
    packages: model.items.filter((item) => item.taskType === "initiative").map(mapLegacyPackageFromInitiative),
    milestones: model.items.filter((item) => item.taskType === "epic").map(mapLegacyMilestoneFromEpic),
    tasks: [...model.items],
    sprints: [...model.sprints],
    sprintCommitments: [...model.commitments],
  };
}
