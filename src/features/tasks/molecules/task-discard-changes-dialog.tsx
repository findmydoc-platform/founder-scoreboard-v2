"use client";

import { AlertTriangle } from "lucide-react";
import { UiButton } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

export function TaskDiscardChangesDialog({
  open,
  onDiscard,
  onKeepEditing,
}: {
  open: boolean;
  onDiscard: () => void;
  onKeepEditing: () => void;
}) {
  const dialogRef = useModalDialog<HTMLDivElement>({ open, onClose: onKeepEditing });
  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="task-discard-changes-title"
      aria-describedby="task-discard-changes-description"
      className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 px-5 py-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700" aria-hidden="true">
            <AlertTriangle size={19} />
          </span>
          <div className="min-w-0">
            <h2 id="task-discard-changes-title" className="text-lg font-semibold text-slate-950">
              Ungespeicherte Änderungen verwerfen?
            </h2>
            <p id="task-discard-changes-description" className="mt-2 text-sm leading-6 text-slate-600">
              Deine Änderungen an der Übersicht wurden noch nicht gespeichert.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <UiButton type="button" variant="red" size="lg" onClick={onDiscard}>
            Änderungen verwerfen
          </UiButton>
          <UiButton type="button" variant="primary" size="lg" data-autofocus onClick={onKeepEditing}>
            Weiter bearbeiten
          </UiButton>
        </div>
      </div>
    </div>
  );
}
