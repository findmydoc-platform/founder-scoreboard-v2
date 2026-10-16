"use client";

import { useRef, useState } from "react";
import { usePrivateTeamWorkweek } from "../hooks/use-private-team-workweek";
import { berlinTodayIso, formatTeamWorkweekActivation, TEAM_WORKWEEK_DAYS } from "../model/team-workweek-draft";
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

export function PrivateTeamWorkweekCard({ apiClient, profile, editorRequested = false, editorWeek, onEditorRequestHandled }: { apiClient: BrowserApiClient; profile: Profile; editorRequested?: boolean; editorWeek?: string; onEditorRequestHandled?: () => void }) {
  const editorTriggerRef = useRef<HTMLButtonElement>(null);
  const [localOpen, setOpen] = useState(false);
  const open = localOpen || editorRequested;
  const closeEditor = () => {
    setOpen(false);
    onEditorRequestHandled?.();
  };
  const requestedWeek = editorRequested && editorWeek && selectedWorkweek(workweekStart(editorWeek)).ok ? workweekStart(editorWeek) : undefined;
  const state = usePrivateTeamWorkweek(apiClient, requestedWeek);
  const syncDelayed = state.publication?.syncState === "delayed";
  const reconciliationState = state.latestPublished?.googleReconciliationState;
  const showConfirmedTeamBaseline = Boolean(state.conflict || syncDelayed || reconciliationState === "conflict" || reconciliationState === "delayed");
  const latestIsPrepared = Boolean(state.latestPublished && (state.latestPublished.effectiveAt ? new Date(state.latestPublished.effectiveAt) > new Date() : state.latestPublished.effectiveFrom > berlinTodayIso()));
  const badge = syncDelayed
    ? { tone: "amber" as const, label: "Synchronisierung verzögert" }
    : reconciliationState === "conflict"
      ? { tone: "amber" as const, label: "Google-Konflikt" }
      : reconciliationState === "delayed"
        ? { tone: "amber" as const, label: "Synchronisierung verzögert" }
        : state.version
          ? { tone: "amber" as const, label: "Entwurf gespeichert" }
          : latestIsPrepared
            ? { tone: "blue" as const, label: `Geplant ab ${formatDate(state.latestPublished!.effectiveFrom)}` }
            : state.latestPublished
              ? { tone: "emerald" as const, label: "Veröffentlicht" }
              : { tone: "slate" as const, label: "Noch nicht eingerichtet" };

  return (
    <>
      <UiPanel aria-labelledby="private-team-workweek-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="private-team-workweek-title" className="text-base font-semibold text-slate-950">Meine Arbeitswoche</h2>
              <UiBadge tone={badge.tone}>{badge.label}</UiBadge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              {state.version ? "Entwurf gespeichert. Noch nicht im Team sichtbar." : state.latestPublished ? showConfirmedTeamBaseline ? "Letzter bestätigter Teamstand bleibt sichtbar." : latestIsPrepared ? "Die geplante Woche ist bereits im Kalender sichtbar." : "Deine Arbeitszeiten sind in Team und Google bestätigt." : "Deine Arbeitszeiten fehlen noch."}
            </p>
            {state.version && (
              <p className="mt-2 text-xs font-semibold text-slate-600">{state.version.activationMode === "immediate" ? "Beginn wird bei Veröffentlichung bestätigt" : `Gültig ab ${formatDate(state.version.effectiveFrom)}`} · {state.version.timezone}</p>
            )}
            {state.latestPublished && <details className="mt-2 text-xs leading-5 text-slate-500">
              <summary className="min-h-6 cursor-pointer">Details zur Veröffentlichung</summary>
              <p>Gültig ab {state.latestPublished.effectiveAt ? formatTeamWorkweekActivation(state.latestPublished.effectiveAt) : formatDate(state.latestPublished.effectiveFrom)}.</p>
              {state.latestPublished.lastSyncAt && <p>Letzter erfolgreicher Abgleich: {formatDate(state.latestPublished.lastSyncAt.slice(0, 10))}.</p>}
              <p>Geprüft werden nur von FounderOps angelegte Google-Serien.</p>
              {!latestIsPrepared && <UiButton className="mt-2" variant="secondary" size="sm" onClick={() => void state.reconcile()} disabled={state.pending}>App-Termine in Google prüfen</UiButton>}
            </details>}
            {reconciliationState === "conflict" && !state.version && (
              <p className="mt-2 text-xs font-semibold text-amber-700">Eine Google-Serienänderung ist nicht eindeutig. Der bestätigte Teamstand bleibt aktiv.</p>
            )}
            {reconciliationState === "delayed" && !state.version && (
              <p className="mt-2 text-xs font-semibold text-amber-700">Der Google-Abgleich ist verzögert. Der bestätigte Teamstand bleibt aktiv.</p>
            )}
          </div>
          <div ref={(node) => { editorTriggerRef.current = node?.querySelector<HTMLButtonElement>("[data-workweek-editor-trigger]") || null; }} className="flex flex-col gap-2 sm:items-end">
            <UiButton data-workweek-editor-trigger variant="primary" size="lg" onClick={() => { setOpen(true); if (latestIsPrepared && !state.version) void state.selectWeek(state.latestPublished!.effectiveFrom); }} disabled={state.pending && !state.version}>
              {state.version ? "Bearbeitung fortsetzen" : state.latestPublished ? "Arbeitswoche bearbeiten" : "Arbeitswoche einrichten"}
            </UiButton>
          </div>
        </div>
        {state.message && !open && <UiNotice className="mt-4" tone={state.messageTone === "success" ? "success" : "warning"}>{state.message}</UiNotice>}
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
                  disabled={state.pending || state.conflict.founderops.supported === false || (state.conflict.state === "resolving" && state.conflict.decision !== "founderops")}>
                  FounderOps übernehmen
                </UiButton>
              </div>
              <div className="rounded-lg border border-white/80 bg-white p-3">
                <div className="text-sm font-semibold text-slate-950">Google-Variante</div>
                {state.conflict.google.supported !== false && <div className="mt-1 text-xs text-slate-600">{state.conflict.google.activationMode === "immediate" ? "Beginn wird nach Bestätigung festgelegt" : `Gültig ab ${formatDate(state.conflict.google.effectiveFrom)}`}</div>}
                <p className="mt-2 text-sm leading-6 text-slate-700">{state.conflict.google.supported === false ? "Diese Google-Änderung lässt sich keiner eindeutigen Grundwoche zuordnen." : conflictWindows(state.conflict.google.windows)}</p>
                <UiButton className="mt-3 w-full sm:w-auto" variant="secondary" onClick={() => void state.resolveConflict("google")}
                  disabled={state.pending || state.conflict.google.supported === false || (state.conflict.state === "resolving" && state.conflict.decision !== "google")}>
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
