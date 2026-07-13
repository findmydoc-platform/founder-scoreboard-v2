import { findCurrentSprint } from "@/lib/planning-schedule";
import { isApprovedDeliverable, isProposedDeliverable } from "@/features/planning/model/approval-domain";
import { normalizeStatus } from "@/lib/status";
import type { Package, PlanningData, Sprint, Task } from "@/lib/types";

export type BacklogScope = "all" | "proposals" | "ready" | "unscheduled";
export type BacklogSort = "rank" | "priority" | "title" | "approval" | "initiative" | "assignee" | "readiness" | "status";
export type BacklogReadinessFilter = "all" | "ready" | "incomplete";

export type BacklogTableFilters = {
  query: string;
  scope: BacklogScope;
  status: string;
  readiness: BacklogReadinessFilter;
  priority: string;
  initiative: string;
  assignee: string;
  sort: BacklogSort;
  direction: "asc" | "desc";
};

export const DEFAULT_BACKLOG_FILTERS: BacklogTableFilters = {
  query: "",
  scope: "all",
  status: "Alle",
  readiness: "all",
  priority: "Alle",
  initiative: "Alle",
  assignee: "Alle",
  sort: "rank",
  direction: "asc",
};

export type BacklogReadinessChip = {
  id: "owner" | "initiative" | "sprint";
  label: string;
  ready: boolean;
};

export type BacklogItem = {
  initiative?: Package;
  isReadyForSprint: boolean;
  rank: number;
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
  return isProposedDeliverable(task);
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

function buildBacklogItem(task: Task, initiativeById: Map<string, Package>, rank: number): BacklogItem {
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
    isReadyForSprint: isApprovedDeliverable(task) && ownerReady && initiativeReady && !sprintReady && !taskIsDone(task),
    rank,
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

export function sortBacklogItems(items: BacklogItem[], sort: BacklogSort, direction: "asc" | "desc" = "asc") {
  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
  return [...items].sort((left, right) => {
    let comparison = 0;
    if (sort === "priority") comparison = (priorityRank[left.task.priority] ?? 9) - (priorityRank[right.task.priority] ?? 9);
    else if (sort === "title") comparison = left.task.title.localeCompare(right.task.title, "de");
    else if (sort === "approval") comparison = Number(taskIsProposal(left.task)) - Number(taskIsProposal(right.task));
    else if (sort === "initiative") comparison = (left.initiative?.title || "").localeCompare(right.initiative?.title || "", "de");
    else if (sort === "assignee") comparison = (left.task.assignee || "").localeCompare(right.task.assignee || "", "de");
    else if (sort === "readiness") comparison = Number(left.isReadyForSprint) - Number(right.isReadyForSprint);
    else if (sort === "status") comparison = normalizeStatus(left.task.status).localeCompare(normalizeStatus(right.task.status), "de");
    else comparison = left.rank - right.rank;
    return (direction === "desc" ? -comparison : comparison) || left.rank - right.rank;
  });
}

export function filterBacklogItems(items: BacklogItem[], filters: BacklogTableFilters) {
  return filterBacklogItemsByQuery(items, filters.query).filter((item) => {
    const statusMatches = filters.status === "Alle" || normalizeStatus(item.task.status) === filters.status;
    const readinessMatches = filters.readiness === "all" || filters.readiness === "ready" && item.isReadyForSprint || filters.readiness === "incomplete" && !item.isReadyForSprint;
    const priorityMatches = filters.priority === "Alle" || item.task.priority === filters.priority;
    const initiativeMatches = filters.initiative === "Alle" || item.task.packageId === filters.initiative;
    const assigneeMatches = filters.assignee === "Alle" || item.task.assigneeId === filters.assignee || item.task.assignee === filters.assignee;
    return statusMatches && readinessMatches && priorityMatches && initiativeMatches && assigneeMatches;
  });
}

export function buildBacklogTableViewModel(data: PlanningData, filters: BacklogTableFilters) {
  const workspace = buildBacklogViewModel(data, filters.scope);
  const visibleItems = sortBacklogItems(filterBacklogItems(workspace.visibleItems, filters), filters.sort, filters.direction);
  return { ...workspace, visibleItems };
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
  const allItems = orderedTasks.map((task, index) => buildBacklogItem(task, initiativeById, index + 1));
  const visibleItems = allItems.filter((item) => filterItem(item, scope));
  const { current, sprints } = planningSprints(data);
  const sprintBuckets = sprints.map((sprint) => {
    const plannedHours = data.tasks
      .filter((task) => isApprovedDeliverable(task) && task.sprintId === sprint.id && !taskIsDone(task))
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
    scopeCounts: {
      all: allItems.length,
      proposals: allItems.filter((item) => filterItem(item, "proposals")).length,
      ready: allItems.filter((item) => filterItem(item, "ready")).length,
      unscheduled: allItems.filter((item) => filterItem(item, "unscheduled")).length,
    },
  };
}
