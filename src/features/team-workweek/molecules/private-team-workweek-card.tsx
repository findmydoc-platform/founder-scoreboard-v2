"use client";

import { useState } from "react";
import { usePrivateTeamWorkweek } from "../hooks/use-private-team-workweek";
import { berlinTodayIso, TEAM_WORKWEEK_DAYS } from "../model/team-workweek-draft";
import { PrivateTeamWorkweekEditor } from "../organisms/private-team-workweek-editor";
import { formatDate } from "@/lib/display";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";
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

export function PrivateTeamWorkweekCard({ apiClient, profile }: { apiClient: BrowserApiClient; profile: Profile }) {
  const [open, setOpen] = useState(false);
  const state = usePrivateTeamWorkweek(apiClient);
  const syncDelayed = state.publication?.syncState === "delayed";
  const reconciliationState = state.latestPublished?.googleReconciliationState;
  const latestIsPrepared = Boolean(state.latestPublished && state.latestPublished.effectiveFrom > berlinTodayIso());
  const badge = syncDelayed
    ? { tone: "amber" as const, label: "Synchronisierung verzögert" }
    : reconciliationState === "conflict"
      ? { tone: "amber" as const, label: "Google-Konflikt" }
      : reconciliationState === "delayed"
        ? { tone: "amber" as const, label: "Synchronisierung verzögert" }
        : state.version
          ? { tone: "amber" as const, label: "In Vorbereitung" }
          : latestIsPrepared
            ? { tone: "blue" as const, label: "Für Montag vorbereitet" }
            : state.latestPublished
              ? { tone: "emerald" as const, label: "Veröffentlicht" }
              : { tone: "slate" as const, label: "Noch nicht vorbereitet" };

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
              Private Grundwoche für {profile.name}. Erst eine bestätigte Google-Synchronisierung macht sie im Team sichtbar.
            </p>
            {state.version && (
              <p className="mt-2 text-xs font-semibold text-slate-600">Gültig ab {formatDate(state.version.effectiveFrom)} · {state.version.timezone}</p>
            )}
            {state.latestPublished && (
              <p className="mt-2 text-xs font-semibold text-slate-600">
                {latestIsPrepared ? "Vorbereitet" : "Zuletzt veröffentlicht"}: gültig ab {formatDate(state.latestPublished.effectiveFrom)}
                {state.latestPublished.lastSyncAt ? ` · letzter erfolgreicher Sync ${formatDate(state.latestPublished.lastSyncAt.slice(0, 10))}` : ""}
              </p>
            )}
            {reconciliationState === "conflict" && !state.version && (
              <p className="mt-2 text-xs font-semibold text-amber-700">Eine Google-Serienänderung ist nicht eindeutig. Der bestätigte Teamstand bleibt aktiv.</p>
            )}
            {reconciliationState === "delayed" && !state.version && (
              <p className="mt-2 text-xs font-semibold text-amber-700">Der Google-Abgleich ist verzögert. Der bestätigte Teamstand bleibt aktiv.</p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            {state.latestPublished && !state.version && (
              <UiButton variant="secondary" size="lg" onClick={() => void state.reconcile()} disabled={state.pending}>
                Google abgleichen
              </UiButton>
            )}
            <UiButton variant="primary" size="lg" onClick={() => setOpen(true)} disabled={state.pending && !state.version}>
              {state.version ? "Grundwoche weiterführen" : state.latestPublished ? "Neue Version vorbereiten" : "Grundwoche vorbereiten"}
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
                <div className="mt-1 text-xs text-slate-600">Gültig ab {formatDate(state.conflict.founderops.effectiveFrom)}</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{conflictWindows(state.conflict.founderops.windows)}</p>
                <UiButton className="mt-3 w-full sm:w-auto" variant="primary" onClick={() => void state.resolveConflict("founderops")}
                  disabled={state.pending || (state.conflict.state === "resolving" && state.conflict.decision !== "founderops")}>
                  FounderOps übernehmen
                </UiButton>
              </div>
              <div className="rounded-lg border border-white/80 bg-white p-3">
                <div className="text-sm font-semibold text-slate-950">Google-Variante</div>
                <div className="mt-1 text-xs text-slate-600">Gültig ab {formatDate(state.conflict.google.effectiveFrom)}</div>
                <p className="mt-2 text-sm leading-6 text-slate-700">{conflictWindows(state.conflict.google.windows)}</p>
                <UiButton className="mt-3 w-full sm:w-auto" variant="secondary" onClick={() => void state.resolveConflict("google")}
                  disabled={state.pending || (state.conflict.state === "resolving" && state.conflict.decision !== "google")}>
                  Google übernehmen
                </UiButton>
              </div>
            </div>
          </section>
        )}
      </UiPanel>
      {open && <PrivateTeamWorkweekEditor apiClient={apiClient} profile={profile} state={state} onClose={() => setOpen(false)} />}
    </>
  );
}
