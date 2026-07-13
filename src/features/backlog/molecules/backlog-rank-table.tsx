"use client";

import { Plus } from "lucide-react";
import { useState, type DragEvent, type ReactNode } from "react";
import type { BacklogMoveAction, BacklogMoveResult, BacklogPlacement } from "@/features/backlog/hooks/use-backlog-ordering";
import { BacklogReadiness } from "@/features/backlog/molecules/backlog-readiness";
import { BacklogTaskActions } from "@/features/backlog/molecules/backlog-task-actions";
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
  isReordering: boolean;
  items: BacklogItem[];
  onAssignTaskToSprint: (task: Task, sprint: Sprint | null) => void;
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
  toolbar: ReactNode;
};

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
  isReordering,
  items,
  onAssignTaskToSprint,
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
  toolbar,
}: BacklogRankTableProps) {
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
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
      <DataTableFrame
        title="Backlog-Rangfolge"
        description="Rang steuert die nächste Planung; Priorität bleibt die fachliche Dringlichkeit."
        caption="Priorisierte Backlog-Aufgaben"
        results={[{ id: "backlog", visibleCount: items.length, totalCount: allItems.length }]}
        filtering={{ mode: "embedded", toolbar }}
        actions={canManageBacklog ? <UiButton variant="blue" size="sm" onClick={onProposeDeliverable}><Plus size={15} /> Deliverable vorschlagen</UiButton> : undefined}
        minWidth={backlogTableMinWidth}
        surfaceVariant="structural"
        className="border-t-4 border-t-blue-700"
        mobileContent={
          <div className="divide-y divide-slate-200 border-t border-slate-200 bg-white">
            {items.map((item, index) => (
              <article key={item.task.id} className={classNames("grid gap-3 px-4 py-4", item.task.id === draggedTaskId && "bg-blue-50/70 opacity-60", item.rank === 1 && "border-l-4 border-l-blue-700 pl-3")}>
                <div className="flex items-start justify-between gap-3">
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
            <DataHeaderCell aria-label="Backlog-Aktionen" />
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
                <DataCell className={classNames(item.rank === 1 && "border-l-4 border-l-blue-700", dropClass)}><RowActions item={item} index={index} props={actionProps} /></DataCell>
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
