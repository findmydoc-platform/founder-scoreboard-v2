"use client";
import { formatDate } from "@/lib/display";

import { useEffect, useState } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import type { SprintPlanEditor } from "../model/sprint-plan";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { UiButton, UiField, UiPanel, UiTextInput, UiNotice } from "@/shared/atoms/ui-primitives";
import type { SprintPlanningOptions } from "@/features/sprint/model/sprint-planning-options";

export function SprintPlanningSection({
  disabled = false,
  pending,
  sprintPlanningOptions,
  plannedSprintCount,
  onUpdateSprintPlanning,
  planningState,
}: {
  disabled?: boolean;
  pending: boolean;
  sprintPlanningOptions: SprintPlanningOptions;
  plannedSprintCount: number;
  onUpdateSprintPlanning: (options: SprintPlanningOptions) => void;
  planningState: PlanningState;
}) {
  const [editor, setEditor] = useState<SprintPlanEditor | null>(() => planningState.resumeSprintPlan());
  const [message, setMessage] = useState("");
  const edit = editor?.view();
  useEffect(() => () => editor?.close(), [editor]);
  const [draft, setDraft] = useState<SprintPlanningOptions | null>(() => editor?.view().submitted ? { ...editor.view().submitted! } : null);
  function update(next: SprintPlanningOptions) { setDraft(next); onUpdateSprintPlanning(next); }
  const retained = edit?.submitted;
  const shown = retained && ["unconfirmed", "blocked"].includes(edit!.phase) ? retained : draft || sprintPlanningOptions;
  const waiting = Boolean(edit && ["saving", "unconfirmed", "blocked"].includes(edit.phase));
  const conflict = edit?.phase === "conflict";
  const controlsDisabled = disabled || pending || waiting;
  function begin() { if (!editor || editor.view().phase === "saved") setEditor(planningState.beginSprintPlan()); }
  async function create(conscious = false) {
    const active = editor && editor.view().phase !== "saved" ? editor : planningState.beginSprintPlan();
    setEditor(active);
    const result = await (conscious ? active.recreate(shown) : active.create(shown));
    setMessage(result.ok ? `${result.changedCount} Sprint${result.changedCount === 1 ? "" : "s"} bestätigt. Bestehende geschützte Sprints bleiben erhalten.` : result.error);
  }

  return (
    <UiPanel onFocusCapture={begin}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-950">Sprint-Planung</h2>
          <p className="mt-1 text-sm text-slate-500">Legt Sprint-Zeiträume aus Startdatum und Rhythmus fest. Beispiel: 01.06.2026 plus 2 Wochen ergibt 01.06.-14.06., danach 15.06.-28.06.</p>
        </div>
        <UiButton
          disabled={controlsDisabled || conflict || plannedSprintCount === 0}
          onClick={() => { void create(); }}
        >
          {plannedSprintCount > 0 ? `${plannedSprintCount} Änderung${plannedSprintCount === 1 ? "" : "en"} anwenden` : "Plan aktuell"}
        </UiButton>
      </div>
      <div className="mt-4 grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <UiField as="div" className="min-w-0">
          Namenslogik
          <div className="flex h-9 w-full min-w-0 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">
            Sprint + Nummer
          </div>
        </UiField>
        <UiField className="min-w-0">
          Erste Sprint-Nr.
          <UiTextInput
            type="number"
            min={1}
            value={shown.firstSprintNumber}
            disabled={controlsDisabled}
            onChange={(event) => update({ ...shown, firstSprintNumber: Number(event.target.value) })}
            className="w-full min-w-0"
          />
        </UiField>
        <UiField className="min-w-0">
          Startdatum
          <CustomDatePicker
            value={shown.anchorStartDate}
            disabled={controlsDisabled}
            onChange={(value) => update({ ...shown, anchorStartDate: value })}
            className="h-9 w-full text-sm"
          />
        </UiField>
        <UiField className="min-w-0">
          Rhythmus (Wochen)
          <UiTextInput
            type="number"
            min={1}
            max={12}
            value={shown.rhythmWeeks}
            disabled={controlsDisabled}
            onChange={(event) => update({ ...shown, rhythmWeeks: Number(event.target.value) })}
            className="w-full min-w-0"
          />
        </UiField>
        <UiField className="min-w-0">
          Wochen voraus
          <UiTextInput
            type="number"
            min={1}
            max={52}
            value={shown.horizonWeeks}
            disabled={controlsDisabled}
            onChange={(event) => update({ ...shown, horizonWeeks: Number(event.target.value) })}
            className="w-full min-w-0"
          />
        </UiField>
        <UiField className="min-w-0">
          Bis Sprint-Nr.
          <UiTextInput
            type="number"
            min={0}
            value={shown.targetSprintNumber || ""}
            disabled={controlsDisabled}
            onChange={(event) => update({ ...shown, targetSprintNumber: Number(event.target.value) })}
            className="w-full min-w-0"
            placeholder="optional"
          />
        </UiField>
      </div>
      {edit && ["saving", "unconfirmed", "blocked", "conflict"].includes(edit.phase) && <UiNotice tone="warning" className="mt-4" role="status">
        <p className="font-semibold">{conflict ? "Sprint-Plan geändert oder Zeitraum geschützt" : edit.phase === "saving" ? "Sprint-Plan wird gespeichert" : "Speicherung des Sprint-Plans unklar"}</p>
        <p>Sprint- und Weekly-Termine sind vorläufig.{edit.phase === "unconfirmed" ? " Ob sie gespeichert wurden, ist noch unklar." : ""}</p>
        {edit.submitted && <p>Eingabe: ab {formatDate(edit.submitted.anchorStartDate, { includeYear: true })}, Rhythmus {edit.submitted.rhythmWeeks} Wochen, bis Sprint {edit.submitted.targetSprintNumber || "Planungsende"}</p>}
        {edit.serverSprints && <div className="mt-2"><p className="font-semibold">Aktueller Stand (kann unvollständig sein)</p>{edit.serverSprints.map(sprint => <p key={sprint.id}>{sprint.name}: {formatDate(sprint.startDate, { includeYear: true })} bis {formatDate(sprint.endDate, { includeYear: true })}{sprint.scoreLocked ? " · geschützt" : ""}</p>)}</div>}
        <div className="mt-2 flex flex-wrap gap-2">{conflict ? <>
          <UiButton className="min-h-11" onClick={() => { void editor?.refreshConflict(); }}>Änderungen vergleichen</UiButton>
          <UiButton className="min-h-11" disabled={disabled || pending || !edit.canRecreate} onClick={() => { void create(true); }}>Erneut planen</UiButton>
        </> : edit.phase !== "saving" && <UiButton className="min-h-11" onClick={async () => { const checked = await planningState.checkSprintPlan(); setMessage(checked.readStatus === "forbidden" ? "Kein Zugriff auf diesen Sprint-Bereich." : checked.outcome === "not-pending" ? "Der Entwurf wurde noch nicht gesendet. Du kannst jetzt planen." : "Ob der Sprint-Plan gespeichert wurde, bleibt unklar. Es wurde nichts erneut gesendet."); }}>Aktuellen Stand prüfen</UiButton>}</div>
      </UiNotice>}
      {message && <UiNotice className="mt-4" tone={edit?.phase === "saved" ? "success" : "danger"}>{message}</UiNotice>}
    </UiPanel>
  );
}
