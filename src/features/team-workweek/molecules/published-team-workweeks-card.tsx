"use client";

import { usePublishedTeamWorkweeks } from "../hooks/use-published-team-workweeks";
import { resolvePublishedTeamWorkweekViewState } from "../model/team-workweek-view-state";
import { workweekStart } from "../model/team-workweek-week";
import { WorkweekNavigation } from "./workweek-navigation";
import { TeamWorkweekMatrix } from "./team-workweek-matrix";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";
import { UiBadge, UiButton, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

export function PublishedTeamWorkweeksCard({
  apiClient,
  profiles,
  initialDate,
}: {
  apiClient: BrowserApiClient;
  profiles: Profile[];
  initialDate?: string;
}) {
  const state = usePublishedTeamWorkweeks(apiClient, initialDate);
  const viewState = resolvePublishedTeamWorkweekViewState({
    hasLoadedSuccessfully: state.hasLoadedSuccessfully,
    message: state.message,
    pending: state.pending,
    workweekCount: state.workweeks.length,
  });

  const nextPrepared = state.upcomingWorkweeks.find(entry => workweekStart(entry.effectiveFrom) > workweekStart(state.selectedDate));

  return (
    <UiPanel aria-labelledby="published-team-workweeks-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="published-team-workweeks-title" className="text-base font-semibold text-slate-950">Arbeitswochen im Team</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">Geplante Arbeitszeiten, keine Live-Präsenz.</p>
        </div>
        <UiBadge tone="slate">Nur Lesen</UiBadge>
      </div>

      <WorkweekNavigation value={state.selectedDate} onChange={state.selectDate} />
      {state.message && (
        <UiNotice className="mt-4" tone="warning">
          <p>{viewState === "stale-matrix" ? "Aktualisierung verzögert. Zuletzt bestätigte Zeiten." : state.message}</p>
          <UiButton className="mt-2" size="sm" onClick={() => void state.load()} disabled={state.pending}>Erneut laden</UiButton>
        </UiNotice>
      )}
      {viewState === "loading" && (
        <p className="mt-4 text-sm text-slate-500" role="status">Arbeitswochen werden geladen.</p>
      )}
      {viewState === "empty" && (
        <p className="mt-4 rounded-lg border border-dashed border-slate-200 px-4 py-5 text-sm text-slate-500">Für diese Woche sind noch keine Arbeitszeiten veröffentlicht.</p>
      )}
      {nextPrepared && <UiButton className="mt-2 min-h-11" size="sm" onClick={() => state.selectDate(nextPrepared.effectiveFrom)}>Geplante Woche ansehen</UiButton>}
      {state.hasLoadedSuccessfully && (
        <div className="mt-4">
          <TeamWorkweekMatrix key={state.selectedDate} dateKey={state.referenceDate} profiles={profiles} workweeks={state.workweeks} upcomingWorkweeks={state.upcomingWorkweeks} publishedOwnerIds={state.publishedOwnerIds} />
        </div>
      )}
    </UiPanel>
  );
}
