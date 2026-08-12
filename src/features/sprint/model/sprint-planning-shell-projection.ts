import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { PlanningShellState } from "@/lib/types";

export function sprintWorkspaceModelToPlanningShellState(model: SprintWorkspaceModel): PlanningShellState {
  return {
    ...emptyPlanningShellState,
    project: model.project,
    profiles: [...model.people],
    tasks: [...model.items],
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
