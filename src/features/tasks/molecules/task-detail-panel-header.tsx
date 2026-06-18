"use client";

import { CalendarDays, Maximize2, Users, X } from "lucide-react";
import Link from "next/link";
import { dateRange, taskOwnerLabel } from "@/lib/display";
import { normalizeStatus, priorityTone, statusTone } from "@/lib/status";
import type { Task } from "@/lib/types";

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
            <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusTone(status)}`}>{status}</span>
            <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${priorityTone(task.priority)}`}>{task.priority}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
              <Users size={13} />
              {taskOwnerLabel(task)}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
              <CalendarDays size={13} />
              {dateRange(task)}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href={`/tasks/${task.id}?view=full`}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Maximize2 size={14} />
            Große Ansicht
          </Link>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Detailpanel schließen">
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
