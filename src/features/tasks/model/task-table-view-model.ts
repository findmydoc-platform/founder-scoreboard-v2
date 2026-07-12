import { taskAssigneeOptions } from "@/lib/display";
import { normalizeStatus } from "@/lib/status";
import type { Profile, Sprint, Task } from "@/lib/types";

export type TaskTableSort = "title" | "status" | "assignee" | "priority" | "sprint" | "start" | "deadline";
export type TaskTableFilters = { sort: TaskTableSort; direction: "asc" | "desc" };

export const DEFAULT_TASK_TABLE_FILTERS: TaskTableFilters = {
  sort: "priority",
  direction: "asc",
};

export function sortTaskTableRows({
  tasks,
  profiles,
  sprints,
  sort,
  direction,
}: {
  tasks: Task[];
  profiles: Profile[];
  sprints: Sprint[];
  sort: TaskTableSort;
  direction: "asc" | "desc";
}) {
  const sprintName = (task: Task) => sprints.find((sprint) => sprint.id === task.sprintId)?.name || "";
  const assigneeName = (task: Task) => taskAssigneeOptions(task.taskType, profiles).find((option) => option.value === (task.assigneeId || task.assignee))?.label || task.assignee;
  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
  return [...tasks].sort((left, right) => {
    const values: Record<TaskTableSort, [string | number, string | number]> = {
      title: [left.title, right.title],
      status: [normalizeStatus(left.status), normalizeStatus(right.status)],
      assignee: [assigneeName(left), assigneeName(right)],
      priority: [priorityRank[left.priority] ?? 9, priorityRank[right.priority] ?? 9],
      sprint: [sprintName(left), sprintName(right)],
      start: [left.startDate || "", right.startDate || ""],
      deadline: [left.deadline || left.endDate || "", right.deadline || right.endDate || ""],
    };
    const [leftValue, rightValue] = values[sort];
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), "de");
    return (direction === "asc" ? comparison : -comparison) || left.order - right.order;
  });
}

export function buildTaskTableViewModel({
  tasks,
  profiles,
  sprints,
  filters,
}: {
  tasks: Task[];
  profiles: Profile[];
  sprints: Sprint[];
  filters: TaskTableFilters;
}) {
  return {
    rows: sortTaskTableRows({
      tasks,
      profiles,
      sprints,
      sort: filters.sort,
      direction: filters.direction,
    }),
    totalCount: tasks.length,
  };
}
