import { GripVertical } from "lucide-react";
import type { DragEvent, KeyboardEvent } from "react";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { BacklogReadiness } from "@/features/backlog/molecules/backlog-readiness";
import { backlogTableColumnCount, backlogTableColumns, backlogTableMinWidth } from "@/features/backlog/model/backlog-table-layout";
import type { BacklogItem } from "@/features/backlog/model/backlog-view-model";
import { taskAssigneeLabel } from "@/lib/display";
import { normalizeStatus, priorityBadgeTone } from "@/lib/status";
import type { Task } from "@/lib/types";
import { UiBadge } from "@/shared/atoms/ui-primitives";
import { DataCell, DataHeaderCell, DataOverflow, DataRow, DataSurface, DataTable, DataTableHead } from "@/shared/molecules/data-surface";

type BacklogRankTableProps = {
  canManageBacklog: boolean;
  isReordering: boolean;
  items: BacklogItem[];
  onMoveTask: (taskId: string, direction: -1 | 1) => void;
  onOpenTask: (taskId: string) => void;
  onReorderTask: (taskId: string, beforeTaskId: string) => void;
};

function dragTaskId(event: DragEvent<HTMLElement>) {
  return event.dataTransfer.getData("text/plain");
}

function typeTone(task: Task) {
  return task.taskType === "proposal" ? "blue" : "emerald";
}

function typeLabel(task: Task) {
  return task.taskType === "proposal" ? "Vorschlag" : "Deliverable";
}

function rowStatusDot(task: Task) {
  const status = normalizeStatus(task.status);
  if (status === "Blockiert") return "bg-red-500";
  if (status === "Offen") return "bg-amber-500";
  if (status === "In Arbeit") return "bg-blue-600";
  if (status === "Vorschlag") return "bg-slate-400";
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
  onMoveTask,
  onOpenTask,
  onReorderTask,
}: BacklogRankTableProps) {
  return (
    <DataSurface data-tour-id="backlog-rank-table">
      <DataOverflow className="max-w-full overflow-x-scroll pb-2">
        <DataTable minWidth={backlogTableMinWidth}>
          <DataTableHead>
            <tr>
              {backlogTableColumns.map((column) => (
                <DataHeaderCell key={column.id}>{column.label}</DataHeaderCell>
              ))}
            </tr>
          </DataTableHead>
          <tbody>
            {items.map((item, index) => (
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
                className={index === 0 ? "bg-blue-50/45" : ""}
              >
                <DataCell className={index === 0 ? "border-l-4 border-l-blue-600" : ""}>
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
                <DataCell className="font-semibold text-slate-600">#{index + 1}</DataCell>
                <DataCell className="max-w-sm">
                  <TaskReferenceLink task={item.task} onOpenTask={onOpenTask} className="text-left font-semibold text-slate-950">
                    {item.task.title}
                  </TaskReferenceLink>
                </DataCell>
                <DataCell><UiBadge tone={typeTone(item.task)}>{typeLabel(item.task)}</UiBadge></DataCell>
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
              <tr>
                <td colSpan={backlogTableColumnCount} className="px-4 py-8 text-center text-sm text-slate-500">
                  Keine Aufgaben in dieser Backlog-Ansicht.
                </td>
              </tr>
            )}
          </tbody>
        </DataTable>
      </DataOverflow>
      {isReordering && <div className="border-t border-slate-100 px-4 py-3 text-xs font-semibold text-blue-700">Speichert...</div>}
    </DataSurface>
  );
}
