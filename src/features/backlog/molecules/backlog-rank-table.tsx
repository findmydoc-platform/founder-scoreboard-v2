"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import type { BacklogMoveAction, BacklogMoveResult, BacklogPlacement } from "@/features/backlog/hooks/use-backlog-ordering";
import { BacklogReadiness } from "@/features/backlog/molecules/backlog-readiness";
import { BacklogBulkSprintAssignmentMenu } from "@/features/backlog/molecules/backlog-sprint-actions";
import { BacklogTaskActions } from "@/features/backlog/molecules/backlog-task-actions";
import { getBacklogPlanningState } from "@/features/backlog/model/backlog-planning-state";
import { backlogTableColumnCount, backlogTableMinWidth } from "@/features/backlog/model/backlog-table-layout";
import type { BacklogItem, BacklogReadinessFilter, BacklogSort, BacklogSprintBucket, BacklogTableFilters } from "@/features/backlog/model/backlog-view-model";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { taskAssigneeLabel } from "@/lib/display";
import { normalizeStatus, priorityBadgeTone } from "@/lib/status";
import type { Sprint, Task } from "@/lib/types";
import { classNames, UiBadge, UiButton, UiEmptyState } from "@/shared/atoms/ui-primitives";
import { CustomSelect, type CustomSelectOption } from "@/shared/atoms/custom-select";
import { ColumnFilterPopover } from "@/shared/molecules/column-filter-popover";
import { DataCell, DataColumnHeader, DataEmptyRow, DataHeaderCell, DataRow, DataTableFrame, DataTableHead, type SortDirection } from "@/shared/molecules/data-surface";

type DropTarget = {
  placement: BacklogPlacement;
  taskId: string;
};

type BacklogRankTableProps = {
  allItems: BacklogItem[];
  assigneeOptions: CustomSelectOption[];
  buckets: BacklogSprintBucket[];
  canManageBacklog: boolean;
  canReorder: boolean;
  draggedTaskId: string;
  filters: BacklogTableFilters;
  initiativeOptions: CustomSelectOption[];
  isBulkAssigningSprint: boolean;
  isReordering: boolean;
  items: BacklogItem[];
  onAssignTaskToSprint: (task: Task, sprint: Sprint | null) => void;
  onAssignTasksToSprint: (tasks: Task[], sprint: Sprint) => Promise<boolean>;
  onDragTaskEnd: () => void;
  onDragTaskStart: (taskId: string) => void;
  onFiltersChange: (patch: Partial<BacklogTableFilters>) => void;
  onMoveTask: (taskId: string, action: BacklogMoveAction) => BacklogMoveResult;
  onOpenTask: (taskId: string) => void;
  onProposeDeliverable: () => void;
  onReorderTask: (taskId: string, targetTaskId: string, placement: BacklogPlacement) => BacklogMoveResult;
  priorityOptions: CustomSelectOption[];
  readinessOptions: CustomSelectOption[];
  sprintById: ReadonlyMap<string, Sprint>;
  statusOptions: CustomSelectOption[];
};

function SelectionCheckbox({
  checked,
  disabled = false,
  indeterminate = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={onChange}
      className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 accent-blue-600 focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
    />
  );
}

function canSelectForBulkSprintAssignment(task: Task, canManageBacklog: boolean, sprintById: ReadonlyMap<string, Sprint>) {
  if (!canManageBacklog) return false;
  const state = getBacklogPlanningState(task);
  if (state.kind !== "ready" && state.kind !== "scheduled") return false;
  return !task.sprintId || !sprintById.get(task.sprintId)?.scoreLocked;
}

function dragTaskId(event: DragEvent<HTMLElement>) {
  return event.dataTransfer.getData("text/plain");
}

function approvalTone(task: Task) {
  if (task.approvalStatus === "approved") return "emerald";
  if (task.approvalStatus === "proposed") return "amber";
  if (task.approvalStatus === "rejected") return "rose";
  return "slate";
}

