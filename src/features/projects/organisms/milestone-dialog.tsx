"use client";

import { useId, useState } from "react";
import type { MilestoneStatus } from "@/features/projects/model/milestone-contract";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiButton, UiField, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

export type MilestoneDraft = {
  id?: string;
  title: string;
  description: string;
  targetDate: string;
  status: MilestoneStatus;
  expectedUpdatedAt?: string;
};

const statusOptions = [
  { value: "planned", label: "Geplant" },
  { value: "active", label: "Aktiv" },
  { value: "done", label: "Erledigt" },
];

export function MilestoneDialog({
  defaults,
  onClose,
  onSave,
}: {
  defaults: Partial<MilestoneDraft>;
  onClose: () => void;
  onSave: (draft: MilestoneDraft) => Promise<void>;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const titleValidationId = useId();
  const [draft, setDraft] = useState<MilestoneDraft>({
    id: defaults.id,
    title: defaults.title || "",
    description: defaults.description || "",
    targetDate: defaults.targetDate || "",
    status: defaults.status || "planned",
    expectedUpdatedAt: defaults.expectedUpdatedAt,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose, closeDisabled: pending });
  const canSave = draft.title.trim().length >= 3;
  const heading = draft.id ? "Meilenstein bearbeiten" : "Neuer Meilenstein";

  const submit = async () => {
    if (!canSave || pending) return;
    setPending(true);
    setError("");
    try {
      await onSave(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Meilenstein konnte nicht gespeichert werden.");
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
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Epic / Meilenstein</div>
            <h2 id={titleId} className="mt-1 text-lg font-semibold text-slate-950">{heading}</h2>
            <p id={descriptionId} className="mt-1 text-sm text-slate-500">Pflege Ziel, Status und Termin des Meilensteins.</p>
          </div>
          <UiButton size="xs" disabled={pending} onClick={onClose}>Schließen</UiButton>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid min-h-0 gap-4 overflow-y-auto px-5 py-4">
            <UiField>
              Titel
              <UiTextInput
                data-autofocus
                value={draft.title}
                required
                minLength={3}
                maxLength={240}
                aria-describedby={titleValidationId}
                aria-invalid={draft.title.length > 0 && !canSave}
                disabled={pending}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                inputSize="lg"
                inputPadding="md"
                placeholder="z. B. Marktreife Deutschland"
              />
              <span id={titleValidationId} className={draft.title.length > 0 && !canSave ? "text-red-700" : "text-slate-500"}>
                Der Titel benötigt mindestens 3 Zeichen.
              </span>
            </UiField>
            <UiField>
              Beschreibung
              <UiTextArea
                value={draft.description}
                maxLength={4000}
                disabled={pending}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                minHeight="lg"
                inputPadding="md"
                leading="relaxed"
              />
            </UiField>
            <div className="grid gap-3 sm:grid-cols-2">
              <UiField>
                Status
                <CustomSelect
                  value={draft.status}
                  disabled={pending}
                  onChange={(status) => setDraft((current) => ({ ...current, status: status as MilestoneStatus }))}
                  className="h-10 text-sm"
                  options={statusOptions}
                />
              </UiField>
              <UiField>
                Zieltermin
                <CustomDatePicker
                  value={draft.targetDate}
                  disabled={pending}
                  onChange={(targetDate) => setDraft((current) => ({ ...current, targetDate }))}
                  className="h-10 text-sm"
                />
              </UiField>
            </div>
            {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</div>}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
            <UiButton disabled={pending} onClick={onClose}>Abbrechen</UiButton>
            <UiButton type="submit" variant="primary" disabled={pending || !canSave}>
              {pending ? "Speichert …" : "Speichern"}
            </UiButton>
          </div>
        </form>
      </div>
    </div>
  );
}
