"use client";

import { useState } from "react";
import {
  APPROVAL_DECISION_NOTE_MAX_LENGTH,
  type ApprovalReasonAction,
} from "@/lib/approval-decision-policy";
import { UiButton, UiField, UiTextArea } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

const actionCopy = {
  reject: {
    title: "Ablehnung begründen",
    description: "Die Begründung wird am Item angezeigt und dem Antragsteller gesendet.",
    confirmLabel: "Ablehnen",
  },
  return_to_draft: {
    title: "Zur Überarbeitung zurückgeben",
    description: "Beschreibe knapp, was vor einer erneuten Einreichung geklärt oder geändert werden soll.",
    confirmLabel: "Zurückgeben",
  },
} satisfies Record<ApprovalReasonAction, { title: string; description: string; confirmLabel: string }>;

export function ApprovalDecisionDialog({
  action,
  entityLabel,
  pending,
  onClose,
  onConfirm,
}: {
  action: ApprovalReasonAction;
  entityLabel: "Initiative" | "Deliverable";
  pending: boolean;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose, closeDisabled: pending });
  const copy = actionCopy[action];
  const trimmedNote = note.trim();
  const descriptionId = `approval-${action}-description`;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`approval-${action}-title`}
      aria-describedby={descriptionId}
      className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4"
    >
      <form
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending && trimmedNote) onConfirm(trimmedNote);
        }}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">{entityLabel}</div>
          <h2 id={`approval-${action}-title`} className="mt-1 text-lg font-semibold text-slate-950">{copy.title}</h2>
          <p id={descriptionId} className="mt-2 text-sm leading-6 text-slate-600">{copy.description}</p>
        </div>
        <div className="px-5 py-4">
          <UiField>
            Begründung
            <UiTextArea
              autoFocus
              required
              value={note}
              maxLength={APPROVAL_DECISION_NOTE_MAX_LENGTH}
              rows={5}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Was muss nachvollziehbar sein?"
              className="px-3"
            />
          </UiField>
          <div className="mt-1 text-right text-xs text-slate-400">
            {note.length}/{APPROVAL_DECISION_NOTE_MAX_LENGTH}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <UiButton disabled={pending} onClick={onClose}>Abbrechen</UiButton>
          <UiButton type="submit" variant={action === "reject" ? "red" : "primary"} disabled={pending || !trimmedNote}>
            {copy.confirmLabel}
          </UiButton>
        </div>
      </form>
    </div>
  );
}
