import { privateWorkweekApi } from "@/features/team-workweek/model/private-workweek-api";
import { useEffect, useState } from "react";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { readPublishedWorkweekCalendar } from "@/features/team-workweek/model/published-workweek-calendar-api";
import { TEAM_WORKWEEK_PUBLISHED_EVENT } from "@/features/team-workweek/model/published-workweek-events";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";

export function useCalendarPlanningState(apiClient: BrowserApiClient, profiles: Profile[] = []) {
  const [owner] = useState(() => createPlanningState({ userId: "calendar-preview", initialData: { ...emptyPlanningShellState, profiles }, initialWorkspace: "team", adapter: {
    ...privateWorkweekApi(apiClient),
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readWorkweekCalendar: scope => readPublishedWorkweekCalendar(apiClient, scope),
  } }));
  useEffect(() => {
    const refresh = () => owner.internal.invalidatePublishedWorkweeks();
    window.addEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, refresh);
    return () => window.removeEventListener(TEAM_WORKWEEK_PUBLISHED_EVENT, refresh);
  }, [owner]);
  return owner.planning;
}
