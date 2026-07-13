"use client";

import { useState } from "react";
import {
  PLANNING_TRASH_REASON_MAX_LENGTH,
  type PlanningTrashAction,
} from "@/features/planning/model/planning-trash-contract";
import { UiButton, UiField, UiTextArea } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

const actionCopy = {
  withdraw: {
    title: "In den Papierkorb verschieben",
    description: "Das Item verschwindet aus der aktiven Planung und kann später durch CEO oder Deputy wiederhergestellt werden.",
    confirmLabel: "Zurückziehen",
  },
  restore: {
    title: "Aus dem Papierkorb wiederherstellen",
    description: "Das Item kehrt in die aktive Planung zurück und muss anschließend erneut freigegeben werden.",
    confirmLabel: "Wiederherstellen",
  },
} satisfies Record<PlanningTrashAction, { title: string; description: string; confirmLabel: string }>;

export function PlanningTrashActionDialog({
  action,
  entityLabel,
  itemTitle,
  pending,
  onClose,
  onConfirm,
}: {
  action: PlanningTrashAction;
  entityLabel: "Initiative" | "Deliverable";
  itemTitle: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose, closeDisabled: pending });
  const copy = actionCopy[action];
  const trimmedReason = reason.trim();
  const requiresReason = action === "withdraw";
  const confirmDisabled = pending || (requiresReason && !trimmedReason);
  const titleId = `planning-trash-${action}-title`;
  const descriptionId = `planning-trash-${action}-description`;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4"
    >
      <form
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (!confirmDisabled) onConfirm(trimmedReason);
        }}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">{entityLabel}</div>
          <h2 id={titleId} className="mt-1 text-lg font-semibold text-slate-950">{copy.title}</h2>
          <p className="mt-1 truncate text-sm font-medium text-slate-800">{itemTitle}</p>
          <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">{copy.description}</p>
        </div>
        {requiresReason && (
          <div className="px-5 py-4">
            <UiField>
              Begründung
              <UiTextArea
                data-autofocus
                required
                value={reason}
                maxLength={PLANNING_TRASH_REASON_MAX_LENGTH}
                rows={5}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Warum soll das Item aus der aktiven Planung entfernt werden?"
                className="px-3"
              />
            </UiField>
            <div className="mt-1 text-right text-xs text-slate-400">
              {reason.length}/{PLANNING_TRASH_REASON_MAX_LENGTH}
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <UiButton disabled={pending} onClick={onClose}>Abbrechen</UiButton>
          <UiButton type="submit" variant={action === "withdraw" ? "red" : "primary"} disabled={confirmDisabled}>
            {copy.confirmLabel}
          </UiButton>
        </div>
      </form>
    </div>
  );
}
