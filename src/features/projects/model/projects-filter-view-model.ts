import { normalizeStatus } from "@/lib/status";
import { taskHasCriticalAttention } from "@/features/tasks/model/task-attention-signals";
import { hasGitHubIssue } from "@/lib/platform";
import type { PlanningShellState, Task } from "@/lib/types";

export type ProjectHierarchyInitiative = {
  initiative: Task;
  tasks: Task[];
};

export type ProjectHierarchyEpic = {
  epic: Task | null;
  initiatives: ProjectHierarchyInitiative[];
  tasks: Task[];
};

export type ProjectsFilterViewModel = {
  hierarchy: ProjectHierarchyEpic[];
  totalCount: number;
  visibleCount: number;
};

export type ProjectsRiskFilter = "all" | "blocked" | "critical" | "github";
export type ProjectsSort = "title" | "owner" | "status" | "priority" | "hours" | "date";
export type ProjectsTableFilters = {
  query: string;
  owner: string;
  status: string;
  priority: string;
  epic: string;
  initiative: string;
  risk: ProjectsRiskFilter;
  from: string;
  to: string;
  sort: ProjectsSort;
  direction: "asc" | "desc";
};

export const DEFAULT_PROJECTS_FILTERS: ProjectsTableFilters = {
  query: "",
  owner: "Alle",
  status: "Alle",
  priority: "Alle",
  epic: "Alle",
  initiative: "Alle",
  risk: "all",
  from: "",
  to: "",
  sort: "title",
  direction: "asc",
};

function includesQuery(values: Array<string | undefined>, query: string) {
  return !query || values.join(" ").toLocaleLowerCase("de").includes(query);
}

function strategyGoal(item?: Task | null) {
  return item?.strategy?.goal || item?.description || "";
}

export function buildProjectsFilterViewModel({
  data,
  tasks,
  filters,
}: {
  data: Pick<PlanningShellState, "taskBlockers" | "taskRelations">;
  tasks: Task[];
  filters: ProjectsTableFilters;
}): ProjectsFilterViewModel {
  const epics = tasks.filter((item) => item.taskType === "epic");
  const initiatives = tasks.filter((item) => item.taskType === "initiative");
  const deliverables = tasks.filter((item) => item.taskType === "deliverable");
  const epicById = new Map(epics.map((epic) => [epic.id, epic]));
  const initiativeById = new Map(initiatives.map((initiative) => [initiative.id, initiative]));
  const hasOrphanInitiatives = initiatives.some((initiative) => !initiative.parentTaskId || !epicById.has(initiative.parentTaskId));
  const hierarchyRoots: Array<Task | null> = hasOrphanInitiatives ? [...epics, null] : epics;
  const normalizedQuery = filters.query.trim().toLocaleLowerCase("de");
  const filtersActive = Object.entries(filters).some(([key, value]) => key !== "sort" && key !== "direction" && value !== DEFAULT_PROJECTS_FILTERS[key as keyof ProjectsTableFilters]);
  const direction = filters.direction === "desc" ? -1 : 1;
  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

  const filteredTasks = deliverables.filter((task) => {
    const initiative = initiativeById.get(task.parentTaskId);
    const epic = initiative ? epicById.get(initiative.parentTaskId) || null : null;
    const queryMatches = includesQuery([
      task.title,
      task.description,
      task.workstream,
      task.assignee,
      initiative?.title,
      strategyGoal(initiative),
      epic?.title,
      epic?.description,
    ], normalizedQuery);
    const ownerMatches = filters.owner === "Alle" || task.assigneeId === filters.owner || task.assignee === filters.owner || initiative?.ownerId === filters.owner;
    const statusMatches = filters.status === "Alle" || normalizeStatus(task.status) === filters.status;
    const priorityMatches = filters.priority === "Alle" || task.priority === filters.priority;
    const epicMatches = filters.epic === "Alle" || epic?.id === filters.epic;
    const initiativeMatches = filters.initiative === "Alle" || task.parentTaskId === filters.initiative;
    const riskMatches = filters.risk === "all"
      || filters.risk === "blocked" && (Boolean(task.dependsOn) || normalizeStatus(task.status) === "Blockiert")
      || filters.risk === "critical" && taskHasCriticalAttention(task, { tasks, taskRelations: data.taskRelations, taskBlockers: data.taskBlockers })
      || filters.risk === "github" && !hasGitHubIssue(task);
    const deadline = task.deadline || task.endDate || "";
    return queryMatches && ownerMatches && statusMatches && priorityMatches && epicMatches && initiativeMatches && riskMatches && (!filters.from || deadline >= filters.from) && (!filters.to || deadline <= filters.to);
  }).sort((left, right) => {
    let comparison = 0;
    if (filters.sort === "owner") comparison = (left.assignee || "").localeCompare(right.assignee || "", "de");
    else if (filters.sort === "status") comparison = normalizeStatus(left.status).localeCompare(normalizeStatus(right.status), "de");
    else if (filters.sort === "priority") comparison = (priorityRank[left.priority] ?? 9) - (priorityRank[right.priority] ?? 9);
    else if (filters.sort === "hours") comparison = left.hours - right.hours;
    else if (filters.sort === "date") comparison = (left.deadline || left.endDate || "").localeCompare(right.deadline || right.endDate || "");
    else comparison = left.title.localeCompare(right.title, "de");
    return direction * (comparison || left.order - right.order);
  });

  const hierarchy = hierarchyRoots.flatMap((epic): ProjectHierarchyEpic[] => {
    const epicId = epic?.id || "";
    const epicQueryMatches = includesQuery([epic?.title || "Ohne Epic", epic?.description], normalizedQuery);
    const groups = initiatives
      .filter((initiative) => epic ? initiative.parentTaskId === epic.id : !initiative.parentTaskId || !epicById.has(initiative.parentTaskId))
      .flatMap((initiative) => {
        const initiativeTasks = filteredTasks.filter((task) => task.parentTaskId === initiative.id);
        const hierarchyQueryMatches = includesQuery([epic?.title, epic?.description, initiative.title, strategyGoal(initiative)], normalizedQuery);
        const hierarchyOwnerMatches = filters.owner === "Alle" || initiative.ownerId === filters.owner;
        const hierarchyEpicMatches = filters.epic === "Alle" || epicId === filters.epic;
        const hierarchyInitiativeMatches = filters.initiative === "Alle" || initiative.id === filters.initiative;
        const hierarchyDirectlyMatches = hierarchyQueryMatches
          && hierarchyOwnerMatches
          && filters.status === "Alle"
          && hierarchyEpicMatches
          && hierarchyInitiativeMatches
          && (Boolean(normalizedQuery) || filters.owner !== "Alle" || filters.epic !== "Alle" || filters.initiative !== "Alle");
        return !filtersActive || initiativeTasks.length || hierarchyDirectlyMatches ? [{ initiative, tasks: initiativeTasks }] : [];
      });
    const epicDirectlyMatches = Boolean(normalizedQuery)
      && epicQueryMatches
      && filters.owner === "Alle"
      && filters.status === "Alle"
      && (filters.epic === "Alle" || epicId === filters.epic);
    if (filtersActive && !groups.length && !epicDirectlyMatches) return [];
    return [{ epic, initiatives: groups, tasks: groups.flatMap((group) => group.tasks) }];
  });

  return {
    hierarchy,
    visibleCount: hierarchy.length + hierarchy.reduce((sum, item) => sum + item.initiatives.length + item.tasks.length, 0),
    totalCount: hierarchyRoots.length + initiatives.length + deliverables.length,
  };
}
