import { profileNameById } from "@/lib/display";
import { normalizeStatus } from "@/lib/status";
import type { Profile, Task, TaskRelation } from "@/lib/types";

export type TaskDetailRelationshipRow = {
  relation: TaskRelation;
  task?: Task;
};

type OperationalHeaderViewInput = {
  task: Task;
  initiative?: Task;
  parentTask?: Task;
  profiles: Profile[];
  subIssues: Task[];
  canManageTaskMeta: boolean;
};

export function activeTaskDetailDependencyRows(
  rows: TaskDetailRelationshipRow[],
): Array<TaskDetailRelationshipRow & { task: Task }> {
  return rows.filter((row): row is TaskDetailRelationshipRow & { task: Task } => (
    Boolean(row.task) && normalizeStatus(row.task?.status || "") !== "Erledigt"
  ));
}

export function taskDetailOperationalHeaderView({
  task,
  initiative,
  parentTask,
  profiles,
  subIssues,
  canManageTaskMeta,
}: OperationalHeaderViewInput) {
  const hierarchyTask = task.taskType === "deliverable" ? initiative || parentTask : parentTask;
  const hierarchyFallback = task.taskType === "initiative"
    ? "Ohne Epic"
    : task.taskType === "deliverable"
      ? "Ohne Initiative"
      : task.taskType === "sub_issue"
        ? "Parent fehlt"
        : "";
  const accountableAssignment = task.raciAssignments?.find((assignment) => assignment.role === "accountable");
  const initiativeAccountableAssignment = initiative?.raciAssignments?.find((assignment) => assignment.role === "accountable");
  const accountableLabel = task.taskType === "initiative"
    ? profileNameById(profiles, accountableAssignment?.profileId || "")
    : task.taskType === "deliverable" && initiative
      ? profileNameById(profiles, initiativeAccountableAssignment?.profileId || initiative.ownerId)
      : "";
  const directChildren = subIssues.filter((item) => item.parentTaskId === task.id);
  const completedChildCount = directChildren.filter((item) => normalizeStatus(item.status) === "Erledigt").length;
  const directChildLabel = task.taskType === "epic" ? "Initiativen" : task.taskType === "initiative" ? "Deliverables" : "Sub-Issues";
  const targetDate = task.taskType === "deliverable" ? task.fixedDate : task.targetDate;

  return {
    hierarchyTask,
    hierarchyFallback,
    accountableLabel,
    directChildCount: directChildren.length,
    completedChildCount,
    directChildLabel,
    targetDate,
    showTargetDate: canManageTaskMeta || Boolean(targetDate),
  };
}
