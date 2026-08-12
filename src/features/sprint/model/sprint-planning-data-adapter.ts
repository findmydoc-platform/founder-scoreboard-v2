import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import { emptyPlanningData } from "@/lib/planning-data";
import { mapLegacyMilestoneFromEpic, mapLegacyPackageFromInitiative } from "@/lib/planning-profile-mappers";
import type { PlanningData } from "@/lib/types";

export function sprintWorkspaceModelToPlanningData(model: SprintWorkspaceModel): PlanningData {
  return {
    ...emptyPlanningData,
    project: model.project,
    profiles: [...model.people],
    tasks: [...model.items],
    packages: model.items.filter((item) => item.taskType === "initiative").map(mapLegacyPackageFromInitiative),
    milestones: model.items.filter((item) => item.taskType === "epic").map(mapLegacyMilestoneFromEpic),
    sprints: [...model.sprints],
    sprintCommitments: [...model.commitments],
    founderSprintScores: [...model.scores],
    founderStrikeStates: [...model.strikeStates],
    strikeEvents: [...model.strikeEvents],
    scoreObjections: [...model.objections],
    meetings: [...model.meetings],
    meetingAttendance: [...model.attendance],
  };
}
