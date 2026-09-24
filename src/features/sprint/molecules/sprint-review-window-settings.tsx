"use client";

import { useState } from "react";
import { MAX_REVIEW_OBJECTION_WINDOW_HOURS } from "@/lib/sprint-review-window";
import { UiButton, UiField, UiNotice, UiPanel, UiTextInput } from "@/shared/atoms/ui-primitives";

export function SprintReviewWindowSettings({
  disabled,
  pending,
  reviewObjectionWindowHours,
  onSave,
}: {
  disabled: boolean;
  pending: boolean;
  reviewObjectionWindowHours: number;
  onSave: (hours: number) => Promise<void>;
}) {
  const [draft, setDraft] = useState(String(reviewObjectionWindowHours));
  const [message, setMessage] = useState("");
  const parsed = Number(draft);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_REVIEW_OBJECTION_WINDOW_HOURS;

  return (
    <UiPanel className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">CEO-Governance</p>
        <h2 className="mt-1 text-base font-semibold text-slate-950">Review- und Einspruchsfrist</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Gilt teamweit ab Ende des Sprinttages. Gelockte Sprints bleiben unverändert.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[140px_auto] sm:items-end">
        <UiField>Stunden<UiTextInput type="number" min={1} max={MAX_REVIEW_OBJECTION_WINDOW_HOURS} value={draft} disabled={disabled || pending} onChange={(event) => { setDraft(event.target.value); setMessage(""); }} /></UiField>
        <UiButton variant="primary" disabled={disabled || pending || !valid || parsed === reviewObjectionWindowHours} onClick={() => void onSave(parsed).then(() => setMessage("Frist gespeichert."), (error) => setMessage(error instanceof Error ? error.message : "Frist konnte nicht gespeichert werden."))}>Frist speichern</UiButton>
      </div>
      {message && <UiNotice className="lg:col-span-2" tone={message === "Frist gespeichert." ? "success" : "danger"}>{message}</UiNotice>}
    </UiPanel>
  );
}