function approvalLabel(task: Task) {
  if (task.approvalStatus === "approved") return "Freigegeben";
  if (task.approvalStatus === "proposed") return "Vorgeschlagen";
  if (task.approvalStatus === "rejected") return "Abgelehnt";
  return "Entwurf";
}

function rowStatusDot(task: Task) {
  const status = normalizeStatus(task.status);
  if (status === "Blockiert") return "bg-red-500";
  if (status === "Offen") return "bg-amber-500";
  if (status === "In Arbeit") return "bg-blue-600";
  return "bg-emerald-500";
}

function dropPlacement(event: DragEvent<HTMLTableRowElement>): BacklogPlacement {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY < bounds.top + bounds.height / 2 ? "before" : "after";
}

function RowActions({
  item,
  index,
  props,
}: {
  item: BacklogItem;
  index: number;
  props: Pick<BacklogRankTableProps, "buckets" | "canManageBacklog" | "canReorder" | "isReordering" | "items" | "onAssignTaskToSprint" | "onDragTaskEnd" | "onDragTaskStart" | "onMoveTask" | "sprintById">;
}) {
  return (
    <BacklogTaskActions
      buckets={props.buckets}
      canManageBacklog={props.canManageBacklog}
      canReorder={props.canReorder}
      index={index}
      isReordering={props.isReordering}
      item={item}
      onAssignTaskToSprint={props.onAssignTaskToSprint}
      onDragEnd={props.onDragTaskEnd}
      onDragStart={(event, taskId) => {
        if (!props.canReorder) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", taskId);
        props.onDragTaskStart(taskId);
      }}
      onMoveTask={props.onMoveTask}
      sprintById={props.sprintById}
      total={props.items.length}
    />
  );
}

