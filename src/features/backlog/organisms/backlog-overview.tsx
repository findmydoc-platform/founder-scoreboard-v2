"use client";

import { useMemo, useState } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { useBacklogCommands } from "@/features/backlog/hooks/use-backlog-commands";
import { useBacklogModel } from "@/features/backlog/hooks/use-backlog-model";
import { BacklogRankTable } from "@/features/backlog/molecules/backlog-rank-table";
import { BacklogScopeTabs } from "@/features/backlog/molecules/backlog-scope-tabs";
import { BacklogSprintPane } from "@/features/backlog/molecules/backlog-sprint-pane";
import { PlanningBacklogTree, type BacklogPlanningLevel } from "@/features/backlog/molecules/planning-backlog-tree";
import { DEFAULT_BACKLOG_FILTERS, buildBacklogOverviewViewModel, type BacklogReadinessFilter, type BacklogScope, type BacklogTableFilters } from "@/features/backlog/model/backlog-view-model";
import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import { PlanningLevelSelect } from "@/features/planning/molecules/planning-level-select";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Sprint, Task } from "@/lib/types";
import { classNames, UiNotice } from "@/shared/atoms/ui-primitives";
import { FilterField, FilterToolbar } from "@/shared/molecules/filter-toolbar";
import { enumUrlField, stringUrlField, useTableUrlState, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

const backlogFilterSchema: TableUrlSchema<BacklogTableFilters> = {
  level: enumUrlField("deliverable", ["epic", "initiative", "deliverable"] as const),
  query: stringUrlField(),
  scope: enumUrlField("all", ["all", "proposals", "ready", "unscheduled"] as const),
  status: stringUrlField("Alle"),
  readiness: enumUrlField("all", ["all", "ready", "incomplete"] as const),
  priority: stringUrlField("Alle"),
  epic: stringUrlField("Alle"),
  initiative: stringUrlField("Alle"),
  assignee: stringUrlField("Alle"),
  sort: enumUrlField("rank", ["rank", "priority", "title", "approval", "initiative", "assignee", "readiness", "status"] as const),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

type BacklogOverviewProps = {
  apiClient: BrowserApiClient;
  canManageBacklog: boolean;
  initialModel: BacklogModel;
  onOpenTask: (taskId: string) => void;
  onCreatePlanningItem: (taskType: BacklogPlanningLevel) => void;
  onProposeDeliverable: () => void;
};

export function BacklogOverview({
  apiClient,
  canManageBacklog,
  initialModel,
  onOpenTask,
  onCreatePlanningItem,
  onProposeDeliverable,
}: BacklogOverviewProps) {
  const { dispatch, model, refreshBacklogModel } = useBacklogModel(apiClient, initialModel);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState("");
  const { state: filters, updateState: updateFilters } = useTableUrlState({ namespace: "backlog", schema: backlogFilterSchema });
  const backlogLevel = filters.level;
  const viewModel = useMemo(
    () => buildBacklogOverviewViewModel(model, filters, canManageBacklog),
    [canManageBacklog, filters, model],
  );
  const visibleItems = viewModel.visibleItems;
  const { levelTasks, rankEditingEnabled, visibleLevelTasks, visibleTaskIds } = viewModel;
  const {
    assignTasksToSprint,
    assignTaskToSprint,
    isBulkAssigningSprint,
    isReordering,
    message,
    moveTask,
    reorderTask,
  } = useBacklogCommands({
    apiClient,
    canManageBacklog,
    dispatch,
    orderedTasks: viewModel.orderedTasks,
    refreshBacklogModel,
    sprints: [...model.sprints],
  });

  const taskById = useMemo(() => new Map(viewModel.orderedTasks.map((task) => [task.id, task])), [viewModel.orderedTasks]);
  const sprintById = useMemo(() => new Map(model.sprints.map((sprint) => [sprint.id, sprint])), [model.sprints]);
  const draggedTask = taskById.get(draggedTaskId) || null;
  const handleAssignTaskToSprint = (task: Task, sprint: Sprint | null) => {
    setDraggedTaskId("");
    void assignTaskToSprint(task, sprint);
  };
  const activeFilters = viewModel.activeFilters.map(({ reset, ...filter }) => ({
    ...filter,
    onRemove: () => updateFilters(reset),
  }));
  const {
    assignees: assigneeOptions,
    epics: epicOptions,
    initiatives: initiativeOptions,
    priorities: priorityOptions,
    readiness: readinessOptions,
    statuses: statusOptions,
  } = viewModel.filterOptions;
  const parentContext = backlogLevel === "initiative" ? (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-xs font-semibold text-slate-600">Epic</span>
      <CustomSelect
        aria-label="Backlog nach Parent-Epic filtern"
        value={filters.epic}
        onChange={(epic) => updateFilters({ epic })}
        options={epicOptions}
        className="h-10 min-w-44 flex-1 text-sm"
      />
    </div>
  ) : backlogLevel === "deliverable" ? (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-xs font-semibold text-slate-600">Initiative</span>
      <CustomSelect
        aria-label="Backlog nach Parent-Initiative filtern"
        value={filters.initiative}
        onChange={(initiative) => updateFilters({ initiative })}
        options={initiativeOptions}
        className="h-10 min-w-44 flex-1 text-sm"
      />
    </div>
  ) : null;
  const toolbar = (
    <FilterToolbar
      compactMobile
      searchLabel="Backlog durchsuchen"
      searchPlaceholder="Aufgabe, Initiative oder Zuständigkeit suchen"
      query={filters.query}
      onQueryChange={(query) => updateFilters({ query }, "replace")}
      expanded={filtersOpen}
      onExpandedChange={setFiltersOpen}
      activeFilters={activeFilters}
      isDirty={viewModel.filterStateIsDirty}
      onReset={() => updateFilters({ ...DEFAULT_BACKLOG_FILTERS, level: backlogLevel })}
      results={[{ id: "backlog", visibleCount: visibleLevelTasks.length, totalCount: backlogLevel === "deliverable" ? viewModel.allItems.length : levelTasks.length }]}
      panelId="backlog-data-filters"
      leadingControls={(
        <div data-tour-id="backlog-level-switch">
          <PlanningLevelSelect
            ariaLabel="Planungsebene im Backlog"
            value={backlogLevel}
            tasks={[...model.items]}
            onChange={(level) => updateFilters({
              level,
              epic: "Alle",
              initiative: "Alle",
              readiness: "all",
              scope: "all",
            })}
          />
        </div>
      )}
      contextControls={parentContext}
    >
      <div className="grid gap-4">
        {backlogLevel === "deliverable" ? <BacklogScopeTabs scope={filters.scope} counts={viewModel.scopeCounts} onScopeChange={(scope: BacklogScope) => updateFilters({ scope })} /> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <FilterField label="Status"><CustomSelect aria-label="Backlog nach Status filtern" value={filters.status} onChange={(status) => updateFilters({ status })} options={statusOptions} className="h-10 text-sm" /></FilterField>
          {backlogLevel === "deliverable" ? <FilterField label="Planungsstatus"><CustomSelect aria-label="Backlog nach Planungsstatus filtern" value={filters.readiness} onChange={(readiness) => updateFilters({ readiness: readiness as BacklogReadinessFilter })} options={readinessOptions} className="h-10 text-sm" /></FilterField> : null}
          <FilterField label="Priorität"><CustomSelect aria-label="Backlog nach Priorität filtern" value={filters.priority} onChange={(priority) => updateFilters({ priority })} options={priorityOptions} className="h-10 text-sm" /></FilterField>
          <FilterField label="Zuständig"><CustomSelect aria-label="Backlog nach Zuständigkeit filtern" value={filters.assignee} onChange={(assignee) => updateFilters({ assignee })} options={assigneeOptions} className="h-10 text-sm" /></FilterField>
        </div>
      </div>
    </FilterToolbar>
  );

  return (
    <div className="grid gap-4" data-tour-id="backlog-overview">
      {message && <UiNotice role="status" tone={message.includes("aktualisiert") ? "success" : "warning"}>{message}</UiNotice>}
      {toolbar}
      {backlogLevel === "deliverable" && canManageBacklog && !rankEditingEnabled && <UiNotice tone="info">Rangänderungen sind nur in der ungefilterten Backlog-Rangfolge möglich. Sprint-Zuordnungen bleiben verfügbar.</UiNotice>}

      <div className={classNames(
        "grid min-w-0 gap-4",
        backlogLevel === "deliverable" && "xl:grid-cols-[minmax(0,1fr)_340px]",
      )}>
        <div className="grid min-w-0 gap-4">
          <PlanningBacklogTree
            canAssignSprints={backlogLevel === "deliverable" && canManageBacklog}
            canCreate={canManageBacklog}
            data={[...model.items]}
            draggedTaskId={draggedTaskId}
            level={backlogLevel}
            onAssignTaskToSprint={handleAssignTaskToSprint}
            onCreateItem={onCreatePlanningItem}
            onDragTaskEnd={() => setDraggedTaskId("")}
            onDragTaskStart={backlogLevel === "deliverable" && canManageBacklog ? setDraggedTaskId : undefined}
            onOpenTask={onOpenTask}
            sprintBuckets={viewModel.sprintBuckets}
            sprintById={sprintById}
            visibleTaskIds={visibleTaskIds}
          />
          {backlogLevel === "deliverable" ? (
            <details className="overflow-hidden rounded-lg border border-slate-200 bg-white" data-tour-id="backlog-deliverable-ranking">
              <summary className="cursor-pointer border-l-4 border-blue-700 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                Deliverable-Rangfolge und Sprint-Zuordnung
              </summary>
              <div className="border-t border-slate-200">
                <BacklogRankTable
                  key={`backlog-rank:${visibleItems.map((item) => item.task.id).join("|")}`}
                  canManageBacklog={canManageBacklog}
                  canReorder={rankEditingEnabled}
                  draggedTaskId={draggedTaskId}
                  isReordering={isReordering}
                  items={visibleItems}
                  allItems={viewModel.allItems}
                  buckets={viewModel.sprintBuckets}
                  filters={filters}
                  isBulkAssigningSprint={isBulkAssigningSprint}
                  statusOptions={statusOptions}
                  readinessOptions={readinessOptions}
                  priorityOptions={priorityOptions}
                  initiativeOptions={initiativeOptions}
                  assigneeOptions={assigneeOptions}
                  onAssignTaskToSprint={handleAssignTaskToSprint}
                  onAssignTasksToSprint={assignTasksToSprint}
                  onDragTaskEnd={() => setDraggedTaskId("")}
                  onDragTaskStart={setDraggedTaskId}
                  onFiltersChange={updateFilters}
                  onMoveTask={moveTask}
                  onOpenTask={onOpenTask}
                  onProposeDeliverable={onProposeDeliverable}
                  onReorderTask={reorderTask}
                  sprintById={sprintById}
                />
              </div>
            </details>
          ) : null}
        </div>
        {backlogLevel === "deliverable" ? (
          <BacklogSprintPane
            buckets={viewModel.sprintBuckets}
            canManageBacklog={canManageBacklog}
            draggedTask={draggedTask}
            onAssignTaskToSprint={handleAssignTaskToSprint}
            sprintById={sprintById}
          />
        ) : null}
      </div>
    </div>
  );
}
