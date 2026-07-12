import { CircleHelp, X } from "lucide-react";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { relationshipHelpText, taskAssigneeLabel } from "@/lib/display";
import { relationshipBadgeFor, relationshipBadgeToneClass } from "@/lib/relationship-view-model";
import { normalizeStatus } from "@/lib/status";
import type { Task, TaskRelation } from "@/lib/types";

function RelationshipInfo({ title }: { title: string }) {
  const description = relationshipHelpText(title);
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        title={description}
        aria-label={`${title}: ${description}`}
        className="grid h-5 w-5 cursor-help place-items-center rounded-full border border-slate-200 bg-white text-slate-400 outline-none transition hover:border-blue-200 hover:text-blue-600 focus:border-blue-300 focus:text-blue-700"
      >
        <CircleHelp size={13} />
      </span>
      <span className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-64 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-slate-700 shadow-lg group-hover:block group-focus-within:block">
        {description}
      </span>
    </span>
  );
}

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
  rows: Array<{ relation: TaskRelation; task?: Task }>;
  empty: string;
  canRemove?: (relation: TaskRelation) => boolean;
  onRemove?: (relation: TaskRelation) => void;
  onOpenTask: (taskId: string) => void;
}) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          {title}
          <RelationshipInfo title={title} />
        </span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{rows.length}</span>
      </div>
      <div className="mt-2 grid gap-1.5">
        {rows.map(({ relation, task }) => {
          const badge = relationshipBadgeFor(currentTask, relation, task);

          return (
            <div key={`${relation.id}-${task?.id || "unknown"}`} className="flex items-start justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-xs">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {task ? (
                    <TaskReferenceLink task={task} onOpenTask={onOpenTask} className="break-words font-semibold text-slate-800">
                      {task.title}
                    </TaskReferenceLink>
                  ) : (
                    <span className="break-words font-semibold text-slate-800">{relation.relatedTaskId}</span>
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
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  aria-label={`${title}-Relationship entfernen`}
                >
                  <X size={13} />
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
