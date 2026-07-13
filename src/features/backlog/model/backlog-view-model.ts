import { findCurrentSprint } from "@/lib/planning-schedule";
import { isApprovedDeliverable, isProposedDeliverable } from "@/features/planning/model/approval-domain";
import { getBacklogPlanningState, type BacklogPlanningState } from "@/features/backlog/model/backlog-planning-state";
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

export type BacklogItem = {
  initiative?: Package;
  isReadyForSprint: boolean;
  planningState: BacklogPlanningState;
  rank: number;
  task: Task;
};

export type BacklogSprintBucket = {
  capacityHours: number | null;
  capacityUnavailable: boolean;
  isCurrent: boolean;
  locked: boolean;
  overCapacity: boolean;
  overCapacityHours: number;
  plannedHours: number;
  sprint: Sprint;
  utilization: number;
};

function taskIsDone(task: Task) {
  return normalizeStatus(task.status) === "Erledigt";
}

function taskIsProposal(task: Task) {
  return isProposedDeliverable(task);
}

function byBacklogOrder(a: Task, b: Task) {
  if (a.order !== b.order) return a.order - b.order;
  return a.id.localeCompare(b.id, "de");
}

function sprintDurationDays(sprint: Pick<Sprint, "startDate" | "endDate">) {
  const startMatch = sprint.startDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const endMatch = sprint.endDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!startMatch || !endMatch) return null;
  const start = Date.UTC(Number(startMatch[1]), Number(startMatch[2]) - 1, Number(startMatch[3]));
  const end = Date.UTC(Number(endMatch[1]), Number(endMatch[2]) - 1, Number(endMatch[3]));
  const startDate = new Date(start);
  const endDate = new Date(end);
  const startIsValid = startDate.getUTCFullYear() === Number(startMatch[1])
    && startDate.getUTCMonth() === Number(startMatch[2]) - 1
    && startDate.getUTCDate() === Number(startMatch[3]);
  const endIsValid = endDate.getUTCFullYear() === Number(endMatch[1])
    && endDate.getUTCMonth() === Number(endMatch[2]) - 1
    && endDate.getUTCDate() === Number(endMatch[3]);
  if (!startIsValid || !endIsValid || end < start) return null;
  return Math.floor((end - start) / 86_400_000) + 1;
}

function sprintCapacityHours(data: PlanningData, sprint: Sprint) {
  const commitments = data.sprintCommitments.filter((commitment) => commitment.sprintId === sprint.id);
  const weeklyHours = commitments.length
    ? commitments.map((commitment) => commitment.weeklyHours)
    : data.profiles.map((profile) => profile.weeklyCapacity);
  const durationDays = sprintDurationDays(sprint);
  if (!weeklyHours.length || durationDays === null || weeklyHours.some((hours) => !Number.isFinite(hours) || hours < 0)) {
    return null;
  }
  return Math.round(weeklyHours.reduce((sum, hours) => sum + hours, 0) * durationDays / 7);
}

function buildBacklogItem(task: Task, initiativeById: Map<string, Package>, rank: number): BacklogItem {
  const initiative = initiativeById.get(task.packageId);
  const planningState = getBacklogPlanningState({ ...task, hasInitiative: Boolean(initiative) });

  return {
    initiative,
    isReadyForSprint: planningState.kind === "ready",
    planningState,
    rank,
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
  const planningStateRank: Record<BacklogPlanningState["kind"], number> = {
    ready: 0,
    scheduled: 1,
    blocked: 2,
    completed: 3,
    unsupported: 4,
  };
  return [...items].sort((left, right) => {
    let comparison = 0;
    if (sort === "priority") comparison = (priorityRank[left.task.priority] ?? 9) - (priorityRank[right.task.priority] ?? 9);
    else if (sort === "title") comparison = left.task.title.localeCompare(right.task.title, "de");
    else if (sort === "approval") comparison = Number(taskIsProposal(left.task)) - Number(taskIsProposal(right.task));
    else if (sort === "initiative") comparison = (left.initiative?.title || "").localeCompare(right.initiative?.title || "", "de");
    else if (sort === "assignee") comparison = (left.task.assignee || "").localeCompare(right.task.assignee || "", "de");
    else if (sort === "readiness") comparison = planningStateRank[left.planningState.kind] - planningStateRank[right.planningState.kind];
    else if (sort === "status") comparison = normalizeStatus(left.task.status).localeCompare(normalizeStatus(right.task.status), "de");
    else comparison = left.rank - right.rank;
    return (direction === "desc" ? -comparison : comparison) || left.rank - right.rank;
  });
}

export function filterBacklogItems(items: BacklogItem[], filters: BacklogTableFilters) {
  return filterBacklogItemsByQuery(items, filters.query).filter((item) => {
    const statusMatches = filters.status === "Alle" || normalizeStatus(item.task.status) === filters.status;
    const readinessMatches = filters.readiness === "all"
      || filters.readiness === "ready" && item.planningState.kind === "ready"
      || filters.readiness === "incomplete" && item.planningState.kind === "blocked";
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
    const capacityHours = sprintCapacityHours(data, sprint);
    const capacityUnavailable = capacityHours === null;
    const overCapacityHours = capacityHours === null ? 0 : Math.max(plannedHours - capacityHours, 0);
    return {
      capacityHours,
      capacityUnavailable,
      isCurrent: sprint.id === current?.id,
      locked: sprint.scoreLocked,
      overCapacity: overCapacityHours > 0,
      overCapacityHours,
      plannedHours,
      sprint,
      utilization: capacityHours && capacityHours > 0 ? plannedHours / capacityHours : 0,
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
