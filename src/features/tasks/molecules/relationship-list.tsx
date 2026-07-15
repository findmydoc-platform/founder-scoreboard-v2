import { X } from "lucide-react";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import type { TaskRelationshipRow } from "@/features/tasks/model/task-detail-state";
import { taskAssigneeLabel } from "@/lib/display";
import { relationshipBadgeFor, relationshipBadgeToneClass } from "@/lib/relationship-view-model";
import { normalizeStatus } from "@/lib/status";
import type { Task, TaskRelation } from "@/lib/types";

export function RelationshipList({
  title,
  currentTask,
  rows,
  empty,
  canRemove,
  onRemove,
  onOpenTask,
}: {
  title: string;
  currentTask: Task;
  rows: TaskRelationshipRow[];
  empty: string;
  canRemove?: (relation: TaskRelation) => boolean;
  onRemove?: (relation: TaskRelation) => void;
  onOpenTask: (taskId: string) => void;
}) {
  return (
    <div className={title === "Wartet auf" ? "rounded-lg border border-amber-200 bg-amber-50/60 p-4" : "rounded-lg border border-slate-200 bg-slate-50 p-4"}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={title === "Wartet auf" ? "text-sm font-semibold text-amber-950" : "text-sm font-semibold text-slate-800"}>{title}</h3>
        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">{rows.length}</span>
      </div>
      <div className="mt-3 grid gap-2">
        {rows.map(({ relation, linkedTaskId, task }) => {
          const badge = relationshipBadgeFor(currentTask, relation, task);

          return (
            <div key={`${relation.id}-${linkedTaskId}`} className="flex min-h-14 items-start justify-between gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2.5 text-xs shadow-sm">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {task ? (
                    <TaskReferenceLink task={task} onOpenTask={onOpenTask} className="break-words font-semibold text-slate-800">
                      {task.title}
                    </TaskReferenceLink>
                  ) : (
                    <span className="break-words font-semibold text-slate-800">{linkedTaskId}</span>
                  )}
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${relationshipBadgeToneClass(badge.tone)}`}>
                    {badge.label}
                  </span>
                </div>
                <div className="mt-0.5 text-slate-500">{task ? `${normalizeStatus(task.status)} · ${taskAssigneeLabel(task)}` : "Aufgabe nicht gefunden"}</div>
                {relation.note && <div className="mt-1 break-words text-slate-500">{relation.note}</div>}
              </div>
              {canRemove?.(relation) && onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(relation)}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  aria-label={`Beziehung zu ${task?.title || linkedTaskId} entfernen`}
                >
                  <X size={15} />
                </button>
              )}
            </div>
          );
        })}
        {!rows.length && <div className="text-xs text-slate-500">{empty}</div>}
      </div>
    </div>
  );
}
