import { normalizeStatus } from "@/lib/status";
import { taskHasCriticalAttention } from "@/features/tasks/model/task-attention-signals";
import { hasGitHubIssue } from "@/lib/platform";
import type { Milestone, Package, PlanningData, Task } from "@/lib/types";

export type ProjectHierarchyInitiative = {
  initiative: Package;
  tasks: Task[];
};

export type ProjectHierarchyMilestone = {
  milestone: Milestone;
  initiatives: ProjectHierarchyInitiative[];
  tasks: Task[];
};

export type ProjectsFilterViewModel = {
  hierarchy: ProjectHierarchyMilestone[];
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
  milestone: string;
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
  milestone: "Alle",
  initiative: "Alle",
  risk: "all",
  from: "",
  to: "",
  sort: "title",
  direction: "asc",
};

const withoutEpic: Milestone = {
  id: "",
  title: "Ohne Epic",
  description: "Initiativen ohne zugeordneten Meilenstein.",
  targetDate: "",
  status: "planned",
  sortOrder: 999,
  updatedAt: "",
};

function includesQuery(values: Array<string | undefined>, query: string) {
  return !query || values.join(" ").toLocaleLowerCase("de").includes(query);
}

export function buildProjectsFilterViewModel({
  data,
  tasks,
  filters,
}: {
  data: Pick<PlanningData, "milestones" | "packages"> & Partial<Pick<PlanningData, "taskBlockers" | "taskRelations">>;
  tasks: Task[];
  filters: ProjectsTableFilters;
}): ProjectsFilterViewModel {
  const milestoneIds = new Set(data.milestones.map((milestone) => milestone.id));
  const isOrphanInitiative = (initiative: Package) => !initiative.milestoneId || !milestoneIds.has(initiative.milestoneId);
  const hasOrphanInitiatives = data.packages.some(isOrphanInitiative);
  const milestones = hasOrphanInitiatives ? [...data.milestones, withoutEpic] : data.milestones;
  const deliverables = tasks.filter((task) => task.taskType !== "sub_issue");
  const normalizedQuery = filters.query.trim().toLocaleLowerCase("de");
  const filtersActive = Object.entries(filters).some(([key, value]) => key !== "sort" && key !== "direction" && value !== DEFAULT_PROJECTS_FILTERS[key as keyof ProjectsTableFilters]);
  const direction = filters.direction === "desc" ? -1 : 1;
  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };

  const filteredTasks = deliverables.filter((task) => {
    const initiative = data.packages.find((pack) => pack.id === task.packageId);
    const milestone = initiative
      ? data.milestones.find((item) => item.id === initiative.milestoneId) || withoutEpic
      : undefined;
    const queryMatches = includesQuery([
      task.title,
      task.description,
      task.workstream,
      task.assignee,
      initiative?.title,
      initiative?.goal,
      milestone?.title,
      milestone?.description,
    ], normalizedQuery);
    const ownerMatches = filters.owner === "Alle" || task.assigneeId === filters.owner || task.assignee === filters.owner || initiative?.ownerId === filters.owner;
    const statusMatches = filters.status === "Alle" || normalizeStatus(task.status) === filters.status;
    const priorityMatches = filters.priority === "Alle" || task.priority === filters.priority;
    const milestoneMatches = filters.milestone === "Alle" || milestone?.id === filters.milestone;
    const initiativeMatches = filters.initiative === "Alle" || task.packageId === filters.initiative;
    const riskMatches = filters.risk === "all"
      || filters.risk === "blocked" && (Boolean(task.dependsOn) || normalizeStatus(task.status) === "Blockiert")
      || filters.risk === "critical" && taskHasCriticalAttention(task, {
        tasks,
        taskRelations: data.taskRelations || [],
        taskBlockers: data.taskBlockers || [],
      })
      || filters.risk === "github" && !hasGitHubIssue(task);
    const deadline = task.deadline || task.endDate || "";
    return queryMatches && ownerMatches && statusMatches && priorityMatches && milestoneMatches && initiativeMatches && riskMatches && (!filters.from || deadline >= filters.from) && (!filters.to || deadline <= filters.to);
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

  const hierarchy = milestones.flatMap((milestone) => {
    const milestoneQueryMatches = includesQuery([milestone.title, milestone.description], normalizedQuery);
    const initiatives = data.packages
      .filter((initiative) => milestone.id ? initiative.milestoneId === milestone.id : isOrphanInitiative(initiative))
      .flatMap((initiative) => {
        const initiativeTasks = filteredTasks.filter((task) => task.packageId === initiative.id);
        const hierarchyQueryMatches = includesQuery([
          milestone.title,
          milestone.description,
          initiative.title,
          initiative.goal,
        ], normalizedQuery);
        const hierarchyOwnerMatches = filters.owner === "Alle" || initiative.ownerId === filters.owner;
        const hierarchyStatusMatches = filters.status === "Alle";
        const hierarchyMilestoneMatches = filters.milestone === "Alle" || milestone.id === filters.milestone;
        const hierarchyInitiativeMatches = filters.initiative === "Alle" || initiative.id === filters.initiative;
        const hierarchyDirectlyMatches = hierarchyQueryMatches
          && hierarchyOwnerMatches
          && hierarchyStatusMatches
          && hierarchyMilestoneMatches
          && hierarchyInitiativeMatches
          && (Boolean(normalizedQuery) || filters.owner !== "Alle" || filters.milestone !== "Alle" || filters.initiative !== "Alle");

        return !filtersActive || initiativeTasks.length || hierarchyDirectlyMatches
          ? [{ initiative, tasks: initiativeTasks }]
          : [];
      });
    const milestoneDirectlyMatches = Boolean(normalizedQuery)
      && milestoneQueryMatches
      && filters.owner === "Alle"
      && filters.status === "Alle"
      && (filters.milestone === "Alle" || milestone.id === filters.milestone);

    if (filtersActive && !initiatives.length && !milestoneDirectlyMatches) return [];
    return [{
      milestone,
      initiatives,
      tasks: initiatives.flatMap((initiative) => initiative.tasks),
    }];
  });

  return {
    hierarchy,
    visibleCount: hierarchy.length
      + hierarchy.reduce((sum, item) => sum + item.initiatives.length + item.tasks.length, 0),
    totalCount: milestones.length + data.packages.length + deliverables.length,
  };
}
