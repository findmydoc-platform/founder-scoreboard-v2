"use client";

import { useRef, useState } from "react";
import { usePrivateTeamWorkweek } from "../hooks/use-private-team-workweek";
import { formatTeamWorkweekActivation, TEAM_WORKWEEK_DAYS } from "../model/team-workweek-draft";
import { PrivateTeamWorkweekEditor } from "../organisms/private-team-workweek-editor";
import { formatDate } from "@/lib/display";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";
import { selectedWorkweek, workweekStart } from "../model/team-workweek-week";
import { UiBadge, UiButton, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

function conflictWindows(windows: Array<Readonly<{ weekday: number; startMinute: number; endMinute: number }>>) {
  if (!windows.length) return "Keine Arbeitszeitfenster";
  return TEAM_WORKWEEK_DAYS.flatMap((day) => {
    const entries = windows.filter((window) => window.weekday === day.weekday);
    if (!entries.length) return [];
    const time = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    return [`${day.label}: ${entries.map((entry) => `${time(entry.startMinute)}–${time(entry.endMinute)}`).join(", ")}`];
  }).join(" · ");
}

export function PrivateTeamWorkweekCard({ apiClient, planningState, profile, editorRequested = false, editorWeek, onEditorRequestHandled }: { apiClient: BrowserApiClient; planningState: import("@/features/planning/model/planning-state").PlanningState; profile: Profile; editorRequested?: boolean; editorWeek?: string; onEditorRequestHandled?: () => void }) {
  const editorTriggerRef = useRef<HTMLButtonElement>(null);
  const [localOpen, setOpen] = useState(false);
  const open = localOpen || editorRequested;
  const closeEditor = () => {
    setOpen(false);
    onEditorRequestHandled?.();
  };
  const requestedWeek = editorRequested && editorWeek && selectedWorkweek(workweekStart(editorWeek)).ok ? workweekStart(editorWeek) : undefined;
  const state = usePrivateTeamWorkweek(apiClient, planningState, requestedWeek);
  const { card } = state;

  return (
    <>
      <UiPanel aria-labelledby="private-team-workweek-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="private-team-workweek-title" className="text-base font-semibold text-slate-950">Meine Arbeitswoche</h2>
              <UiBadge tone={card.badge.tone}>{card.badge.label}</UiBadge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              {card.description}
            </p>
            {state.version && (
              <p className="mt-2 text-xs font-semibold text-slate-600">{state.version.activationMode === "immediate" ? "Beginn wird bei Veröffentlichung bestätigt" : `Gültig ab ${formatDate(state.version.effectiveFrom)}`} · {state.version.timezone}</p>
            )}
            {state.latestPublished && <details className="mt-2 text-xs leading-5 text-slate-500">
              <summary className="min-h-6 cursor-pointer">Details zur Veröffentlichung</summary>
              <p>Gültig ab {state.latestPublished.effectiveAt ? formatTeamWorkweekActivation(state.latestPublished.effectiveAt) : formatDate(state.latestPublished.effectiveFrom)}.</p>
              {state.latestPublished.lastSyncAt && <p>Letzter erfolgreicher Abgleich: {formatDate(state.latestPublished.lastSyncAt.slice(0, 10))}.</p>}
              <p>Geprüft werden nur von FounderOps angelegte Google-Serien.</p>
              {card.showReconcile && <UiButton className="mt-2" variant="secondary" size="sm" onClick={() => void state.reconcile()} disabled={!card.canReconcile}>App-Termine in Google prüfen</UiButton>}
            </details>}
            {card.reconciliationWarning && <p className="mt-2 text-xs font-semibold text-amber-700">{card.reconciliationWarning}</p>}
          </div>
          <div ref={(node) => { editorTriggerRef.current = node?.querySelector<HTMLButtonElement>("[data-workweek-editor-trigger]") || null; }} className="flex flex-col gap-2 sm:items-end">
            <UiButton data-workweek-editor-trigger variant="primary" size="lg" onClick={() => { setOpen(true); if (card.triggerWeek) void state.selectWeek(card.triggerWeek); }} disabled={card.triggerDisabled}>
              {card.triggerLabel}
            </UiButton>
          </div>
        </div>
        {state.message && !open && <UiNotice className="mt-4" tone={state.messageTone === "success" ? "success" : "warning"}>{state.message}</UiNotice>}
        {card.showConflictCheck && !open && <UiButton className="mt-3 min-h-11" variant="secondary" onClick={() => void state.refreshConflict()} disabled={state.pending}>Konfliktstand prüfen</UiButton>}
        {state.conflict && !open && (
          <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4" aria-labelledby="team-workweek-conflict-title">
            <h3 id="team-workweek-conflict-title" className="text-sm font-semibold text-amber-950">FounderOps und Google wurden parallel geändert</h3>
            <p className="mt-1 text-sm leading-6 text-amber-900">Der letzte bestätigte Teamstand bleibt aktiv. Prüfe beide Varianten und entscheide bewusst.</p>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-lg border border-white/80 bg-white p-3">
                <div className="text-sm font-semibold text-slate-950">Meine FounderOps-Variante</div>
                {state.conflict.founderops.supported !== false && <div className="mt-1 text-xs text-slate-600">{state.conflict.founderops.activationMode === "immediate" ? "Beginn wird nach Bestätigung festgelegt" : `Gültig ab ${formatDate(state.conflict.founderops.effectiveFrom)}`}</div>}
                <p className="mt-2 text-sm leading-6 text-slate-700">{state.conflict.founderops.supported === false ? "Diese FounderOps-Variante kann derzeit nicht übernommen werden." : conflictWindows(state.conflict.founderops.windows)}</p>
                <UiButton className="mt-3 w-full sm:w-auto" variant="primary" onClick={() => void state.resolveConflict("founderops")}
                  disabled={!card.canResolveConflict.founderops}>
                  FounderOps übernehmen
                </UiButton>
              </div>
              <div className="rounded-lg border border-white/80 bg-white p-3">
                <div className="text-sm font-semibold text-slate-950">Google-Variante</div>
                {state.conflict.google.supported !== false && <div className="mt-1 text-xs text-slate-600">{state.conflict.google.activationMode === "immediate" ? "Beginn wird nach Bestätigung festgelegt" : `Gültig ab ${formatDate(state.conflict.google.effectiveFrom)}`}</div>}
                <p className="mt-2 text-sm leading-6 text-slate-700">{state.conflict.google.supported === false ? "Diese Google-Änderung lässt sich keiner eindeutigen Grundwoche zuordnen." : conflictWindows(state.conflict.google.windows)}</p>
                <UiButton className="mt-3 w-full sm:w-auto" variant="secondary" onClick={() => void state.resolveConflict("google")}
                  disabled={!card.canResolveConflict.google}>
                  Google übernehmen
                </UiButton>
              </div>
            </div>
          </section>
        )}
      </UiPanel>
      {open && <PrivateTeamWorkweekEditor apiClient={apiClient} profile={profile} state={state} onClose={closeEditor} restoreFocusRef={editorTriggerRef} />}
    </>
  );
}
