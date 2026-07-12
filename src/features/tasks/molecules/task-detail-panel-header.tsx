"use client";

import { ArrowLeft, Maximize2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Task } from "@/lib/types";
import { UiButton, UiLinkButton } from "@/shared/atoms/ui-primitives";

type Props = {
  task: Task;
  previousTask?: Task | null;
  onBack?: () => void;
  onClose: () => void;
};

export function TaskDetailPanelHeader({ task, previousTask = null, onBack, onClose }: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [task.id]);

  return (
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {previousTask && onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-sm text-left text-xs font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              aria-label={`Zurück zu ${previousTask.title}`}
            >
              <ArrowLeft size={13} className="shrink-0" aria-hidden="true" />
              <span className="truncate">Zurück zu {previousTask.title}</span>
            </button>
          ) : (
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aufgabendetails</div>
          )}
          <h2
            ref={titleRef}
            id="task-detail-panel-title"
            tabIndex={-1}
            data-autofocus
            className="mt-1 break-words rounded-sm text-xl font-semibold leading-7 text-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            {task.title}
          </h2>
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
