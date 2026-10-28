"use client";
import type { PlanningState } from "@/features/planning/model/planning-state";
import type { Sprint, Task } from "@/lib/types";
export function useBacklogBulkSprintAssignment({ planningState, canManageBacklog, setMessage, sprints = [] }: { planningState: PlanningState; canManageBacklog: boolean; setMessage(message: string): void; sprints?: Sprint[] }) {
  return {
    isBulkAssigningSprint: planningState.backlogAssignments().some(item => item.phase === "saving"),
    async assignTasksToSprint(tasks: Task[], sprint: Sprint, shownSprints: readonly Sprint[] = sprints) {
      if (!canManageBacklog) { setMessage("Nur CEO oder Deputy können Deliverables einem Sprint zuordnen."); return false; }
      const result = await planningState.beginBacklogAssignment(tasks, [...shownSprints.filter(item => item.id !== sprint.id), sprint], true).assign(sprint.id);
      setMessage(result.phase === "saved" ? `${result.confirmedCount} Deliverables wurden dem Sprint „${sprint.name}“ zugeordnet.` : result.error || "Sprint-Zuordnungen sind noch nicht bestätigt.");
      return result.phase === "saved";
    },
  };
}
