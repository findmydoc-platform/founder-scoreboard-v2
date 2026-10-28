import { googleWorkspaceApi } from "@/features/team-workweek/model/google-workspace-api";
import { privateWorkweekApi } from "@/features/team-workweek/model/private-workweek-api";
import { useState } from "react";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { readPublishedWorkweekCalendar } from "@/features/team-workweek/model/published-workweek-calendar-api";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";

export function useCalendarPlanningState(apiClient: BrowserApiClient, profiles: Profile[] = [], publicationReady?: (invalidate: () => void) => void) {
  const [owner] = useState(() => createPlanningState({ userId: "calendar-preview", initialData: { ...emptyPlanningShellState, profiles }, initialWorkspace: "team", adapter: {
    ...privateWorkweekApi(apiClient), ...googleWorkspaceApi(apiClient),
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readWorkweekCalendar: scope => readPublishedWorkweekCalendar(apiClient, scope),
  } }));
  publicationReady?.(owner.internal.invalidatePublishedWorkweeks);
  return owner.planning;
}
