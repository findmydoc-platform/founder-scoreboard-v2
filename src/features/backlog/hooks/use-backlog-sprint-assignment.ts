"use client";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { backlogSprintAssignmentMessage, getBacklogSprintAssignmentEligibility } from "../model/backlog-planning-state";
import type { Sprint, Task } from "@/lib/types";
export function useBacklogSprintAssignment({ planningState, canManageBacklog, setMessage, sprintById }: { planningState: PlanningState; canManageBacklog: boolean; setMessage(message: string): void; sprintById?: ReadonlyMap<string, Sprint> }) {
  const assignTaskToSprint = async (task: Task, sprint: Sprint | null) => {
    const eligibility = getBacklogSprintAssignmentEligibility(task, sprint, { canManage: canManageBacklog, sourceSprintLocked: Boolean(task.sprintId && sprintById?.get(task.sprintId)?.scoreLocked) });
    if (!eligibility.ok || eligibility.action === "noop") { setMessage(backlogSprintAssignmentMessage(eligibility.reason)); return eligibility; }
    const shownSprints = [...(sprintById?.values() || [])].filter(item => item.id !== sprint?.id); if (sprint) shownSprints.push(sprint);
    const result = await planningState.beginBacklogAssignment([task], shownSprints, false).assign(sprint?.id || null);
    setMessage(result.phase === "saved" ? "Sprint-Zuordnung aktualisiert." : result.error || "Sprint-Zuordnung ist noch nicht bestätigt."); return eligibility;
  };
  return { assignTaskToSprint, unassignTaskFromSprint: (task: Task) => assignTaskToSprint(task, null) };
}
