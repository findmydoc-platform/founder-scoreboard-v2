"use client";

import { usePublishedTeamWorkweeks } from "../hooks/use-published-team-workweeks";
import { resolvePublishedTeamWorkweekViewState } from "../model/team-workweek-view-state";
import { TeamWorkweekMatrix } from "./team-workweek-matrix";
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
  const viewState = resolvePublishedTeamWorkweekViewState({
    hasLoadedSuccessfully: state.hasLoadedSuccessfully,
    message: state.message,
    pending: state.pending,
    workweekCount: state.workweeks.length,
  });

  return (
    <UiPanel aria-labelledby="published-team-workweeks-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="published-team-workweeks-title" className="text-base font-semibold text-slate-950">Grundwochen im Team</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">Aktive veröffentlichte Arbeitszeiten in horizontalen Teamzeilen. Änderungen erfolgen nur über den eigenen Arbeitswochen-Editor.</p>
        </div>
        <UiBadge tone="slate">Nur Lesen</UiBadge>
      </div>

      {state.message && <UiNotice className="mt-4" tone="warning">{state.message}</UiNotice>}
      {viewState === "loading" && (
        <p className="mt-4 text-sm text-slate-500" role="status">Grundwochen werden geladen.</p>
      )}
      {viewState === "empty" && (
        <p className="mt-4 rounded-lg border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">Noch keine Grundwoche veröffentlicht.</p>
      )}
      {state.hasLoadedSuccessfully && (
        <div className="mt-4">
          <TeamWorkweekMatrix profiles={profiles} workweeks={state.workweeks} />
        </div>
      )}
    </UiPanel>
  );
}
