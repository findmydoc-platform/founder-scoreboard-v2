"use client";

import { useState } from "react";
import { addCalendarDays, berlinDateKey } from "../model/team-workweek-calendar";
import { workweekStart } from "../model/team-workweek-week";
import { useWorkweekCalendarLoading } from "./use-workweek-calendar-loading";
import type { PlanningState } from "@/features/planning/model/planning-state";

export function usePublishedTeamWorkweeks(planningState: PlanningState, initialDate?: string) {
  const [selectedDate, setSelectedDate] = useState(() => initialDate || berlinDateKey());
  const from = workweekStart(selectedDate);
  const { snapshot, hasLoadedRange, load, message, pending } = useWorkweekCalendarLoading({
    planningState, from, to: addCalendarDays(from, 6), enabled: true, policy: "team-week",
  });
  const selectDate = (date: string) => {
    if (workweekStart(date) !== from) setSelectedDate(date);
  };
  return {
    hasLoadedSuccessfully: hasLoadedRange, load, message, pending,
    referenceDate: snapshot?.hasCalendarRange ? selectedDate : snapshot?.referenceDate || berlinDateKey(),
    workweeks: hasLoadedRange ? [...snapshot?.calendarWorkweeks || []] : [],
    workweeksByDay: snapshot?.hasCalendarRange ? snapshot.calendarByDay : undefined, selectedDate, selectDate,
    upcomingWorkweeks: [...snapshot?.upcomingWorkweeks || []], publishedOwnerIds: snapshot?.publishedOwnerIds ? [...snapshot.publishedOwnerIds] : undefined,
  };
}
