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
import { PlanningLevelSelect } from "@/features/planning/molecules/planning-level-select";
import type { Sprint, Task } from "@/lib/types";
import { classNames, UiNotice, UiButton } from "@/shared/atoms/ui-primitives";
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
  planningState: import("@/features/planning/model/planning-state").PlanningState;
  canManageBacklog: boolean;
  onOpenTask: (taskId: string) => void;
  onCreatePlanningItem: (taskType: BacklogPlanningLevel) => void;
  onProposeDeliverable: () => void;
};

export function BacklogOverview({
  planningState,
  canManageBacklog,
  onOpenTask,
  onCreatePlanningItem,
  onProposeDeliverable,
}: BacklogOverviewProps) {
  const model = useBacklogModel(planningState);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState("");
  const [draggedBasis, setDraggedBasis] = useState<{ task: Task; tasks: Task[]; sprints: Sprint[] } | null>(null);
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
    planningState,
    canManageBacklog,
    orderedTasks: viewModel.orderedTasks,
    sprints: [...model.sprints],
  });

  const taskById = useMemo(() => new Map(viewModel.orderedTasks.map((task) => [task.id, task])), [viewModel.orderedTasks]);
  const sprintById = useMemo(() => new Map(model.sprints.map((sprint) => [sprint.id, sprint])), [model.sprints]);
  const draggedTask = draggedBasis?.task || null;
  const startDrag = (id: string) => { const task = taskById.get(id); setDraggedTaskId(id); setDraggedBasis(task ? { task: structuredClone(task), tasks: structuredClone(viewModel.orderedTasks), sprints: structuredClone([...model.sprints]) } : null); };
  const handleAssignTaskToSprint = (task: Task, sprint: Sprint | null) => {
    setDraggedTaskId("");
    if (draggedBasis && draggedBasis.task.id === task.id) { const target = sprint ? draggedBasis.sprints.find(item => item.id === sprint.id) : null; void planningState.beginBacklogAssignment([draggedBasis.task], draggedBasis.sprints, false).assign(target?.id || null); setDraggedBasis(null); }
    else void assignTaskToSprint(task, sprint);
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

  if (planningState.backlog().readStatus === "forbidden" || planningState.backlog().readStatus === "not-loaded") return <UiNotice>Backlog ist in dieser Sitzung nicht verfügbar.</UiNotice>;
  return (
    <div className="grid gap-4" data-tour-id="backlog-overview">
      {planningState.backlogOrders().filter(item => ["unconfirmed", "blocked", "conflict"].includes(item.phase)).map(item => <UiNotice key={item.id} role="status" tone="warning">
        <p>Verschiebung: {item.source?.title} {item.placement === "before" ? "vor" : "nach"} {item.target?.title}</p>
        <p>{item.error}</p>
        {item.phase === "unconfirmed" ? <p>{item.confirmedIds.length} Positionsänderung{item.confirmedIds.length === 1 ? "" : "en"} bestätigt. Für die übrigen ist das noch unklar.</p> : null}
        {item.serverTasks.length > 0 ? <><p>Reihenfolge der betroffenen Aufgaben:</p><ol aria-label="Aktuelle Reihenfolge der betroffenen Aufgaben" className="list-inside list-decimal">{[...item.serverTasks].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)).map(task => <li key={task.id}>{task.title}</li>)}</ol></> : null}
        <UiButton className="min-h-11" disabled={item.checking} onClick={() => { const editor = planningState.resumeBacklogOrder(item.id); void (item.phase === "conflict" ? editor?.refreshConflict() : editor?.checkOutcome()); }}>Reihenfolge prüfen</UiButton>
        {item.canResave ? <UiButton className="min-h-11" onClick={() => void planningState.resumeBacklogOrder(item.id)?.resave()}>Erneut verschieben</UiButton> : null}
      </UiNotice>)}
      {planningState.backlogAssignments().filter(item => ["unconfirmed", "blocked", "conflict"].includes(item.phase)).map(item => <UiNotice key={item.id} role="status" tone="warning">
        <p>Zuordnung: {item.tasks.map(task => task.title).join(", ")} → {item.targetSprint?.name || "Ohne Sprint"}</p>
        <p>{item.error}</p>
        {item.phase === "unconfirmed" ? <p>{item.confirmedTaskIds.length} von {item.tasks.length} Zuordnungen bestätigt.</p> : null}
        {item.serverTasks.map(task => <p key={task.id}>Aktuell: {task.title} · {task.sprintId ? item.serverSprints.find(sprint => sprint.id === task.sprintId)?.name || sprintById.get(task.sprintId)?.name || "Sprintname nicht verfügbar" : "Ohne Sprint"}</p>)}
        {item.serverSprints.map(sprint => <p key={sprint.id}>Aktueller Sprint: {sprint.name} · {sprint.startDate} bis {sprint.endDate}</p>)}
        <UiButton className="min-h-11" disabled={item.checking} onClick={() => { const editor = planningState.resumeBacklogAssignment(item.id); void (item.phase === "conflict" ? editor?.refreshConflict() : editor?.checkOutcome()); }}>Zuordnung prüfen</UiButton>
        {item.phase === "conflict" && item.canResave ? <UiButton className="min-h-11" onClick={() => void planningState.resumeBacklogAssignment(item.id)?.resave()}>Erneut zuordnen</UiButton> : null}
      </UiNotice>)}
      {(planningState.backlog().model.coverage?.items !== "complete" || Object.values(planningState.backlog().model.coverage || {}).some(value => value !== "complete")) ? <UiNotice>Du siehst nur einen Teil des Backlogs.</UiNotice> : null}
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
            onDragTaskEnd={() => { setDraggedTaskId(""); setDraggedBasis(null); }}
            onDragTaskStart={backlogLevel === "deliverable" && canManageBacklog ? startDrag : undefined}
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
                  orderedTasks={viewModel.orderedTasks}
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
                  onDragTaskEnd={() => { setDraggedTaskId(""); setDraggedBasis(null); }}
                  onDragTaskStart={startDrag}
                  onFiltersChange={updateFilters}
                  onMoveTask={moveTask}
                  onOpenTask={onOpenTask}
                  onProposeDeliverable={onProposeDeliverable}
                  onReorderTask={(source, target, placement) => reorderTask(source,target,placement,draggedBasis?.tasks || viewModel.orderedTasks)}
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
