"use client";

import { useMemo, useState } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { useBacklogCommands } from "@/features/backlog/hooks/use-backlog-commands";
import { BacklogRankTable } from "@/features/backlog/molecules/backlog-rank-table";
import { BacklogScopeTabs } from "@/features/backlog/molecules/backlog-scope-tabs";
import { BacklogSprintPane } from "@/features/backlog/molecules/backlog-sprint-pane";
import { DEFAULT_BACKLOG_FILTERS, buildBacklogTableViewModel, type BacklogReadinessFilter, type BacklogScope, type BacklogTableFilters } from "@/features/backlog/model/backlog-view-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, Task } from "@/lib/types";
import { UiNotice } from "@/shared/atoms/ui-primitives";
import { FilterField, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";
import { enumUrlField, stringUrlField, useTableUrlState, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

const backlogFilterSchema: TableUrlSchema<BacklogTableFilters> = {
  query: stringUrlField(),
  scope: enumUrlField("all", ["all", "proposals", "ready", "unscheduled"] as const),
  status: stringUrlField("Alle"),
  readiness: enumUrlField("all", ["all", "ready", "incomplete"] as const),
  priority: stringUrlField("Alle"),
  initiative: stringUrlField("Alle"),
  assignee: stringUrlField("Alle"),
  sort: enumUrlField("rank", ["rank", "priority", "title", "approval", "initiative", "assignee", "readiness", "status"] as const),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { state: filters, updateState: updateFilters, resetState: resetFilters } = useTableUrlState({ namespace: "backlog", schema: backlogFilterSchema });
  const viewModel = useMemo(() => buildBacklogTableViewModel(data, filters), [data, filters]);
  const visibleItems = viewModel.visibleItems;
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
    ...(filters.scope !== "all" ? [{ id: "scope", label: `Scope: ${filters.scope === "proposals" ? "Vorschläge" : filters.scope === "ready" ? "Bereit" : "Ohne Sprint"}`, onRemove: () => updateFilters({ scope: "all" }) }] : []),
    ...(filters.status !== "Alle" ? [{ id: "status", label: `Status: ${filters.status}`, onRemove: () => updateFilters({ status: "Alle" }) }] : []),
    ...(filters.readiness !== "all" ? [{ id: "readiness", label: `Bereitschaft: ${filters.readiness === "ready" ? "Bereit" : "Unvollständig"}`, onRemove: () => updateFilters({ readiness: "all" }) }] : []),
    ...(filters.priority !== "Alle" ? [{ id: "priority", label: `Priorität: ${filters.priority}`, onRemove: () => updateFilters({ priority: "Alle" }) }] : []),
    ...(filters.initiative !== "Alle" ? [{ id: "initiative", label: `Initiative: ${data.packages.find((pack) => pack.id === filters.initiative)?.title || filters.initiative}`, onRemove: () => updateFilters({ initiative: "Alle" }) }] : []),
    ...(filters.assignee !== "Alle" ? [{ id: "assignee", label: `Zuständig: ${data.profiles.find((profile) => profile.id === filters.assignee)?.name || filters.assignee}`, onRemove: () => updateFilters({ assignee: "Alle" }) }] : []),
  ];
  const statusOptions = [{ value: "Alle", label: "Alle Status" }, ...Array.from(new Set(viewModel.allItems.map((item) => normalizeStatus(item.task.status)))).map((status) => ({ value: status, label: status }))];
  const readinessOptions = [{ value: "all", label: "Alle" }, { value: "ready", label: "Bereit" }, { value: "incomplete", label: "Unvollständig" }];
  const priorityOptions = ["Alle", "P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority === "Alle" ? "Alle Prioritäten" : priority }));
  const initiativeOptions = [{ value: "Alle", label: "Alle Initiativen" }, ...data.packages.map((pack) => ({ value: pack.id, label: pack.title }))];
  const assigneeOptions = [{ value: "Alle", label: "Alle Zuständigen" }, ...data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))];
  const toolbar = (
    <FilterToolbar
      variant="embedded"
      searchLabel="Backlog durchsuchen"
      searchPlaceholder="Aufgabe, Initiative oder Zuständigkeit suchen"
      query={filters.query}
      onQueryChange={(query) => updateFilters({ query }, "replace")}
      expanded={filtersOpen}
      onExpandedChange={setFiltersOpen}
      activeFilters={activeFilters}
      isDirty={JSON.stringify(filters) !== JSON.stringify(DEFAULT_BACKLOG_FILTERS)}
      onReset={resetFilters}
      results={[{ id: "backlog", visibleCount: visibleItems.length, totalCount: viewModel.allItems.length }]}
      panelId="backlog-data-filters"
      primaryControls={<BacklogScopeTabs scope={filters.scope} counts={viewModel.scopeCounts} onScopeChange={(scope: BacklogScope) => updateFilters({ scope })} />}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <FilterField label="Status"><CustomSelect aria-label="Backlog nach Status filtern" value={filters.status} onChange={(status) => updateFilters({ status })} options={statusOptions} className="h-10 text-sm" /></FilterField>
        <FilterField label="Bereitschaft"><CustomSelect aria-label="Backlog nach Bereitschaft filtern" value={filters.readiness} onChange={(readiness) => updateFilters({ readiness: readiness as BacklogReadinessFilter })} options={readinessOptions} className="h-10 text-sm" /></FilterField>
        <FilterField label="Priorität"><CustomSelect aria-label="Backlog nach Priorität filtern" value={filters.priority} onChange={(priority) => updateFilters({ priority })} options={priorityOptions} className="h-10 text-sm" /></FilterField>
        <FilterField label="Initiative"><CustomSelect aria-label="Backlog nach Initiative filtern" value={filters.initiative} onChange={(initiative) => updateFilters({ initiative })} options={initiativeOptions} className="h-10 text-sm" /></FilterField>
        <FilterField label="Zuständig"><CustomSelect aria-label="Backlog nach Zuständigkeit filtern" value={filters.assignee} onChange={(assignee) => updateFilters({ assignee })} options={assigneeOptions} className="h-10 text-sm" /></FilterField>
      </div>
    </FilterToolbar>
  );

  return (
    <div className="grid gap-4" data-tour-id="backlog-overview">
      {message && <UiNotice tone="warning">{message}</UiNotice>}
      {filters.sort !== "rank" && <UiNotice>Sortierte Ansicht: Rangänderungen sind deaktiviert, bis wieder nach Backlog-Rang sortiert wird.</UiNotice>}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <BacklogRankTable
          canManageBacklog={canManageBacklog && filters.sort === "rank"}
          isReordering={isReordering}
          items={visibleItems}
          allItems={viewModel.allItems}
          filters={filters}
          toolbar={toolbar}
          statusOptions={statusOptions}
          readinessOptions={readinessOptions}
          priorityOptions={priorityOptions}
          initiativeOptions={initiativeOptions}
          assigneeOptions={assigneeOptions}
          onFiltersChange={updateFilters}
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
