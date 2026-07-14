"use client";

import { useId, useState } from "react";
import { buildMilestoneDeletePolicy, formatMilestoneChildCounts } from "@/features/projects/model/milestone-policy";
import type { MilestoneChildCounts } from "@/features/projects/model/milestone-contract";
import type { Milestone } from "@/lib/types";
import { UiButton } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

export type MilestoneDeleteTarget = {
  milestone: Milestone;
  children: MilestoneChildCounts;
};

export function MilestoneDeleteDialog({
  target,
  onClose,
  onConfirm,
}: {
  target: MilestoneDeleteTarget;
  onClose: () => void;
  onConfirm: (milestone: Milestone) => Promise<void>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const policy = buildMilestoneDeletePolicy(target.children);
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose, closeDisabled: pending });

  const confirm = async () => {
    if (!policy.canDelete || pending) return;
    setPending(true);
    setError("");
    try {
      await onConfirm(target.milestone);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Meilenstein konnte nicht gelöscht werden.");
      setPending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">Meilenstein löschen</div>
          <h2 id={titleId} className="mt-1 text-lg font-semibold text-slate-950">Meilenstein endgültig löschen?</h2>
        </div>
        <div className="grid gap-3 px-5 py-4">
          <p className="font-semibold text-slate-900">{target.milestone.title}</p>
          {policy.canDelete ? (
            <p id={descriptionId} className="text-sm leading-6 text-slate-600">
              Der leere Meilenstein wird dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.
            </p>
          ) : (
            <div id={descriptionId} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-900">
              <p className="font-semibold">Nur leere Meilensteine können gelöscht werden.</p>
              <p className="mt-1">Zugeordnet: {formatMilestoneChildCounts(policy.children)}.</p>
            </div>
          )}
          {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <UiButton disabled={pending} onClick={onClose}>Abbrechen</UiButton>
          <UiButton variant="red" disabled={pending || !policy.canDelete} onClick={() => void confirm()}>
            {pending ? "Löscht …" : "Meilenstein löschen"}
          </UiButton>
        </div>
      </div>
    </div>
  );
}
