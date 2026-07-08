import { findCurrentSprint } from "@/lib/planning-schedule";
import { normalizeStatus } from "@/lib/status";
import type { Package, PlanningData, Sprint, Task } from "@/lib/types";

export type BacklogScope = "all" | "proposals" | "ready" | "unscheduled";

export type BacklogReadinessChip = {
  id: "owner" | "initiative" | "sprint";
  label: string;
  ready: boolean;
};

export type BacklogItem = {
  initiative?: Package;
  isReadyForSprint: boolean;
  readiness: BacklogReadinessChip[];
  task: Task;
};

export type BacklogSprintBucket = {
  capacityHours: number;
  isCurrent: boolean;
  locked: boolean;
  plannedHours: number;
  sprint: Sprint;
  utilization: number;
};

function hasOwner(task: Task) {
  return Boolean(task.assigneeId || task.ownerId || task.assignee || task.owner);
}

function taskIsDone(task: Task) {
  return normalizeStatus(task.status) === "Erledigt";
}

function taskIsProposal(task: Task) {
  return task.taskType === "proposal" || normalizeStatus(task.status) === "Vorschlag";
}

function byBacklogOrder(a: Task, b: Task) {
  if (a.order !== b.order) return a.order - b.order;
  return a.title.localeCompare(b.title, "de");
}

function sprintCapacityHours(data: PlanningData, sprintId: string) {
  const commitments = data.sprintCommitments.filter((commitment) => commitment.sprintId === sprintId);
  if (commitments.length) {
    return commitments.reduce((sum, commitment) => sum + commitment.weeklyHours, 0);
  }
  return data.profiles.reduce((sum, profile) => sum + profile.weeklyCapacity, 0);
}

function buildBacklogItem(task: Task, initiativeById: Map<string, Package>): BacklogItem {
  const initiative = initiativeById.get(task.packageId);
  const ownerReady = hasOwner(task);
  const initiativeReady = Boolean(initiative);
  const sprintReady = Boolean(task.sprintId);
  const readiness: BacklogReadinessChip[] = [
    { id: "owner", label: "Z", ready: ownerReady },
    { id: "initiative", label: "I", ready: initiativeReady },
    { id: "sprint", label: "S", ready: sprintReady },
  ];

  return {
    initiative,
    isReadyForSprint: ownerReady && initiativeReady && !sprintReady && !taskIsDone(task),
    readiness,
    task,
  };
}

function filterItem(item: BacklogItem, scope: BacklogScope) {
  if (scope === "proposals") return taskIsProposal(item.task);
  if (scope === "ready") return item.isReadyForSprint;
  if (scope === "unscheduled") return !item.task.sprintId;
  return true;
}

export function filterBacklogItemsByQuery(items: BacklogItem[], query: string) {
  const queryValue = query.trim().toLowerCase();
  if (!queryValue) return items;
  return items.filter((item) => [
    item.task.title,
    item.task.description,
    item.task.priority,
    item.task.assignee,
    item.initiative?.title || "",
  ].join(" ").toLowerCase().includes(queryValue));
}

function planningSprints(data: PlanningData) {
  const ordered = [...data.sprints]
    .filter((sprint) => sprint.status !== "closed")
    .sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
  const current = findCurrentSprint(ordered) || ordered[0];
  const currentIndex = current ? ordered.findIndex((sprint) => sprint.id === current.id) : 0;
  const startIndex = Math.max(currentIndex, 0);
  return {
    current,
    sprints: ordered.slice(startIndex, startIndex + 5),
  };
}

export function buildBacklogViewModel(data: PlanningData, scope: BacklogScope) {
  const initiativeById = new Map(data.packages.map((initiative) => [initiative.id, initiative]));
  const orderedTasks = data.tasks
    .filter((task) => task.taskType !== "sub_issue" && !taskIsDone(task))
    .sort(byBacklogOrder);
  const allItems = orderedTasks.map((task) => buildBacklogItem(task, initiativeById));
  const visibleItems = allItems.filter((item) => filterItem(item, scope));
  const { current, sprints } = planningSprints(data);
  const sprintBuckets = sprints.map((sprint) => {
    const plannedHours = data.tasks
      .filter((task) => task.taskType !== "sub_issue" && task.sprintId === sprint.id && !taskIsDone(task))
      .reduce((sum, task) => sum + task.hours, 0);
    const capacityHours = sprintCapacityHours(data, sprint.id);
    return {
      capacityHours,
      isCurrent: sprint.id === current?.id,
      locked: sprint.scoreLocked,
      plannedHours,
      sprint,
      utilization: capacityHours ? Math.min(plannedHours / capacityHours, 1) : 0,
    };
  });

  return {
    allItems,
    orderedTasks,
    sprintBuckets,
    visibleItems,
  };
}
