import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { PlanningShellState } from "@/lib/types";

export function backlogModelToPlanningShellState(model: BacklogModel): PlanningShellState {
  return {
    ...emptyPlanningShellState,
    profiles: [...model.people],
    tasks: [...model.items],
    sprints: [...model.sprints],
    sprintCommitments: [...model.commitments],
  };
}
