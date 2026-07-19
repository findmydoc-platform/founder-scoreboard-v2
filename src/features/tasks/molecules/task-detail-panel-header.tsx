"use client";

import { ArrowLeft, Maximize2, X } from "lucide-react";
import type { Task } from "@/lib/types";
import { UiButton, UiLinkButton } from "@/shared/atoms/ui-primitives";

type Props = {
  task: Task;
  previousTask?: Task | null;
  onBack?: () => void;
  onClose: () => void;
  onRequestFullPage?: (href: string) => boolean;
};

export function TaskDetailPanelHeader({ task, previousTask = null, onBack, onClose, onRequestFullPage }: Props) {
  return (
    <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        {previousTask && onBack ? (
          <button
            type="button"
            onClick={onBack}
            data-autofocus
            className="inline-flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm font-semibold text-blue-700 hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-400"
            aria-label={`Zurück zu ${previousTask.title}`}
          >
            <ArrowLeft size={15} className="shrink-0" aria-hidden="true" />
            <span className="truncate">Zurück zu {previousTask.title}</span>
          </button>
        ) : (
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Item-Detail</div>
        )}
        <div className="flex shrink-0 items-center gap-2">
          <UiLinkButton
            href={`/tasks/${task.id}`}
            size="lg"
            data-autofocus={!previousTask || undefined}
            onNavigate={onRequestFullPage ? (event) => {
              if (!onRequestFullPage(`/tasks/${task.id}`)) event.preventDefault();
            } : undefined}
          >
            <Maximize2 size={15} aria-hidden="true" />
            <span className="hidden sm:inline">Große Ansicht</span>
          </UiLinkButton>
          <UiButton type="button" onClick={onClose} size="lg" className="h-11 w-11 px-0 text-slate-500" aria-label="Detailpanel schließen">
            <X size={17} aria-hidden="true" />
          </UiButton>
        </div>
      </div>
    </div>
  );
}
