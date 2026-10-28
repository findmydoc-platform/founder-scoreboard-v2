import type { CalendarTeamWorkweek } from "./team-workweek-calendar";
import type { PlanningReadStatus } from "@/features/planning/model/planning-state";

export type WorkweekCalendarScope = Readonly<{ policy: "team-week" | "header-month"; from: string; to: string }>;
export type WorkweekCalendarResponse = {
  currentWorkweeks: CalendarTeamWorkweek[];
  calendarWorkweeks?: CalendarTeamWorkweek[];
  calendarCoverage?: "complete" | "partial";
  upcomingWorkweeks?: CalendarTeamWorkweek[];
  publishedOwnerIds?: string[];
  workweeks?: Array<{ effectiveAt?: string | null }>;
  referenceDate: string;
};
export type WorkweeksByDay = Readonly<Record<string, readonly CalendarTeamWorkweek[]>>;
export type WorkweekCalendarView = Readonly<{
  scope: WorkweekCalendarScope;
  readStatus: PlanningReadStatus;
  coverage: "none" | "partial" | "complete";
  freshness: "current" | "stale";
  cacheFresh: boolean;
  invalidation: number;
  acceptedRead: number;
  error: string;
  snapshot: Readonly<{
    currentWorkweeks: readonly CalendarTeamWorkweek[];
    calendarWorkweeks: readonly CalendarTeamWorkweek[];
    calendarByDay: WorkweeksByDay;
    upcomingWorkweeks: readonly CalendarTeamWorkweek[];
    publishedOwnerIds?: readonly string[];
    referenceDate: string;
    hasCalendarRange: boolean;
    nextActivationAt: string | null;
  }> | null;
}>;
export type PublishedWorkweekCalendars = {
  workweekCalendar(scope: WorkweekCalendarScope): WorkweekCalendarView;
  loadWorkweekCalendar(scope: WorkweekCalendarScope): Promise<boolean>;
};
