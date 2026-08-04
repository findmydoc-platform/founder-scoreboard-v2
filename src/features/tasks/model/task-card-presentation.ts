import type { Task } from "@/lib/types";
import { normalizeStatus } from "@/lib/status";

export function directChildPluralLabel(taskType: Task["taskType"]) {
  if (taskType === "epic") return "Initiativen";
  if (taskType === "initiative") return "Deliverables";
  return "Sub-Issues";
}

export function taskChildProgress(childItems: Task[]) {
  const completed = childItems.filter((item) => normalizeStatus(item.status) === "Erledigt").length;
  const total = childItems.length;

  return {
    completed,
    percentage: total ? Math.round((completed / total) * 100) : 0,
    total,
    unfinished: total - completed,
  };
}

export function groupSubIssuesByParent(tasks: Task[]) {
  return groupDirectChildrenByParent(tasks, "sub_issue");
}

export function groupDirectChildrenByParent(tasks: Task[], childType?: Task["taskType"]) {
  return tasks.reduce<Map<string, Task[]>>((groups, task) => {
    if ((childType && task.taskType !== childType) || !task.parentTaskId) return groups;

    const siblings = groups.get(task.parentTaskId) || [];
    siblings.push(task);
    groups.set(task.parentTaskId, siblings);
    return groups;
  }, new Map());
}
