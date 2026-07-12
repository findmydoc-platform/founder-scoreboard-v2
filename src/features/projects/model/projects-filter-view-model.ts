import { normalizeStatus } from "@/lib/status";
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

const withoutEpic: Milestone = {
  id: "",
  title: "Ohne Epic",
  description: "Initiativen ohne zugeordneten Meilenstein.",
  targetDate: "",
  status: "planned",
  sortOrder: 999,
};

function includesQuery(values: Array<string | undefined>, query: string) {
  return !query || values.join(" ").toLocaleLowerCase("de").includes(query);
}

export function buildProjectsFilterViewModel({
  data,
  tasks,
  query,
  ownerFilter,
  statusFilter,
}: {
  data: Pick<PlanningData, "milestones" | "packages">;
  tasks: Task[];
  query: string;
  ownerFilter: string;
  statusFilter: string;
}): ProjectsFilterViewModel {
  const milestones = data.milestones.length ? data.milestones : [withoutEpic];
  const deliverables = tasks.filter((task) => task.taskType !== "sub_issue");
  const normalizedQuery = query.trim().toLocaleLowerCase("de");
  const filtersActive = Boolean(normalizedQuery) || ownerFilter !== "Alle" || statusFilter !== "Alle";

  const filteredTasks = deliverables.filter((task) => {
    const initiative = data.packages.find((pack) => pack.id === task.packageId);
    const milestone = milestones.find((item) => item.id === (initiative?.milestoneId || ""));
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
    const ownerMatches = ownerFilter === "Alle" || task.assigneeId === ownerFilter || task.assignee === ownerFilter || initiative?.ownerId === ownerFilter;
    const statusMatches = statusFilter === "Alle" || normalizeStatus(task.status) === statusFilter;
    return queryMatches && ownerMatches && statusMatches;
  });

  const hierarchy = milestones.flatMap((milestone) => {
    const milestoneQueryMatches = includesQuery([milestone.title, milestone.description], normalizedQuery);
    const initiatives = data.packages
      .filter((initiative) => milestone.id ? initiative.milestoneId === milestone.id : !initiative.milestoneId)
      .flatMap((initiative) => {
        const initiativeTasks = filteredTasks.filter((task) => task.packageId === initiative.id);
        const hierarchyQueryMatches = includesQuery([
          milestone.title,
          milestone.description,
          initiative.title,
          initiative.goal,
        ], normalizedQuery);
        const hierarchyOwnerMatches = ownerFilter === "Alle" || initiative.ownerId === ownerFilter;
        const hierarchyStatusMatches = statusFilter === "Alle";
        const hierarchyDirectlyMatches = hierarchyQueryMatches
          && hierarchyOwnerMatches
          && hierarchyStatusMatches
          && (Boolean(normalizedQuery) || ownerFilter !== "Alle");

        return !filtersActive || initiativeTasks.length || hierarchyDirectlyMatches
          ? [{ initiative, tasks: initiativeTasks }]
          : [];
      });
    const milestoneDirectlyMatches = Boolean(normalizedQuery)
      && milestoneQueryMatches
      && ownerFilter === "Alle"
      && statusFilter === "Alle";

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
