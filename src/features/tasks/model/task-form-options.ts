import { initiativeOptionLabel, taskAssigneeLabel, taskAssigneeOptions } from "@/lib/display";
import { taskStatuses } from "@/lib/status";
import type { Milestone, Profile, Sprint, Task, TaskRelationType, TaskStatus, TaskType } from "@/lib/types";
import type { CustomSelectOption } from "@/shared/atoms/custom-select";

export const priorityOptions: CustomSelectOption[] = ["P0", "P1", "P2", "P3", "P4"].map((priority) => ({
  value: priority,
  label: priority,
}));

export const taskTypeOptions: Array<CustomSelectOption & { value: TaskType }> = [
  { value: "epic", label: "Epic" },
  { value: "initiative", label: "Initiative" },
  { value: "deliverable", label: "Deliverable" },
  { value: "sub_issue", label: "Sub-Issue" },
];

export const taskStatusOptions: Array<CustomSelectOption & { value: TaskStatus }> = taskStatuses.map((status) => ({
  value: status,
  label: status,
}));

export const taskRelationTypeOptions: Array<CustomSelectOption & { value: TaskRelationType }> = [
  { value: "blocked_by", label: "Wartet auf" },
  { value: "blocks", label: "Blockiert" },
  { value: "relates_to", label: "Verknüpft mit" },
];

export function milestoneOptions(milestones: Milestone[], emptyLabel: string): CustomSelectOption[] {
  return [{ value: "", label: emptyLabel }, ...milestones.map((milestone) => ({ value: milestone.id, label: milestone.title }))];
}

export function sprintOptions(sprints: Sprint[]): CustomSelectOption[] {
  return sprints.map((sprint) => ({ value: sprint.id, label: sprint.name }));
}

export function initiativeOptions(initiatives: Task[]): CustomSelectOption[] {
  return initiatives.map((initiative) => ({ value: initiative.id, label: initiativeOptionLabel(initiative) }));
}

export function parentDeliverableOptions(tasks: Task[], legacyInitiatives: Array<{ id: string; title: string }> = []): CustomSelectOption[] {
  const initiativeById = new Map([
    ...tasks.filter((item) => item.taskType === "initiative").map((initiative) => [initiative.id, initiative] as const),
    ...legacyInitiatives.map((initiative) => [initiative.id, initiative] as const),
  ]);
  return tasks
    .filter((task) => task.taskType === "deliverable")
    .map((task) => {
      const initiative = initiativeById.get(task.parentTaskId || task.packageId);
      const approvalHint = task.approvalStatus === "approved" ? "" : " · wartet auf Freigabe";
      return {
        value: task.id,
        label: `${task.title} · ${initiative?.title || "Ohne Initiative"}${approvalHint}`,
      };
    });
}

export function assigneeOptions(taskType: TaskType, profiles: Profile[]): CustomSelectOption[] {
  return taskAssigneeOptions(taskType, profiles);
}

export function relatedTaskOptions(tasks: Task[]): CustomSelectOption[] {
  return [
    { value: "", label: "Keine Abhängigkeit" },
    ...tasks
      .filter((task) => task.taskType !== "sub_issue")
      .map((task) => ({ value: task.id, label: `${task.title} · ${taskAssigneeLabel(task)}` })),
  ];
}
