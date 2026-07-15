import { ArrowRight, History } from "lucide-react";
import { formatDate } from "@/lib/display";
import type { Profile, Task } from "@/lib/types";

type Props = {
  task: Task;
  profiles: Profile[];
};

export function TaskDetailHistorySummary({ task, profiles }: Props) {
  const assigneeProfile = profiles.find((profile) => profile.name === task.assignee || profile.id === task.assignee);
  const creatorProfile = profiles.find((profile) => profile.name === task.createdBy || profile.id === task.createdBy)
    || profiles.find((profile) => profile.platformRole === "ceo")
    || assigneeProfile;
  const hasCarryover = Boolean(task.carriedFromSprintId || task.carryoverReason || task.sprintOutcome);

  return (
    <footer className="mt-5 border-t border-slate-200 pt-4" aria-label="Item-Historie">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-slate-500">
        <History size={14} aria-hidden="true" />
        <span>Erstellt von <strong className="font-semibold text-slate-700">{creatorProfile?.name || task.createdBy || "Unbekannt"}</strong></span>
        {task.updatedAt ? <span>Aktualisiert {formatDate(task.updatedAt, { includeYear: true })}</span> : null}
      </div>
      {hasCarryover ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          <ArrowRight size={14} className="shrink-0 text-blue-600" aria-hidden="true" />
          {task.carriedFromSprintId ? <span>Aus Sprint {task.carriedFromSprintId} übertragen</span> : null}
          {task.sprintOutcome ? <span>· Outcome: {task.sprintOutcome}</span> : null}
          {task.carryoverReason ? <span>· {task.carryoverReason}</span> : null}
        </div>
      ) : null}
    </footer>
  );
}
