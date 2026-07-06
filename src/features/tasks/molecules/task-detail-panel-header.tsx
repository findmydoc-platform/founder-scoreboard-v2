"use client";

import { Maximize2, X } from "lucide-react";
import type { Task } from "@/lib/types";
import { UiButton, UiLinkButton } from "@/shared/atoms/ui-primitives";

type Props = {
  task: Task;
  onClose: () => void;
};

export function TaskDetailPanelHeader({ task, onClose }: Props) {
  return (
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aufgabendetails</div>
          <h2 className="mt-1 break-words text-xl font-semibold leading-7 text-slate-950">{task.title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <UiLinkButton
            href={`/tasks/${task.id}`}
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
