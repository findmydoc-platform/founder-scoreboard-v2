"use client";

import { X } from "lucide-react";
import { useId, useRef, useState } from "react";
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
  const targetDateLabelId = useId();
  const statusLabelId = useId();
  const errorRef = useRef<HTMLDivElement>(null);
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
  const [titleTouched, setTitleTouched] = useState(false);
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose, closeDisabled: pending });
  const titleLength = draft.title.trim().length;
  const canSave = titleLength >= 3;
  const editing = Boolean(draft.id);
  const heading = editing ? "Meilenstein bearbeiten" : "Neuer Meilenstein";
  const titleError = titleTouched && titleLength < 3
    ? titleLength === 0
      ? "Bitte einen Titel eingeben."
      : "Der Titel benötigt mindestens 3 Zeichen."
    : "";

  const submit = async () => {
    if (!canSave || pending) {
      if (!canSave) {
        setTitleTouched(true);
        dialogRef.current?.querySelector<HTMLInputElement>("[data-autofocus]")?.focus();
      }
      return;
    }
    setPending(true);
    setError("");
    try {
      await onSave(draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Der Meilenstein konnte nicht gespeichert werden.");
      setPending(false);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-0 md:p-4"
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
        className="flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl md:h-auto md:max-h-[calc(100dvh-2rem)] md:max-w-xl md:rounded-xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6 sm:py-5">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700">
              {editing ? "Item bearbeiten" : "Item erstellen"} · Epic / Meilenstein
            </div>
            <h2 id={titleId} className="mt-1.5 text-xl font-semibold tracking-tight text-slate-950">{heading}</h2>
            <p id={descriptionId} className="mt-1 text-sm leading-5 text-slate-500">
              {editing ? "Ziel, Status und Termin des Meilensteins pflegen." : "Gemeinsames Ziel und verbindlichen Termin festlegen."}
            </p>
          </div>
          <UiButton
            size="lg"
            className="h-11 w-11 px-0 text-slate-600"
            disabled={pending}
            onClick={onClose}
            aria-label="Meilenstein-Dialog schließen"
          >
            <X size={19} aria-hidden="true" />
          </UiButton>
        </header>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto overscroll-contain px-5 py-5 [scrollbar-gutter:stable] sm:px-6">
            {error && (
              <div
                ref={errorRef}
                role="alert"
                tabIndex={-1}
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 outline-none focus:ring-2 focus:ring-red-200"
              >
                {error}
              </div>
            )}

            <p className="text-xs font-medium text-slate-500"><span aria-hidden="true">*</span> Pflichtfeld</p>

            <UiField>
              <span>Titel <span aria-hidden="true" className="text-blue-700">*</span></span>
              <UiTextInput
                data-autofocus
                value={draft.title}
                required
                minLength={3}
                maxLength={240}
                aria-describedby={titleError ? titleValidationId : undefined}
                aria-invalid={titleError ? true : undefined}
                disabled={pending}
                onBlur={() => setTitleTouched(true)}
                onInvalid={() => setTitleTouched(true)}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                inputSize="lg"
                inputPadding="md"
                placeholder="z. B. Marktreife Deutschland"
              />
              {titleError && <span id={titleValidationId} className="text-red-700">{titleError}</span>}
            </UiField>

            <UiField>
              Gemeinsames Ziel
              <UiTextArea
                value={draft.description}
                maxLength={4000}
                disabled={pending}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                minHeight="xl"
                inputPadding="md"
                leading="relaxed"
                placeholder="Beschreibe, wann dieses gemeinsame Ziel erreicht ist."
              />
            </UiField>

            <div className="grid gap-4 md:grid-cols-2">
              <UiField as="div">
                <span id={targetDateLabelId}>Zieltermin</span>
                <CustomDatePicker
                  value={draft.targetDate}
                  disabled={pending}
                  onChange={(targetDate) => setDraft((current) => ({ ...current, targetDate }))}
                  aria-labelledby={targetDateLabelId}
                  className="h-11 text-sm"
                />
              </UiField>
              <UiField as="div">
                <span id={statusLabelId}>Status</span>
                <CustomSelect
                  value={draft.status}
                  disabled={pending}
                  onChange={(status) => setDraft((current) => ({ ...current, status: status as MilestoneStatus }))}
                  aria-labelledby={statusLabelId}
                  className="h-11 text-sm"
                  options={statusOptions}
                />
              </UiField>
            </div>

            <p className="text-xs leading-5 text-slate-500">Initiativen werden diesem Meilenstein zugeordnet.</p>
          </div>

          <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
            <UiButton className="w-full sm:w-auto" size="lg" disabled={pending} onClick={onClose}>Abbrechen</UiButton>
            <UiButton className="w-full sm:w-auto" size="lg" type="submit" variant="primary" disabled={pending || !canSave}>
              {pending ? (editing ? "Speichert …" : "Erstellt …") : (editing ? "Speichern" : "Meilenstein erstellen")}
            </UiButton>
          </footer>
        </form>
      </div>
    </div>
  );
}
