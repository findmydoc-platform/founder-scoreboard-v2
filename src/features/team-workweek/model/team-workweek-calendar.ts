import {
  TEAM_WORKWEEK_DAYS,
  TEAM_WORKWEEK_TIMEZONE,
  type TeamWorkweekDayKey,
  type TeamWorkweekWindows,
} from "./team-workweek-draft";
import type { HeaderCalendarEvent, Profile } from "@/lib/types";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type CalendarTeamWorkweek = Readonly<{
  id: string;
  ownerProfileId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  timezone: typeof TEAM_WORKWEEK_TIMEZONE;
  publicationRevision: number;
  lastSyncAt: string;
  windows: TeamWorkweekWindows;
}>;

export type CalendarWorktime = Readonly<{
  profile: Profile;
  windows: TeamWorkweekWindows[TeamWorkweekDayKey];
  workingNow: boolean;
}>;

function utcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function isIsoCalendarDate(value: string) {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = utcDate(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addCalendarDays(value: string, amount: number) {
  const parsed = utcDate(value);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

export function addCalendarMonths(value: string, amount: number) {
  const parsed = utcDate(value);
  parsed.setUTCDate(1);
  parsed.setUTCMonth(parsed.getUTCMonth() + amount);
  return parsed.toISOString().slice(0, 7) + "-01";
}

export function firstCalendarDayOfMonth(value: string) {
  return `${value.slice(0, 7)}-01`;
}

export function calendarGridForMonth(monthKey: string) {
  const first = utcDate(firstCalendarDayOfMonth(monthKey));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const start = addCalendarDays(first.toISOString().slice(0, 10), -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addCalendarDays(start, index));
}

export function calendarGridRange(monthKey: string) {
  const days = calendarGridForMonth(monthKey);
  return { from: days[0], to: days.at(-1)! };
}

export function inclusiveCalendarDayCount(from: string, to: string) {
  return Math.floor((utcDate(to).getTime() - utcDate(from).getTime()) / 86_400_000) + 1;
}

export function validateCalendarWorkweekRange(from: string | null, to: string | null) {
  if (!from && !to) return { ok: true as const, range: null };
  if (!from || !to) {
    return { ok: false as const, error: "Von und bis müssen gemeinsam angegeben werden." };
  }
  if (!isIsoCalendarDate(from) || !isIsoCalendarDate(to)) {
    return { ok: false as const, error: "Von und bis müssen gültige Datumswerte im Format YYYY-MM-DD sein." };
  }
  if (from > to) return { ok: false as const, error: "Von darf nicht nach bis liegen." };
  if (inclusiveCalendarDayCount(from, to) > 42) {
    return { ok: false as const, error: "Der Kalenderbereich darf höchstens 42 Tage umfassen." };
  }
  return { ok: true as const, range: { from, to } };
}

export function berlinDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TEAM_WORKWEEK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const entries = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${entries.year}-${entries.month}-${entries.day}`;
}

export function berlinClockMinute(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TEAM_WORKWEEK_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const entries = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(entries.hour) * 60 + Number(entries.minute);
}

export function weekdayForDate(value: string) {
  const isoWeekday = utcDate(value).getUTCDay() || 7;
  return TEAM_WORKWEEK_DAYS.find((day) => day.weekday === isoWeekday)!;
}

export function selectCalendarWorkweek(
  workweeks: CalendarTeamWorkweek[],
  ownerProfileId: string,
  dateKey: string,
) {
  return workweeks
    .filter((workweek) => workweek.ownerProfileId === ownerProfileId)
    .filter((workweek) => workweek.effectiveFrom <= dateKey && (!workweek.effectiveTo || workweek.effectiveTo >= dateKey))
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom)
      || right.publicationRevision - left.publicationRevision)[0] || null;
}

function minuteForClock(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function isMinuteInsideWindow(minute: number, window: Readonly<{ start: string; end: string }>) {
  return minute >= minuteForClock(window.start) && minute < minuteForClock(window.end);
}

export function projectCalendarWorktimes({
  calendarWorkweeks,
  dateKey,
  now = new Date(),
  profiles,
}: {
  calendarWorkweeks: CalendarTeamWorkweek[];
  dateKey: string;
  now?: Date;
  profiles: Profile[];
}): CalendarWorktime[] {
  const day = weekdayForDate(dateKey);
  const todayKey = berlinDateKey(now);
  const minute = berlinClockMinute(now);

  return profiles.flatMap((profile) => {
    const workweek = selectCalendarWorkweek(calendarWorkweeks, profile.id, dateKey);
    const windows = workweek?.windows[day.key] || [];
    if (!windows.length) return [];
    return [{
      profile,
      windows,
      workingNow: dateKey === todayKey && windows.some((window) => isMinuteInsideWindow(minute, window)),
    }];
  });
}

function eventBoundaryKey(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : berlinDateKey(date);
}

export function eventCalendarDayKeys(event: HeaderCalendarEvent) {
  const start = eventBoundaryKey(event.startsAt);
  const parsedStart = new Date(event.startsAt);
  const parsedEnd = event.endsAt ? new Date(event.endsAt) : parsedStart;
  const effectiveEnd = !Number.isNaN(parsedStart.getTime())
    && !Number.isNaN(parsedEnd.getTime())
    && parsedEnd.getTime() > parsedStart.getTime()
    ? new Date(parsedEnd.getTime() - 1)
    : parsedEnd;
  const end = Number.isNaN(effectiveEnd.getTime()) ? null : berlinDateKey(effectiveEnd);
  if (!start || !end) return [];
  const last = end < start ? start : end;
  const keys: string[] = [];
  for (let key = start; key <= last; key = addCalendarDays(key, 1)) keys.push(key);
  return keys;
}

export function eventsByCalendarDay(events: HeaderCalendarEvent[]) {
  const result = new Map<string, HeaderCalendarEvent[]>();
  for (const event of events) {
    for (const dateKey of eventCalendarDayKeys(event)) {
      const dayEvents = result.get(dateKey) || [];
      dayEvents.push(event);
      result.set(dateKey, dayEvents);
    }
  }
  for (const [dateKey, dayEvents] of result) {
    result.set(dateKey, [...dayEvents].sort((left, right) => left.startsAt.localeCompare(right.startsAt)));
  }
  return result;
}
