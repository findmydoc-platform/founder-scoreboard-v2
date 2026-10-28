"use client";

import { useCallback, useState } from "react";
import { useWorkweekCalendarLoading } from "@/features/team-workweek/hooks/use-workweek-calendar-loading";
import {
  berlinDateKey,
  calendarGridRange,
  firstCalendarDayOfMonth,
} from "@/features/team-workweek/model/team-workweek-calendar";
import type { PlanningState } from "../model/planning-state";

export function useHeaderCalendar({
  planningState,
  onOpenTeam,
}: {
  planningState?: PlanningState;
  onOpenTeam: (editWorkweek?: boolean, week?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"events" | "workweek">("events");
  const [selectedDate, setSelectedDate] = useState(() => berlinDateKey());
  const [viewMonth, setViewMonth] = useState(() => firstCalendarDayOfMonth(berlinDateKey()));
  const range = calendarGridRange(viewMonth);
  const { snapshot, pending, message, load: loadVisibleRange, now, workweekCoverage } = useWorkweekCalendarLoading({
    planningState, ...range, enabled: open, policy: "header-month",
  });

  const openCalendar = useCallback(() => {
    setActiveTab("events");
    setOpen(true);
  }, []);
  const closeCalendar = useCallback(() => setOpen(false), []);
  const openTeamWorkspace = useCallback((editWorkweek = false) => {
    setOpen(false);
    onOpenTeam(editWorkweek, selectedDate);
  }, [onOpenTeam, selectedDate]);

  return {
    activeTab,
    calendarWorkweeks: [...snapshot?.calendarWorkweeks || []],
    workweeksByDay: snapshot?.calendarByDay,
    workweekCoverage,
    closeCalendar,
    message,
    now,
    open,
    openCalendar,
    openTeamWorkspace,
    pending,
    reload: loadVisibleRange,
    selectedDate,
    setActiveTab,
    setSelectedDate,
    setViewMonth,
    viewMonth,
    workweekReferenceDate: snapshot?.referenceDate || berlinDateKey(),
    workweeks: [...snapshot?.currentWorkweeks || []],
  };
}
