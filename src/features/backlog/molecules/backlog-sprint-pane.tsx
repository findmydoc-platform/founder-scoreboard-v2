"use client";

import { CalendarPlus, Lock } from "lucide-react";
import { useState, type DragEvent } from "react";
import {
  backlogSprintAssignmentMessage,
  getBacklogSprintAssignmentEligibility,
} from "@/features/backlog/model/backlog-planning-state";
import type { BacklogSprintBucket } from "@/features/backlog/model/backlog-view-model";
import { formatDate } from "@/lib/display";
import type { Sprint, Task } from "@/lib/types";
import { classNames, UiBadge, UiEmptyState } from "@/shared/atoms/ui-primitives";
import { DataSurface } from "@/shared/molecules/data-surface";

type DropState = {
  allowed: boolean;
  sprintId: string;
};

type BacklogSprintPaneProps = {
  buckets: BacklogSprintBucket[];
  canManageBacklog: boolean;
  draggedTask: Task | null;
  onAssignTaskToSprint: (task: Task, sprint: Sprint | null) => void;
  sprintById: ReadonlyMap<string, Sprint>;
};

function sourceSprintLocked(task: Task, sprintById: ReadonlyMap<string, Sprint>) {
  return Boolean(task.sprintId && sprintById.get(task.sprintId)?.scoreLocked);
}

function capacityLabel(bucket: BacklogSprintBucket) {
  if (bucket.capacityUnavailable) return "Kapazität prüfen";
  return `${bucket.plannedHours}h / ${bucket.capacityHours}h`;
}

export function BacklogSprintPane({
  buckets,
  canManageBacklog,
  draggedTask,
  onAssignTaskToSprint,
  sprintById,
}: BacklogSprintPaneProps) {
  const [dropState, setDropState] = useState<DropState | null>(null);

  return (
    <DataSurface
      title="Sprints"
      description="Offene Sprints für freigegebene Deliverables."
      actions={<UiBadge tone="blueWhite" shape="rectangular">{buckets.length} offen</UiBadge>}
      variant="structural"
      className="order-2 border-t-4 border-t-slate-900"
      data-tour-id="backlog-sprint-pane"
    >
      {!buckets.length ? (
        <UiEmptyState className="m-4 rounded-none px-4 py-8">
          Keine offenen Sprints. Lege zuerst einen Sprint an oder öffne einen geplanten Sprint.
        </UiEmptyState>
      ) : (
        <div className="grid divide-y divide-slate-200 lg:flex lg:divide-x lg:divide-y-0 lg:overflow-x-auto xl:grid xl:divide-x-0 xl:divide-y xl:overflow-visible">
          {buckets.map((bucket, index) => {
            const eligibility = draggedTask
              ? getBacklogSprintAssignmentEligibility(draggedTask, bucket.sprint, {
                  canManage: canManageBacklog,
                  sourceSprintLocked: sourceSprintLocked(draggedTask, sprintById),
                })
              : null;
            const allowed = Boolean(eligibility?.ok && eligibility.action !== "noop");
            const isDropTarget = dropState?.sprintId === bucket.sprint.id;
            const dropMessage = eligibility && (!eligibility.ok || eligibility.action === "noop")
              ? backlogSprintAssignmentMessage(eligibility.reason)
              : "Deliverable hier ablegen";
            const utilization = bucket.capacityHours && bucket.capacityHours > 0
              ? Math.min(bucket.utilization, 1)
              : 0;

            return (
              <section
                key={bucket.sprint.id}
                onDragOver={(event: DragEvent<HTMLElement>) => {
                  if (!draggedTask) return;
                  setDropState({ sprintId: bucket.sprint.id, allowed });
                  if (!allowed) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setDropState((current) => current?.sprintId === bucket.sprint.id ? null : current);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDropState(null);
                  if (draggedTask && allowed) onAssignTaskToSprint(draggedTask, bucket.sprint);
                }}
                className={classNames(
                  "min-w-0 px-4 py-4 lg:w-[19rem] lg:flex-none xl:w-auto",
                  isDropTarget && dropState?.allowed && "bg-blue-50",
                  isDropTarget && !dropState?.allowed && "bg-amber-50",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${bucket.isCurrent ? "bg-blue-700" : "bg-slate-500"}`} />
                      <h3 className="font-semibold text-slate-950">{bucket.isCurrent ? "Aktuell" : `Planung ${index + 1}`} · {bucket.sprint.name}</h3>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{formatDate(bucket.sprint.startDate)} bis {formatDate(bucket.sprint.endDate)}</p>
                  </div>
                  {bucket.locked ? <UiBadge tone="slate" shape="rectangular"><Lock size={13} /> Gesperrt</UiBadge> : <UiBadge tone="blueWhite" shape="rectangular">Offen</UiBadge>}
                </div>

                <div className="mt-4 flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-slate-500">Geplant</span>
                  <span className={classNames("font-semibold", bucket.overCapacity ? "text-red-700" : "text-slate-900")}>{capacityLabel(bucket)}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-none bg-slate-100" aria-label={`Kapazität: ${capacityLabel(bucket)}`}>
                  <div className={classNames("h-full", bucket.overCapacity ? "bg-red-600" : "bg-blue-700")} style={{ width: `${Math.round(utilization * 100)}%` }} />
                </div>
                <div className="mt-2 min-h-5 text-xs">
                  {bucket.capacityUnavailable && <span className="font-semibold text-amber-700">Sprint-Zeitraum oder Kapazität prüfen.</span>}
                  {bucket.overCapacity && <span className="font-semibold text-red-700">Überplant um {bucket.overCapacityHours}h.</span>}
                </div>

                <div
                  className={classNames(
                    "mt-4 flex min-h-10 items-center justify-center border border-dashed px-3 text-center text-xs font-semibold",
                    bucket.locked ? "border-slate-300 bg-slate-100 text-slate-500" : isDropTarget && dropState?.allowed ? "border-blue-700 bg-blue-100 text-blue-800" : isDropTarget ? "border-amber-400 bg-amber-100 text-amber-800" : "border-slate-400 bg-white text-slate-600",
                  )}
                  aria-live="polite"
                >
                  {bucket.locked ? <><Lock size={14} className="mr-1.5" /> Sprint gesperrt</> : <><CalendarPlus size={14} className="mr-1.5" /> {isDropTarget ? dropMessage : "Deliverable hier ablegen"}</>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </DataSurface>
  );
}
