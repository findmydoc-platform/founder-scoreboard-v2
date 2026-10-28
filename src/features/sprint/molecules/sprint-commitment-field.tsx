"use client";

import { useEffect, useState } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import type { CommitmentLevel, SprintCommitment } from "@/lib/types";
import type { SprintCommitmentEditor } from "../model/sprint-commitment-editing";
import { UiButton } from "@/shared/atoms/ui-primitives";
import { CustomSelect } from "@/shared/atoms/custom-select";

export function SprintCommitmentField({ planningState, shown, field, disabled = false, compact = false }: {
  planningState: PlanningState; shown: SprintCommitment; field: "level" | "hours"; disabled?: boolean; compact?: boolean;
}) {
  const [hoursDraft, setHoursDraft] = useState<string | null>(null);
  const [editor, setEditor] = useState<SprintCommitmentEditor | null>(() => planningState.resumeSprintCommitmentEdit(shown.sprintId, shown.profileId));
  useEffect(() => () => editor?.close(), [editor]);
  const begin = () => {
    const next = editor || planningState.beginSprintCommitmentEdit(shown);
    if (!editor) setEditor(next);
    return next;
  };
  const edits = planningState.sprintCommitmentEdits(shown.sprintId, shown.profileId);
  const shared = edits.findLast(item => ["saving", "unconfirmed", "conflict"].includes(item.phase))
    || edits.findLast(item => item.phase === "blocked")
    || edits.findLast(item => item.phase === "saved" && Boolean(item.error));
  const view = shared || editor?.view();
  const retained = view?.phase === "saved" || view?.phase === "editing" ? null : view?.submitted;
  const blocked = Boolean(view && ["unconfirmed", "blocked", "conflict", "ended"].includes(view.phase));
  const unavailable = disabled || blocked;
  const retainedEditor = () => editor || planningState.resumeSprintCommitmentEdit(shown.sprintId, shown.profileId);
  const input = field === "level" ? <CustomSelect
    aria-label="Commitment"
    value={retained?.commitmentLevel || shown.commitmentLevel}
    disabled={unavailable}
    onOpen={() => { begin(); }}
    onChange={value => { void begin().save({ commitmentLevel: value as CommitmentLevel }); }}
    className={compact ? "h-8 w-28 text-xs" : "h-11 w-full text-sm"}
    options={["Lite", "Standard", "Heavy", "Away"].map(value => ({ value, label: value }))}
  /> : <input
    aria-label="Wochenstunden"
    type="number" min={0} max={80}
    value={hoursDraft ?? retained?.weeklyHours ?? shown.weeklyHours}
    disabled={unavailable}
    onFocus={() => { begin(); setHoursDraft(String(shown.weeklyHours)); }}
    onChange={event => setHoursDraft(event.target.value)}
    onBlur={() => {
      if (hoursDraft !== null && hoursDraft.trim() !== "" && Number.isFinite(Number(hoursDraft)) && Number(hoursDraft) >= 0 && Number(hoursDraft) <= 80) {
        if (Number(hoursDraft) !== shown.weeklyHours) void begin().save({ weeklyHours: Number(hoursDraft) });
        setHoursDraft(null);
      }
    }}
    className={compact ? "h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700" : "h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700"}
  />;
  return <div className="grid min-w-0 gap-2">
    {input}
    {field === "hours" && view && <div className="grid min-w-0 gap-2 text-xs text-slate-700" role="status">
      {view.phase === "saving" && <p>Commitment wird gespeichert</p>}
      {view.phase === "saved" && view.error && <p>{view.error}</p>}
      {view.phase === "unconfirmed" && <>
        <p>Commitment noch nicht bestätigt</p><p>{view.error}</p>
        {view.checkStatus === "checking" && <p>Serverstand wird geprüft</p>}
        {view.checkStatus === "checked" && <p>Stand geprüft. Die vollständige Speicherung bleibt unbestätigt.</p>}
        {view.checkStatus === "unavailable" && <p>Serverstand derzeit nicht verfügbar.</p>}
        {view.checkStatus === "forbidden" && <p>Keine Berechtigung für den Serverstand.</p>}
        {view.serverCommitment && <p>Server: {view.serverCommitment.commitmentLevel}, {view.serverCommitment.weeklyHours} Stunden</p>}
        <UiButton className="min-h-11 whitespace-normal" disabled={view.checkStatus === "checking"} onClick={() => { void retainedEditor()?.checkOutcome(); }}>Serverstand prüfen</UiButton>
      </>}
      {view.phase === "conflict" && <>
        <p>Commitment wurde zwischenzeitlich geändert</p>
        <p>Eingabe: {view.submitted?.commitmentLevel || shown.commitmentLevel}, {view.submitted?.weeklyHours ?? shown.weeklyHours} Stunden</p>
        {view.serverCommitment && <p>Server: {view.serverCommitment.commitmentLevel}, {view.serverCommitment.weeklyHours} Stunden</p>}
        <UiButton className="min-h-11 whitespace-normal" onClick={() => { void retainedEditor()?.refreshConflict(); }}>Serverstand vergleichen</UiButton>
        <UiButton className="min-h-11 whitespace-normal" disabled={!view.canResave} onClick={() => { void retainedEditor()?.resave(view.submitted || {}); }}>Bewusst erneut speichern</UiButton>
      </>}
      {(view.phase === "rejected" || view.phase === "blocked") && <p>{view.error}</p>}
      {view.phase === "blocked" && <UiButton className="min-h-11 whitespace-normal" onClick={() => { void retainedEditor()?.checkOutcome(); }}>Vorherigen Vorgang prüfen</UiButton>}
    </div>}
  </div>;
}
