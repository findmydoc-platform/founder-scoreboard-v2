import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { mapLegacyMilestoneFromEpic, mapLegacyPackageFromInitiative } from "@/lib/planning-profile-mappers";
import type { PlanningShellState } from "@/lib/types";

export function sprintWorkspaceModelToPlanningShellState(model: SprintWorkspaceModel): PlanningShellState {
  return {
    ...emptyPlanningShellState,
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