export function BacklogRankTable({
  allItems,
  assigneeOptions,
  buckets,
  canManageBacklog,
  canReorder,
  draggedTaskId,
  filters,
  initiativeOptions,
  isBulkAssigningSprint,
  isReordering,
  items,
  onAssignTaskToSprint,
  onAssignTasksToSprint,
  onDragTaskEnd,
  onDragTaskStart,
  onFiltersChange,
  onMoveTask,
  onOpenTask,
  onProposeDeliverable,
  onReorderTask,
  priorityOptions,
  readinessOptions,
  sprintById,
  statusOptions,
}: BacklogRankTableProps) {
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const selectableItems = items.filter((item) => canSelectForBulkSprintAssignment(item.task, canManageBacklog, sprintById));
  const selectableTaskIds = new Set(selectableItems.map((item) => item.task.id));
  const selectedTasks = items.filter((item) => selectableTaskIds.has(item.task.id) && selectedTaskIds.has(item.task.id)).map((item) => item.task);
  const allSelectableSelected = selectableItems.length > 0 && selectableItems.every((item) => selectedTaskIds.has(item.task.id));
  const someSelectableSelected = selectableItems.some((item) => selectedTaskIds.has(item.task.id));
  const toggleTaskSelection = (taskId: string) => setSelectedTaskIds((current) => {
    const next = new Set(current);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    return next;
  });
  const toggleAllSelectable = () => setSelectedTaskIds((current) => {
    const next = new Set(current);
    if (allSelectableSelected) selectableItems.forEach((item) => next.delete(item.task.id));
    else selectableItems.forEach((item) => next.add(item.task.id));
    return next;
  });
  const assignSelectedTasksToSprint = async (tasks: Task[], sprint: Sprint) => {
    const saved = await onAssignTasksToSprint(tasks, sprint);
    if (saved) setSelectedTaskIds(new Set());
    return saved;
  };
  const actionProps = {
    buckets,
    canManageBacklog,
    canReorder,
    isReordering,
    items,
    onAssignTaskToSprint,
    onDragTaskEnd: () => {
      setDropTarget(null);
      onDragTaskEnd();
    },
    onDragTaskStart: (taskId: string) => {
      setDropTarget(null);
      onDragTaskStart(taskId);
    },
    onMoveTask,
    sprintById,
  };
  const toggleSort = (sort: BacklogSort) => onFiltersChange({ sort, direction: filters.sort === sort && filters.direction === "asc" ? "desc" : "asc" });
  const directionFor = (sort: BacklogSort): SortDirection => filters.sort === sort ? filters.direction : null;
  const emptyContent = allItems.length
    ? "Keine Aufgaben für diese Filter. Filter zurücksetzen oder die Suche anpassen."
    : "Noch keine Backlog-Aufgaben vorhanden.";

  return (
    <div className="order-1 min-w-0" data-tour-id="backlog-rank-table">
      {selectedTasks.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-x border-t-4 border-blue-700 bg-blue-50 px-4 py-3" role="region" aria-label="Mehrfachauswahl für Sprint-Zuordnung">
          <div>
            <div className="text-sm font-semibold text-blue-950">{selectedTasks.length} Deliverables ausgewählt</div>
            <div className="text-xs text-blue-700">Die Sprint-Zuordnung wird gemeinsam oder gar nicht gespeichert.</div>
          </div>
          <div className="flex items-center gap-2">
            <BacklogBulkSprintAssignmentMenu
              buckets={buckets}
              canManageBacklog={canManageBacklog}
              isPending={isBulkAssigningSprint}
              onAssignTasksToSprint={assignSelectedTasksToSprint}
              selectedTasks={selectedTasks}
              sprintById={sprintById}
            />
            <UiButton
              variant="ghost"
              size="iconXs"
              aria-label="Mehrfachauswahl aufheben"
              onClick={() => setSelectedTaskIds(new Set())}
            >
              <X size={15} aria-hidden="true" />
            </UiButton>
          </div>
        </div>
      ) : null}
      <DataTableFrame
        title="Backlog-Rangfolge"
        description="Rang steuert die nächste Planung; Priorität bleibt die fachliche Dringlichkeit."
        caption="Priorisierte Backlog-Aufgaben"
        results={[{ id: "backlog", visibleCount: items.length, totalCount: allItems.length }]}
        filtering={{ mode: "external", labelledBy: "backlog-data-filters" }}
        actions={canManageBacklog ? <UiButton variant="blue" size="sm" onClick={onProposeDeliverable}><Plus size={15} /> Deliverable vorschlagen</UiButton> : undefined}
        minWidth={backlogTableMinWidth}
        surfaceVariant="structural"
        className={selectedTasks.length ? "border-t-0" : "border-t-4 border-t-blue-700"}
        mobileContent={
          <div className="divide-y divide-slate-200 border-t border-slate-200 bg-white">
            {items.map((item, index) => (
              <article key={item.task.id} className={classNames("grid gap-3 px-4 py-4", item.task.id === draggedTaskId && "bg-blue-50/70 opacity-60", item.rank === 1 && "border-l-4 border-l-blue-700 pl-3")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <SelectionCheckbox
                      checked={selectableTaskIds.has(item.task.id) && selectedTaskIds.has(item.task.id)}
                      disabled={isBulkAssigningSprint || !canSelectForBulkSprintAssignment(item.task, canManageBacklog, sprintById)}
                      label={`${item.task.title} für Sprint-Zuordnung auswählen`}
                      onChange={() => toggleTaskSelection(item.task.id)}
                    />
                    <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-slate-500">#{item.rank}</span>
                      <UiBadge tone={priorityBadgeTone(item.task.priority)} shape="rectangular">{item.task.priority}</UiBadge>
                      <BacklogReadiness item={item} />
                    </div>
                    <TaskReferenceLink task={item.task} onOpenTask={onOpenTask} className="line-clamp-2 text-left font-semibold text-slate-950">
                      {item.task.title}
                    </TaskReferenceLink>
                    </div>
                  </div>
                  <RowActions item={item} index={index} props={actionProps} />
                </div>
                <div className="grid gap-1 text-xs text-slate-600">
                  <span><strong className="font-semibold text-slate-700">Initiative:</strong> {item.initiative?.title || "Nicht gesetzt"}</span>
                  <span><strong className="font-semibold text-slate-700">Zuständig:</strong> {taskAssigneeLabel(item.task)}</span>
                </div>
              </article>
            ))}
            {!items.length && (
              <UiEmptyState className="m-4 rounded-none px-4 py-8">
                <div className="grid justify-items-center gap-3">
                  <span>{emptyContent}</span>
                  {!allItems.length && canManageBacklog && <UiButton variant="blue" size="sm" onClick={onProposeDeliverable}><Plus size={15} /> Deliverable vorschlagen</UiButton>}
                </div>
              </UiEmptyState>
            )}
          </div>
        }
      >
        <DataTableHead>
          <tr>
            <DataHeaderCell aria-label="Backlog-Auswahl und Aktionen">
              <SelectionCheckbox
                checked={allSelectableSelected}
                disabled={isBulkAssigningSprint || !selectableItems.length}
                indeterminate={someSelectableSelected && !allSelectableSelected}
                label={allSelectableSelected ? "Auswahl aller Deliverables aufheben" : "Alle einplanbaren Deliverables auswählen"}
                onChange={toggleAllSelectable}
              />
            </DataHeaderCell>
            <DataColumnHeader label="#" direction={directionFor("rank")} onSort={() => toggleSort("rank")} />
            <DataColumnHeader label="Titel" direction={directionFor("title")} onSort={() => toggleSort("title")} />
            <DataColumnHeader label="Freigabe" direction={directionFor("approval")} onSort={() => toggleSort("approval")} />
            <DataColumnHeader label="Initiative" direction={directionFor("initiative")} onSort={() => toggleSort("initiative")} filter={<ColumnFilterPopover label="Backlog nach Initiative filtern" activeCount={filters.initiative === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ initiative: "Alle" })}><CustomSelect aria-label="Initiative wählen" value={filters.initiative} onChange={(initiative) => onFiltersChange({ initiative })} options={initiativeOptions} className="h-10" /></ColumnFilterPopover>} />
            <DataColumnHeader label="Zuständig" direction={directionFor("assignee")} onSort={() => toggleSort("assignee")} filter={<ColumnFilterPopover label="Backlog nach Zuständigkeit filtern" activeCount={filters.assignee === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ assignee: "Alle" })}><CustomSelect aria-label="Zuständigkeit wählen" value={filters.assignee} onChange={(assignee) => onFiltersChange({ assignee })} options={assigneeOptions} className="h-10" /></ColumnFilterPopover>} />
            <DataColumnHeader label="Priorität" direction={directionFor("priority")} onSort={() => toggleSort("priority")} filter={<ColumnFilterPopover label="Backlog nach Priorität filtern" activeCount={filters.priority === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ priority: "Alle" })}><CustomSelect aria-label="Priorität wählen" value={filters.priority} onChange={(priority) => onFiltersChange({ priority })} options={priorityOptions} className="h-10" /></ColumnFilterPopover>} />
            <DataColumnHeader label="Planungsstatus" direction={directionFor("readiness")} onSort={() => toggleSort("readiness")} filter={<ColumnFilterPopover label="Backlog nach Planungsstatus filtern" activeCount={filters.readiness === "all" ? 0 : 1} onReset={() => onFiltersChange({ readiness: "all" })}><CustomSelect aria-label="Backlog nach Planungsstatus filtern" value={filters.readiness} onChange={(readiness) => onFiltersChange({ readiness: readiness as BacklogReadinessFilter })} options={readinessOptions} className="h-10" /></ColumnFilterPopover>} />
            <DataColumnHeader label="Status" direction={directionFor("status")} onSort={() => toggleSort("status")} filter={<ColumnFilterPopover label="Backlog nach Status filtern" activeCount={filters.status === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ status: "Alle" })}><CustomSelect aria-label="Status wählen" value={filters.status} onChange={(status) => onFiltersChange({ status })} options={statusOptions} className="h-10" /></ColumnFilterPopover>} />
          </tr>
        </DataTableHead>
        <tbody>
          {items.map((item, index) => {
            const target = dropTarget?.taskId === item.task.id ? dropTarget : null;
            const dropClass = target?.placement === "before" ? "border-t-4 border-t-blue-700" : target?.placement === "after" ? "border-b-4 border-b-blue-700" : "";
            return (
              <DataRow
                key={item.task.id}
                onDragOver={(event) => {
                  const sourceTaskId = dragTaskId(event);
                  if (!canReorder || !sourceTaskId || sourceTaskId === item.task.id) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget({ taskId: item.task.id, placement: dropPlacement(event) });
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setDropTarget((current) => current?.taskId === item.task.id ? null : current);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceTaskId = dragTaskId(event);
                  const placement = target?.placement || dropPlacement(event);
                  setDropTarget(null);
                  onDragTaskEnd();
                  if (sourceTaskId && sourceTaskId !== item.task.id) onReorderTask(sourceTaskId, item.task.id, placement);
                }}
                className={classNames(item.rank === 1 && "bg-blue-50/45", item.task.id === draggedTaskId && "opacity-55")}
              >
                <DataCell className={classNames(item.rank === 1 && "border-l-4 border-l-blue-700", dropClass)}>
                  <div className="flex items-center gap-2">
                    <SelectionCheckbox
                      checked={selectableTaskIds.has(item.task.id) && selectedTaskIds.has(item.task.id)}
                      disabled={isBulkAssigningSprint || !canSelectForBulkSprintAssignment(item.task, canManageBacklog, sprintById)}
                      label={`${item.task.title} für Sprint-Zuordnung auswählen`}
                      onChange={() => toggleTaskSelection(item.task.id)}
                    />
                    <RowActions item={item} index={index} props={actionProps} />
                  </div>
                </DataCell>
                <DataCell className={classNames("font-semibold text-slate-600", dropClass)}>#{item.rank}</DataCell>
                <DataCell className={classNames("max-w-sm", dropClass)}><TaskReferenceLink task={item.task} onOpenTask={onOpenTask} className="text-left font-semibold text-slate-950">{item.task.title}</TaskReferenceLink></DataCell>
                <DataCell className={dropClass}><UiBadge tone={approvalTone(item.task)} shape="rectangular">{approvalLabel(item.task)}</UiBadge></DataCell>
                <DataCell className={classNames("max-w-40 text-xs text-slate-600", dropClass)}>{item.initiative?.title || "Nicht gesetzt"}</DataCell>
                <DataCell className={classNames("text-xs text-slate-600", dropClass)}>{taskAssigneeLabel(item.task)}</DataCell>
                <DataCell className={dropClass}><UiBadge tone={priorityBadgeTone(item.task.priority)} shape="rectangular">{item.task.priority}</UiBadge></DataCell>
                <DataCell className={dropClass}><BacklogReadiness item={item} /></DataCell>
                <DataCell className={dropClass}>
                  <span className="inline-flex items-center gap-2 text-xs text-slate-600">
                    <span className={`h-2 w-2 rounded-full ${rowStatusDot(item.task)}`} />
                    {normalizeStatus(item.task.status)}
                  </span>
                </DataCell>
              </DataRow>
            );
          })}
          {!items.length && (
            <DataEmptyRow colSpan={backlogTableColumnCount}>
              <div className="grid justify-items-center gap-3">
                <span>{emptyContent}</span>
                {!allItems.length && canManageBacklog && <UiButton variant="blue" size="sm" onClick={onProposeDeliverable}><Plus size={15} /> Deliverable vorschlagen</UiButton>}
              </div>
            </DataEmptyRow>
          )}
        </tbody>
      </DataTableFrame>
      {isReordering && <div role="status" className="border-x border-b border-slate-300 bg-blue-50 px-4 py-3 text-xs font-semibold text-blue-800">Rangfolge wird gespeichert …</div>}
    </div>
  );
}
