"use client";

import { useMemo, useState } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { useBacklogCommands } from "@/features/backlog/hooks/use-backlog-commands";
import { BacklogRankTable } from "@/features/backlog/molecules/backlog-rank-table";
import { BacklogScopeTabs } from "@/features/backlog/molecules/backlog-scope-tabs";
import { BacklogSprintPane } from "@/features/backlog/molecules/backlog-sprint-pane";
import { type BacklogScope, type BacklogSort, buildBacklogViewModel, filterBacklogItemsByQuery, sortBacklogItems } from "@/features/backlog/model/backlog-view-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Task } from "@/lib/types";
import { UiNotice } from "@/shared/atoms/ui-primitives";
import { FilterField, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";

type BacklogOverviewProps = {
  apiClient: BrowserApiClient;
  canManageBacklog: boolean;
  data: PlanningData;
  onOpenTask: (taskId: string) => void;
  onUpdateTask: (task: Task, patch: Partial<Task>) => void;
  refreshPlanningData: () => Promise<void>;
  setData: (updater: (current: PlanningData) => PlanningData) => void;
  source: "seed" | "supabase";
};

export function BacklogOverview({
  apiClient,
  canManageBacklog,
  data,
  onOpenTask,
  onUpdateTask,
  refreshPlanningData,
  setData,
  source,
}: BacklogOverviewProps) {
  const [scope, setScope] = useState<BacklogScope>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<BacklogSort>("rank");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const viewModel = useMemo(() => buildBacklogViewModel(data, scope), [data, scope]);
  const visibleItems = useMemo(() => sortBacklogItems(filterBacklogItemsByQuery(viewModel.visibleItems, query), sort), [query, sort, viewModel.visibleItems]);
  const {
    assignTaskToSprint,
    isReordering,
    message,
    moveTask,
    reorderTask,
  } = useBacklogCommands({
    apiClient,
    canManageBacklog,
    onUpdateTask,
    orderedTasks: viewModel.orderedTasks,
    refreshPlanningData,
    setData,
    source,
  });

  const taskById = useMemo(() => new Map(viewModel.orderedTasks.map((task) => [task.id, task])), [viewModel.orderedTasks]);
  const activeFilters: ActiveFilter[] = [
    ...(scope !== "all" ? [{ id: "scope", label: `Scope: ${scope === "proposals" ? "Vorschläge" : scope === "ready" ? "Bereit" : "Ohne Sprint"}`, onRemove: () => setScope("all") }] : []),
    ...(sort !== "rank" ? [{ id: "sort", label: `Sortierung: ${sort === "priority" ? "Priorität" : sort === "title" ? "Titel" : sort === "initiative" ? "Initiative" : "Zuständigkeit"}`, onRemove: () => setSort("rank") }] : []),
  ];
  const resetFilters = () => {
    setQuery("");
    setScope("all");
    setSort("rank");
  };

  return (
    <div className="grid gap-4" data-tour-id="backlog-overview">
      <FilterToolbar
        searchLabel="Backlog durchsuchen"
        searchPlaceholder="Aufgabe, Initiative oder Zuständigkeit suchen"
        query={query}
        onQueryChange={setQuery}
        expanded={filtersOpen}
        onExpandedChange={setFiltersOpen}
        activeFilters={activeFilters}
        onReset={resetFilters}
        visibleCount={visibleItems.length}
        totalCount={viewModel.allItems.length}
        panelId="backlog-data-filters"
        primaryControls={<BacklogScopeTabs scope={scope} counts={viewModel.scopeCounts} onScopeChange={setScope} />}
      >
        <div className="grid gap-3 md:max-w-sm">
          <FilterField label="Sortierung">
            <CustomSelect
              aria-label="Backlog sortieren"
              value={sort}
              onChange={(value) => setSort(value as BacklogSort)}
              className="h-10 text-sm"
              options={[
                { value: "rank", label: "Backlog-Rang" },
                { value: "priority", label: "Priorität" },
                { value: "title", label: "Titel" },
                { value: "initiative", label: "Initiative" },
                { value: "assignee", label: "Zuständigkeit" },
              ]}
            />
          </FilterField>
        </div>
      </FilterToolbar>

      {message && <UiNotice tone="warning">{message}</UiNotice>}
      {sort !== "rank" && <UiNotice>Sortierte Ansicht: Rangänderungen sind deaktiviert, bis wieder nach Backlog-Rang sortiert wird.</UiNotice>}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <BacklogRankTable
          canManageBacklog={canManageBacklog && sort === "rank"}
          isReordering={isReordering}
          items={visibleItems}
          onMoveTask={moveTask}
          onOpenTask={onOpenTask}
          onReorderTask={reorderTask}
        />
        <BacklogSprintPane
          buckets={viewModel.sprintBuckets}
          canManageBacklog={canManageBacklog}
          onAssignTaskToSprint={assignTaskToSprint}
          taskById={taskById}
        />
      </div>
    </div>
  );
}
