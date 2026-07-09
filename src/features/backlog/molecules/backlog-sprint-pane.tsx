import { Lock, Plus } from "lucide-react";
import type { DragEvent } from "react";
import type { BacklogSprintBucket } from "@/features/backlog/model/backlog-view-model";
import type { Sprint, Task } from "@/lib/types";
import { UiBadge } from "@/shared/atoms/ui-primitives";
import { DataSurface } from "@/shared/molecules/data-surface";

type BacklogSprintPaneProps = {
  buckets: BacklogSprintBucket[];
  canManageBacklog: boolean;
  onAssignTaskToSprint: (task: Task, sprint: Sprint) => void;
  taskById: ReadonlyMap<string, Task>;
};

function dragTaskId(event: DragEvent<HTMLElement>) {
  return event.dataTransfer.getData("text/plain");
}

export function BacklogSprintPane({
  buckets,
  canManageBacklog,
  onAssignTaskToSprint,
  taskById,
}: BacklogSprintPaneProps) {
  return (
    <DataSurface
      title="Sprints"
      description="Sprint bleibt Zeitcontainer, nicht Parent-Ebene."
      actions={<UiBadge tone="blueWhite">{buckets.length} aktiv</UiBadge>}
      data-tour-id="backlog-sprint-pane"
    >
      <div className="grid gap-0">
        {buckets.map((bucket, index) => (
          <section
            key={bucket.sprint.id}
            onDragOver={(event) => {
              if (!canManageBacklog || bucket.locked) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const task = taskById.get(dragTaskId(event));
              if (task) onAssignTaskToSprint(task, bucket.sprint);
            }}
            className="border-b border-slate-100 px-4 py-4 last:border-b-0"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${bucket.isCurrent ? "bg-blue-600" : "bg-slate-400"}`} />
                  <h3 className="font-semibold text-slate-900">{bucket.isCurrent ? "Aktuell" : `Planung ${index}`} · {bucket.sprint.name}</h3>
                </div>
                <p className="mt-1 text-xs text-slate-500">{bucket.sprint.startDate} bis {bucket.sprint.endDate}</p>
              </div>
              {bucket.locked && <Lock size={16} className="text-slate-400" aria-label="Sprint gelockt" />}
            </div>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-slate-500">Geplant</span>
              <span className="font-semibold text-slate-800">{bucket.plannedHours}h / {bucket.capacityHours}h</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-blue-600" style={{ width: `${Math.round(bucket.utilization * 100)}%` }} />
            </div>
            <div className={`mt-4 flex h-10 items-center justify-center rounded-md border border-dashed text-xs ${bucket.locked ? "border-slate-200 bg-slate-50 text-slate-400" : "border-slate-300 bg-white text-slate-500"}`}>
              <Plus size={14} className="mr-1" />
              Items hierher ziehen
            </div>
          </section>
        ))}
      </div>
    </DataSurface>
  );
}
