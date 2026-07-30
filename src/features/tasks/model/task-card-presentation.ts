import type { Task } from "@/lib/types";

export function groupSubIssuesByParent(tasks: Task[]) {
  return tasks.reduce<Map<string, Task[]>>((groups, task) => {
    if (task.taskType !== "sub_issue" || !task.parentTaskId) return groups;

    const siblings = groups.get(task.parentTaskId) || [];
    siblings.push(task);
    groups.set(task.parentTaskId, siblings);
    return groups;
  }, new Map());
}
