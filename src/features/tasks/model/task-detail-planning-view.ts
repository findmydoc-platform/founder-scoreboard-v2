import { projectDeliverableSchedule } from "@/features/planning-items/model/deliverable-schedule";
import { compactDateRange } from "@/lib/display";
import type { Sprint, Task } from "@/lib/types";

type TaskDetailPlanningViewInput = {
  task: Task;
  allTasks: Task[];
  sprints: Sprint[];
  canManageTaskMeta: boolean;
  canReparentSubIssue: boolean;
};

export function taskDetailPlanningView({
  task,
  allTasks,
  sprints,
  canManageTaskMeta,
  canReparentSubIssue,
}: TaskDetailPlanningViewInput) {
  const currentParent = allTasks.find((item) => item.id === task.parentTaskId) || null;
  const schedule = projectDeliverableSchedule(
    { sprintId: task.sprintId || null, fixedDate: task.fixedDate || null },
    sprints,
  );
  const currentSprint = schedule.sprint;
  const initiatives = allTasks.filter((item) => item.taskType === "initiative");
  const epics = allTasks.filter((item) => item.taskType === "epic");
  const currentInitiative = initiatives.find((item) => item.id === task.parentTaskId);
  const kind = task.taskType === "sub_issue"
    ? "sub_issue"
    : task.taskType === "epic" || task.taskType === "initiative"
      ? "strategic"
      : "deliverable";

  return {
    kind,
    currentParent,
    currentSprint,
    currentInitiative,
    initiatives,
    epics,
    targetDate: task.targetDate || "",
    canEditPlanning: task.taskType === "sub_issue" ? canReparentSubIssue : canManageTaskMeta,
    sprintPeriod: currentSprint ? compactDateRange(currentSprint) : "Kein Ausführungszeitraum",
  } as const;
}
