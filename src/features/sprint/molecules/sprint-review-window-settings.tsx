"use client";

import { useEffect, useState } from "react";
import { MAX_REVIEW_OBJECTION_WINDOW_HOURS } from "@/lib/sprint-review-window";
import { UiButton, UiField, UiNotice, UiPanel, UiTextInput } from "@/shared/atoms/ui-primitives";

export function SprintReviewWindowSettings({
  disabled,
  pending,
  reviewObjectionWindowHours,
  planningState,
}: {
  disabled: boolean;
  pending: boolean;
  reviewObjectionWindowHours: number;
  planningState: import("@/features/planning/model/planning-state").PlanningState;
}) {
  const shared = planningState.reviewWindow();
  const retained = shared.edits.find(edit => ["unconfirmed", "blocked", "conflict"].includes(edit.phase));
  const [editor, setEditor] = useState<import("../model/review-window-editing").ReviewWindowEditor | null>(() => planningState.resumeReviewWindowEdit());
  useEffect(() => () => editor?.close(), [editor]);
  const edit = editor?.view() || retained;
  const [draft, setDraft] = useState<string | null>(() => retained?.submittedHours == null ? null : String(retained.submittedHours));
  const value = draft ?? String(reviewObjectionWindowHours);
  const blocked = Boolean(edit && ["saving", "unconfirmed", "blocked", "conflict"].includes(edit.phase));
  const [message, setMessage] = useState("");
  const parsed = Number(value);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_REVIEW_OBJECTION_WINDOW_HOURS;

  async function save(conscious = false) {
    const active = editor || planningState.beginReviewWindowEdit(reviewObjectionWindowHours);
    setEditor(active);
    const result = await (conscious ? active.resave(parsed) : active.save(parsed));
    if (result.ok) { setDraft(null); setMessage("Frist gespeichert."); }
    else setMessage(result.error);
  }
  if (shared.hours === null) return <UiNotice tone="danger">Kein Zugriff auf die Prozesseinstellung.</UiNotice>;
  return (
    <UiPanel className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">CEO-Governance</p>
        <h2 className="mt-1 text-base font-semibold text-slate-950">Review- und Einspruchsfrist</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">Gilt teamweit ab Ende des Sprinttages. Gelockte Sprints bleiben unverändert.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-[140px_auto] sm:items-end">
        <UiField>Stunden<UiTextInput type="number" min={1} max={MAX_REVIEW_OBJECTION_WINDOW_HOURS} value={value} disabled={disabled || pending || Boolean(edit && ["saving", "unconfirmed", "blocked"].includes(edit.phase))} onFocus={() => { if (!editor) { setEditor(planningState.beginReviewWindowEdit(reviewObjectionWindowHours)); setDraft(String(reviewObjectionWindowHours)); } }} onChange={(event) => { setDraft(event.target.value); setMessage(""); }} /></UiField>
        <UiButton variant="primary" className="min-h-11" disabled={disabled || pending || blocked || !valid || parsed === reviewObjectionWindowHours} onClick={() => { void save(); }}>Frist speichern</UiButton>
      </div>
      {edit && ["conflict", "unconfirmed", "blocked"].includes(edit.phase) && <UiNotice tone="warning" className="lg:col-span-2" role="status">
        <p className="font-semibold">{edit.phase === "conflict" ? "Frist wurde zwischenzeitlich geändert" : "Frist noch nicht bestätigt"}</p>
        {edit.submittedHours !== null && <p>Eingabe: {edit.submittedHours} Stunden</p>}
        {edit.serverHours !== null && <p>Serverstand: {edit.serverHours} Stunden</p>}
        <div className="mt-2 flex flex-wrap gap-2">
          {edit.phase === "conflict" ? <>
            <UiButton className="min-h-11" onClick={() => { void editor?.refreshConflict(); }}>Serverstand vergleichen</UiButton>
            <UiButton className="min-h-11" disabled={disabled || !edit.canResave || !valid} onClick={() => { void save(true); }}>Bewusst erneut speichern</UiButton>
          </> : <UiButton className="min-h-11" onClick={async () => { const checked = await planningState.checkReviewWindowSave(); setMessage(checked.readStatus === "forbidden" ? "Kein Zugriff auf die Prozesseinstellung." : checked.outcome === "not-pending" ? "Der Entwurf wurde noch nicht gesendet. Du kannst ihn jetzt bewusst speichern." : "Die Speicherung bleibt unbestätigt und wurde nicht erneut gesendet."); }}>Serverstand prüfen</UiButton>}
        </div>
      </UiNotice>}
      {message && <UiNotice className="lg:col-span-2" tone={message === "Frist gespeichert." ? "success" : "danger"}>{message}</UiNotice>}
    </UiPanel>
  );
}
