import { Plus } from "lucide-react";
import type { DragEvent } from "react";
import { TaskStatusBadge } from "@/features/tasks/atoms/task-status-control";
import { EmptyColumn, TaskCard } from "@/features/tasks/molecules/task-card";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import { normalizeStatus } from "@/lib/status";
import type { Package, Profile, Task, TaskBlocker, TaskRelation, TaskStatus } from "@/lib/types";

type TaskBoardViewProps = {
  statuses: TaskStatus[];
  visibleTasks: Task[];
  packages: Package[];
  profiles: Profile[];
  relations: TaskRelation[];
  allTasks: Task[];
  blockers: TaskBlocker[];
  draggedTaskId: string | null;
  selectedTaskId?: string | null;
  dragOverStatus: TaskStatus | null;
  canChangeTaskStatus: (task: Task) => boolean;
  statusOptionsForTask: (task: Task) => TaskStatus[];
  packageForTask: (task: Task) => Package | undefined;
  ownerColorForTask: (task: Task) => string;
  onOpenTask: (task: Task) => void;
  onCreateTask: (defaults: Partial<NewTaskDraft>) => void;
  onUpdateTask: (task: Task, patch: Partial<Task>) => void;
  onDragOverStatus: (status: TaskStatus | null) => void;
  onDropTask: (status: TaskStatus, event: DragEvent<HTMLElement>) => void;
  onDragStart?: (task: Task, event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
};

export function TaskBoardView({
  statuses,
  visibleTasks,
  packages,
  profiles,
  relations,
  allTasks,
  blockers,
  draggedTaskId,
  selectedTaskId = null,
  dragOverStatus,
  canChangeTaskStatus,
  statusOptionsForTask,
  packageForTask,
  ownerColorForTask,
  onOpenTask,
  onCreateTask,
  onUpdateTask,
  onDragOverStatus,
  onDropTask,
  onDragStart,
  onDragEnd,
}: TaskBoardViewProps) {
  void packages;
  void profiles;

  return (
    <div
      className="flex min-w-0 gap-4 overflow-auto pb-3 [scrollbar-gutter:stable] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset"
      tabIndex={0}
      role="region"
      aria-label="Board horizontal und vertikal scrollen"
    >
      {statuses.map((status) => {
        const tasks = visibleTasks.filter((task) => normalizeStatus(task.status) === status);
        return (
          <section
            key={status}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              onDragOverStatus(status);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragOverStatus(null);
            }}
            onDrop={(event) => onDropTask(status, event)}
            className={`min-w-[min(360px,calc(100vw-2rem))] max-w-[min(360px,calc(100vw-2rem))] basis-[min(360px,calc(100vw-2rem))] shrink-0 grow-0 overflow-hidden rounded-lg border bg-blue-50/60 transition ${dragOverStatus === status ? "border-blue-400 ring-2 ring-blue-200" : "border-blue-100"}`}
          >
            <div className="flex min-w-0 items-center justify-between border-b border-blue-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <TaskStatusBadge status={status} size="sm" />
                <span className="text-xs text-slate-500">({tasks.length})</span>
              </div>
              <button type="button" onClick={() => onCreateTask({ status, taskType: "deliverable" })} className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white" aria-label="Aufgabe hinzufügen">
                <Plus size={15} />
              </button>
            </div>
            <div className="grid min-w-0 gap-3 p-3">
              {tasks.length ? tasks.map((task) => {
                const canUpdateStatus = canChangeTaskStatus(task);
                return (
                  <TaskCard
                    key={task.id}
                    task={task}
                    pack={packageForTask(task)}
                    ownerColor={ownerColorForTask(task)}
                    relations={relations}
                    allTasks={allTasks}
                    blockers={blockers}
                    statusOptions={canUpdateStatus ? statusOptionsForTask(task) : [normalizeStatus(task.status)]}
                    statusDisabled={!canUpdateStatus}
                    showEffort={false}
                    showDescription={false}
                    showOpenButton={false}
                    showStatus={false}
                    showStatusControl={false}
                    onOpen={onOpenTask}
                    onStatusChange={(nextTask, nextStatus) => onUpdateTask(nextTask, { status: nextStatus })}
                    onDragStart={canUpdateStatus && onDragStart ? onDragStart : undefined}
                    onDragEnd={onDragEnd}
                    isSelected={selectedTaskId === task.id}
                    isDragging={draggedTaskId === task.id}
                  />
                );
              }) : <EmptyColumn />}
            </div>
          </section>
        );
      })}
    </div>
  );
}
