"use client";

import { useState } from "react";
import { addCalendarDays, berlinDateKey } from "../model/team-workweek-calendar";
import { workweekStart } from "../model/team-workweek-week";
import { useWorkweekCalendarLoading } from "./use-workweek-calendar-loading";
import type { BrowserApiClient } from "@/lib/browser-api-client";

export { TEAM_WORKWEEK_PUBLISHED_EVENT } from "./use-workweek-calendar-loading";

export function usePublishedTeamWorkweeks(apiClient: BrowserApiClient, initialDate?: string) {
  const [selectedDate, setSelectedDate] = useState(() => initialDate || berlinDateKey());
  const from = workweekStart(selectedDate);
  const { snapshot, hasLoadedRange, load, message, pending } = useWorkweekCalendarLoading({
    apiClient, from, to: addCalendarDays(from, 6), enabled: true, policy: "team-week",
  });
  const selectDate = (date: string) => {
    if (workweekStart(date) !== from) setSelectedDate(date);
  };
  return {
    hasLoadedSuccessfully: hasLoadedRange, load, message, pending,
    referenceDate: snapshot?.hasCalendarRange ? selectedDate : snapshot?.referenceDate || berlinDateKey(),
    workweeks: hasLoadedRange ? snapshot?.calendarWorkweeks || [] : [], selectedDate, selectDate,
    upcomingWorkweeks: snapshot?.upcomingWorkweeks || [], publishedOwnerIds: snapshot?.publishedOwnerIds,
  };
}
