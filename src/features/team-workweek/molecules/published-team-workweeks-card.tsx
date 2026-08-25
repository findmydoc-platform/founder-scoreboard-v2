"use client";

import { usePublishedTeamWorkweeks } from "../hooks/use-published-team-workweeks";
import { TEAM_WORKWEEK_DAYS } from "../model/team-workweek-draft";
import { formatDate } from "@/lib/display";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";
import { UiBadge, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

export function PublishedTeamWorkweeksCard({
  apiClient,
  profiles,
}: {
  apiClient: BrowserApiClient;
  profiles: Profile[];
}) {
  const state = usePublishedTeamWorkweeks(apiClient);
  const profileNames = new Map(profiles.map((profile) => [profile.id, profile.name]));

  return (
    <UiPanel aria-labelledby="published-team-workweeks-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="published-team-workweeks-title" className="text-base font-semibold text-slate-950">Grundwochen im Team</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">Veröffentlichte Arbeitszeiten aller Teammitglieder. Änderungen erfolgen nur über eine neue eigene Version.</p>
        </div>
        <UiBadge tone="slate">Nur Lesen</UiBadge>
      </div>

      {state.message && <UiNotice className="mt-4" tone="warning">{state.message}</UiNotice>}
      {!state.pending && !state.message && state.workweeks.length === 0 && (
        <p className="mt-4 rounded-lg border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">Noch keine Grundwoche veröffentlicht.</p>
      )}
      {state.workweeks.length > 0 && (
        <div className="mt-4 grid gap-3">
          {state.workweeks.map((workweek) => (
            <article key={workweek.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-950">{profileNames.get(workweek.ownerProfileId) || "Teammitglied"}</h3>
                  <p className="mt-1 text-xs font-semibold text-slate-500">
                    {workweek.phase === "prepared" ? "Vorbereitet für" : "Gültig ab"} {formatDate(workweek.effectiveFrom)} · {workweek.timezone}
                  </p>
                </div>
                <UiBadge tone={workweek.phase === "prepared" ? "blue" : "emerald"}>
                  {workweek.phase === "prepared" ? "Für Montag vorbereitet" : "Aktuell veröffentlicht"}
                </UiBadge>
              </div>
              <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {TEAM_WORKWEEK_DAYS.map((day) => (
                  <div key={day.key} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                    <dt className="text-xs font-semibold text-slate-500">{day.label}</dt>
                    <dd className="mt-1 text-sm font-semibold text-slate-900">
                      {workweek.windows[day.key].length
                        ? workweek.windows[day.key].map((window) => `${window.start}–${window.end}`).join(", ")
                        : "Frei"}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      )}
    </UiPanel>
  );
}
