"use client";

import { CalendarDays, Maximize2, Users, X } from "lucide-react";
import { dateRange, taskOwnerLabel } from "@/lib/display";
import { normalizeStatus, priorityBadgeTone, statusBadgeTone } from "@/lib/status";
import type { Task } from "@/lib/types";
import { UiBadge, UiButton, UiLinkButton } from "@/shared/atoms/ui-primitives";

type Props = {
  task: Task;
  onClose: () => void;
};

export function TaskDetailPanelHeader({ task, onClose }: Props) {
  const status = normalizeStatus(task.status);

  return (
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aufgabendetails</div>
          <h2 className="mt-1 break-words text-xl font-semibold leading-7 text-slate-950">{task.title}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <UiBadge tone={statusBadgeTone(status)}>{status}</UiBadge>
            <UiBadge tone={priorityBadgeTone(task.priority)}>{task.priority}</UiBadge>
            <UiBadge className="gap-1.5 !text-slate-700">
              <Users size={13} />
              {taskOwnerLabel(task)}
            </UiBadge>
            <UiBadge className="gap-1.5 !text-slate-700">
              <CalendarDays size={13} />
              {dateRange(task)}
            </UiBadge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <UiLinkButton
            href={`/tasks/${task.id}?view=full`}
            size="mdXs"
          >
            <Maximize2 size={14} />
            Große Ansicht
          </UiLinkButton>
          <UiButton type="button" onClick={onClose} size="iconMd" className="text-slate-500" aria-label="Detailpanel schließen">
            <X size={16} />
          </UiButton>
        </div>
      </div>
    </div>
  );
}
