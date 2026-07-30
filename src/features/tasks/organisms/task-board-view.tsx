import { ArrowDownToLine, Plus } from "lucide-react";
import type { DragEvent } from "react";
import { TaskStatusBadge } from "@/features/tasks/atoms/task-status-control";
import { TaskCard } from "@/features/tasks/molecules/task-card";
import { groupSubIssuesByParent } from "@/features/tasks/model/task-card-presentation";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import { normalizeStatus } from "@/lib/status";
import type { Task, TaskBlocker, TaskRelation, TaskStatus } from "@/lib/types";

type TaskBoardViewProps = {
  statuses: TaskStatus[];
  visibleTasks: Task[];
  relations: TaskRelation[];
  allTasks: Task[];
  blockers: TaskBlocker[];
  draggedTaskId: string | null;
  selectedTaskId?: string | null;
  dragOverStatus: TaskStatus | null;
  canChangeTaskStatus: (task: Task) => boolean;
  ownerColorForTask: (task: Task) => string;
  onOpenTask: (taskId: string) => void;
  onCreateTask: (defaults: Partial<NewTaskDraft>) => void;
  onDragOverStatus: (status: TaskStatus | null) => void;
  onDropTask: (status: TaskStatus, event: DragEvent<HTMLElement>) => void;
  onDragStart?: (task: Task, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
};

export function TaskBoardView({
  statuses,
  visibleTasks,
  relations,
  allTasks,
  blockers,
  draggedTaskId,
  selectedTaskId = null,
  dragOverStatus,
  canChangeTaskStatus,
  ownerColorForTask,
  onOpenTask,
  onCreateTask,
  onDragOverStatus,
  onDropTask,
  onDragStart,
  onDragEnd,
}: TaskBoardViewProps) {
  const subIssuesByParent = groupSubIssuesByParent(allTasks);

  return (
    <div
      className="flex min-w-0 gap-3 overflow-auto pb-3 [scrollbar-gutter:stable] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
      tabIndex={0}
      role="region"
      aria-label="Board horizontal und vertikal scrollen"
    >
      {statuses.map((status) => {
        const tasks = visibleTasks.filter((task) => task.taskType === "deliverable" && normalizeStatus(task.status) === status);
        const isEmpty = tasks.length === 0;
        const isDropTarget = dragOverStatus === status;
        const isAvailableEmptyTarget = Boolean(draggedTaskId) && isEmpty;
        return (
          <section
            key={status}
            data-board-column-status={status}
            data-collapsed={isEmpty}
            aria-label={`${status}, ${tasks.length} ${tasks.length === 1 ? "Aufgabe" : "Aufgaben"}${isEmpty ? ", eingeklappt" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              onDragOverStatus(status);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragOverStatus(null);
            }}
            onDrop={(event) => onDropTask(status, event)}
            className={`flex shrink-0 grow-0 flex-col overflow-hidden rounded-lg border bg-slate-50/80 transition-[width,min-width,max-width,border-color,background-color,box-shadow] duration-200 motion-reduce:transition-none ${
              isEmpty
                ? "min-w-24 max-w-24 basis-24"
                : "min-w-[min(320px,calc(100vw-2rem))] max-w-[min(320px,calc(100vw-2rem))] basis-[min(320px,calc(100vw-2rem))]"
            } ${
              isDropTarget
                ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                : isAvailableEmptyTarget
                  ? "border-blue-300 bg-blue-50/70"
                  : "border-slate-200"
            }`}
          >
            <div className={`flex min-w-0 border-b border-slate-200 bg-white ${
              isEmpty ? "flex-col items-center gap-2 px-2 py-3" : "items-center justify-between px-3.5 py-2.5"
            }`}>
              <div className={isEmpty ? "flex min-w-0 flex-col items-center gap-1.5" : "flex items-center gap-2"}>
                <TaskStatusBadge
                  status={status}
                  size="sm"
                  className={isEmpty ? "max-w-full justify-center whitespace-normal px-1.5 text-center leading-4" : undefined}
                />
                <span className="text-xs tabular-nums text-slate-500">({tasks.length})</span>
              </div>
              <button
                type="button"
                onClick={() => onCreateTask({ status, taskType: "deliverable" })}
                className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label={`Aufgabe in ${status} hinzufügen`}
              >
                <Plus size={15} />
              </button>
            </div>
            <div className={isEmpty ? "flex min-h-72 flex-1 justify-center px-2 py-5" : "grid min-w-0 gap-2 p-2"}>
              {tasks.length ? tasks.map((task) => {
                const canUpdateStatus = canChangeTaskStatus(task);
                return (
                  <TaskCard
                    key={task.id}
                    task={task}
                    ownerColor={ownerColorForTask(task)}
                    relations={relations}
                    allTasks={allTasks}
                    blockers={blockers}
                    subIssues={subIssuesByParent.get(task.id) || []}
                    onOpenTask={onOpenTask}
                    onDragStart={canUpdateStatus && onDragStart ? onDragStart : undefined}
                    onDragEnd={onDragEnd}
                    isSelected={selectedTaskId === task.id}
                    isDragging={draggedTaskId === task.id}
                  />
                );
              }) : (
                <div className={`flex flex-col items-center gap-2 text-center text-[11px] font-semibold leading-4 ${
                  draggedTaskId ? "text-blue-700" : "text-slate-400"
                }`}>
                  {draggedTaskId ? (
                    <>
                      <ArrowDownToLine size={18} aria-hidden="true" />
                      <span>{isDropTarget ? "Loslassen" : "Hier ablegen"}</span>
                    </>
                  ) : (
                    <span className="sr-only">Keine Aufgaben in dieser Spalte.</span>
                  )}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
