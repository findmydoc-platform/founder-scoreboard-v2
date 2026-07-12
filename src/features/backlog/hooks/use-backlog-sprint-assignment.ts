"use client";

import type { Sprint, Task } from "@/lib/types";
import { isApprovedDeliverable } from "@/features/planning/model/approval-domain";

type UseBacklogSprintAssignmentOptions = {
  canManageBacklog: boolean;
  onUpdateTask: (task: Task, patch: Partial<Task>) => void;
  setMessage: (message: string) => void;
};

function ownerMissing(task: Task) {
  return !(task.assigneeId || task.ownerId || task.assignee || task.owner);
}

function sprintPatchForTask(task: Task, sprintId: string): Partial<Task> {
  if (!isApprovedDeliverable(task)) {
    return { sprintId, status: "Offen" };
  }
  return { sprintId };
}

export function useBacklogSprintAssignment({
  canManageBacklog,
  onUpdateTask,
  setMessage,
}: UseBacklogSprintAssignmentOptions) {
  const assignTaskToSprint = (task: Task, sprint: Sprint) => {
    if (!canManageBacklog) {
      setMessage("Nur CEO oder Deputy können Aufgaben einem Sprint zuordnen.");
      return;
    }
    if (sprint.scoreLocked) {
      setMessage("Gelockte Sprints können nicht mehr zugewiesen werden.");
      return;
    }
    if (!isApprovedDeliverable(task) && (ownerMissing(task) || !task.packageId)) {
      setMessage("Für die Sprint-Zuordnung fehlen Zuständigkeit oder Initiative.");
      return;
    }
    setMessage("");
    onUpdateTask(task, sprintPatchForTask(task, sprint.id));
  };

  return {
    assignTaskToSprint,
  };
}
