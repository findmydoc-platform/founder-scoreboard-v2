import { GripVertical } from "lucide-react";
import type { DragEvent, KeyboardEvent, ReactNode } from "react";
import { CustomSelect, type CustomSelectOption } from "@/shared/atoms/custom-select";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { BacklogReadiness } from "@/features/backlog/molecules/backlog-readiness";
import { backlogTableColumnCount, backlogTableMinWidth } from "@/features/backlog/model/backlog-table-layout";
import type { BacklogItem, BacklogReadinessFilter, BacklogSort, BacklogTableFilters } from "@/features/backlog/model/backlog-view-model";
import { taskAssigneeLabel } from "@/lib/display";
import { normalizeStatus, priorityBadgeTone } from "@/lib/status";
import type { Task } from "@/lib/types";
import { UiBadge } from "@/shared/atoms/ui-primitives";
import { ColumnFilterPopover } from "@/shared/molecules/column-filter-popover";
import { DataCell, DataColumnHeader, DataEmptyRow, DataHeaderCell, DataRow, DataTableFrame, DataTableHead, type SortDirection } from "@/shared/molecules/data-surface";

type BacklogRankTableProps = {
  canManageBacklog: boolean;
  isReordering: boolean;
  items: BacklogItem[];
  allItems: BacklogItem[];
  filters: BacklogTableFilters;
  toolbar: ReactNode;
  statusOptions: CustomSelectOption[];
  readinessOptions: CustomSelectOption[];
  priorityOptions: CustomSelectOption[];
  initiativeOptions: CustomSelectOption[];
  assigneeOptions: CustomSelectOption[];
  onFiltersChange: (patch: Partial<BacklogTableFilters>) => void;
  onMoveTask: (taskId: string, direction: -1 | 1) => void;
  onOpenTask: (taskId: string) => void;
  onReorderTask: (taskId: string, beforeTaskId: string) => void;
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

function onHandleKeyDown(event: KeyboardEvent<HTMLButtonElement>, taskId: string, onMoveTask: BacklogRankTableProps["onMoveTask"]) {
  if (!event.altKey) return;
  if (event.key === "ArrowUp") {
    event.preventDefault();
    onMoveTask(taskId, -1);
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    onMoveTask(taskId, 1);
  }
}

export function BacklogRankTable({
  canManageBacklog,
  isReordering,
  items,
  allItems,
  filters,
  toolbar,
  statusOptions,
  readinessOptions,
  priorityOptions,
  initiativeOptions,
  assigneeOptions,
  onFiltersChange,
  onMoveTask,
  onOpenTask,
  onReorderTask,
}: BacklogRankTableProps) {
  const toggleSort = (sort: BacklogSort) => onFiltersChange({ sort, direction: filters.sort === sort && filters.direction === "asc" ? "desc" : "asc" });
  const directionFor = (sort: BacklogSort): SortDirection => filters.sort === sort ? filters.direction : null;
  return (
    <div data-tour-id="backlog-rank-table">
      <DataTableFrame
      title="Backlog-Rangfolge"
      caption="Priorisierte Backlog-Aufgaben"
      results={[{ id: "backlog", visibleCount: items.length, totalCount: allItems.length }]}
      filtering={{ mode: "embedded", toolbar }}
      minWidth={backlogTableMinWidth}
      >
          <DataTableHead>
            <tr>
              <DataHeaderCell aria-label="Rang verschieben" />
              <DataColumnHeader label="#" direction={directionFor("rank")} onSort={() => toggleSort("rank")} />
              <DataColumnHeader label="Titel" direction={directionFor("title")} onSort={() => toggleSort("title")} />
              <DataColumnHeader label="Freigabe" direction={directionFor("approval")} onSort={() => toggleSort("approval")} />
              <DataColumnHeader label="Initiative" direction={directionFor("initiative")} onSort={() => toggleSort("initiative")} filter={<ColumnFilterPopover label="Backlog nach Initiative filtern" activeCount={filters.initiative === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ initiative: "Alle" })}><CustomSelect aria-label="Initiative wählen" value={filters.initiative} onChange={(initiative) => onFiltersChange({ initiative })} options={initiativeOptions} className="h-10" /></ColumnFilterPopover>} />
              <DataColumnHeader label="Zuständig" direction={directionFor("assignee")} onSort={() => toggleSort("assignee")} filter={<ColumnFilterPopover label="Backlog nach Zuständigkeit filtern" activeCount={filters.assignee === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ assignee: "Alle" })}><CustomSelect aria-label="Zuständigkeit wählen" value={filters.assignee} onChange={(assignee) => onFiltersChange({ assignee })} options={assigneeOptions} className="h-10" /></ColumnFilterPopover>} />
              <DataColumnHeader label="Priorität" direction={directionFor("priority")} onSort={() => toggleSort("priority")} filter={<ColumnFilterPopover label="Backlog nach Priorität filtern" activeCount={filters.priority === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ priority: "Alle" })}><CustomSelect aria-label="Priorität wählen" value={filters.priority} onChange={(priority) => onFiltersChange({ priority })} options={priorityOptions} className="h-10" /></ColumnFilterPopover>} />
              <DataColumnHeader label="Bereitschaft" direction={directionFor("readiness")} onSort={() => toggleSort("readiness")} filter={<ColumnFilterPopover label="Backlog nach Bereitschaft filtern" activeCount={filters.readiness === "all" ? 0 : 1} onReset={() => onFiltersChange({ readiness: "all" })}><CustomSelect aria-label="Bereitschaft wählen" value={filters.readiness} onChange={(readiness) => onFiltersChange({ readiness: readiness as BacklogReadinessFilter })} options={readinessOptions} className="h-10" /></ColumnFilterPopover>} />
              <DataColumnHeader label="Status" direction={directionFor("status")} onSort={() => toggleSort("status")} filter={<ColumnFilterPopover label="Backlog nach Status filtern" activeCount={filters.status === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ status: "Alle" })}><CustomSelect aria-label="Status wählen" value={filters.status} onChange={(status) => onFiltersChange({ status })} options={statusOptions} className="h-10" /></ColumnFilterPopover>} />
            </tr>
          </DataTableHead>
          <tbody>
            {items.map((item) => (
              <DataRow
                key={item.task.id}
                draggable={canManageBacklog}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", item.task.id);
                }}
                onDragOver={(event) => {
                  if (!canManageBacklog) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  onReorderTask(dragTaskId(event), item.task.id);
                }}
                className={item.rank === 1 ? "bg-blue-50/45" : ""}
              >
                <DataCell className={item.rank === 1 ? "border-l-4 border-l-blue-600" : ""}>
                  <button
                    type="button"
                    disabled={!canManageBacklog}
                    onKeyDown={(event) => onHandleKeyDown(event, item.task.id, onMoveTask)}
                    className="grid h-8 w-8 place-items-center rounded-md text-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Backlog-Rang ändern"
                    title="Backlog-Rang per Drag oder Alt+Pfeiltasten ändern"
                  >
                    <GripVertical size={16} />
                  </button>
                </DataCell>
                <DataCell className="font-semibold text-slate-600">#{item.rank}</DataCell>
                <DataCell className="max-w-sm">
                  <TaskReferenceLink task={item.task} onOpenTask={onOpenTask} className="text-left font-semibold text-slate-950">
                    {item.task.title}
                  </TaskReferenceLink>
                </DataCell>
                <DataCell><UiBadge tone={approvalTone(item.task)}>{approvalLabel(item.task)}</UiBadge></DataCell>
                <DataCell className="max-w-40 text-xs text-slate-600">{item.initiative?.title || "Nicht gesetzt"}</DataCell>
                <DataCell className="text-xs text-slate-600">{taskAssigneeLabel(item.task)}</DataCell>
                <DataCell><UiBadge tone={priorityBadgeTone(item.task.priority)}>{item.task.priority}</UiBadge></DataCell>
                <DataCell><BacklogReadiness item={item} /></DataCell>
                <DataCell>
                  <span className="inline-flex items-center gap-2 text-xs text-slate-600">
                    <span className={`h-2 w-2 rounded-full ${rowStatusDot(item.task)}`} />
                    {normalizeStatus(item.task.status)}
                  </span>
                </DataCell>
              </DataRow>
            ))}
            {!items.length && (
              <DataEmptyRow colSpan={backlogTableColumnCount}>{allItems.length ? "Keine Aufgaben für diese Filter." : "Noch keine Backlog-Aufgaben vorhanden."}</DataEmptyRow>
            )}
          </tbody>
      </DataTableFrame>
      {isReordering && <div className="border-x border-b border-slate-100 bg-white px-4 py-3 text-xs font-semibold text-blue-700">Speichert...</div>}
    </div>
  );
}
