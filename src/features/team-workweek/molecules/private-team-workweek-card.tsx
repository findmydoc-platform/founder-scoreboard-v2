"use client";

import { useState } from "react";
import { usePrivateTeamWorkweek } from "../hooks/use-private-team-workweek";
import { berlinTodayIso } from "../model/team-workweek-draft";
import { PrivateTeamWorkweekEditor } from "../organisms/private-team-workweek-editor";
import { formatDate } from "@/lib/display";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";
import { UiBadge, UiButton, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

export function PrivateTeamWorkweekCard({ apiClient, profile }: { apiClient: BrowserApiClient; profile: Profile }) {
  const [open, setOpen] = useState(false);
  const state = usePrivateTeamWorkweek(apiClient);
  const syncDelayed = state.publication?.syncState === "delayed";
  const latestIsPrepared = Boolean(state.latestPublished && state.latestPublished.effectiveFrom > berlinTodayIso());
  const badge = syncDelayed
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
          </div>
          <UiButton variant="primary" size="lg" onClick={() => setOpen(true)} disabled={state.pending && !state.version}>
            {state.version ? "Grundwoche weiterführen" : state.latestPublished ? "Neue Version vorbereiten" : "Grundwoche vorbereiten"}
          </UiButton>
        </div>
        {state.message && !open && <UiNotice className="mt-4" tone={state.messageTone === "success" ? "success" : "warning"}>{state.message}</UiNotice>}
      </UiPanel>
      {open && <PrivateTeamWorkweekEditor apiClient={apiClient} profile={profile} state={state} onClose={() => setOpen(false)} />}
    </>
  );
}
