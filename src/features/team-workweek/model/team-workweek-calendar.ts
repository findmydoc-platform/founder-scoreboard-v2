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
  effectiveAt?: string | null;
  effectiveUntil?: string | null;
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

export type CurrentCalendarWorkweekRow = Readonly<{
  profile: Profile;
  workweek: CalendarTeamWorkweek | null;
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
  now?: Date,
) {
  return workweeks
    .filter((workweek) => workweek.ownerProfileId === ownerProfileId)
    .filter((workweek) => !now || ((!workweek.effectiveAt || new Date(workweek.effectiveAt) <= now) && (!workweek.effectiveUntil || new Date(workweek.effectiveUntil) > now)))
    .filter((workweek) => (workweek.effectiveAt ? berlinDateKey(new Date(workweek.effectiveAt)) : workweek.effectiveFrom) <= dateKey && (!workweek.effectiveTo || workweek.effectiveTo >= dateKey))
    .sort((left, right) => (right.effectiveAt || right.effectiveFrom).localeCompare(left.effectiveAt || left.effectiveFrom)
      || right.publicationRevision - left.publicationRevision)[0] || null;
}

export function projectCurrentCalendarWorkweekRows({
  calendarWorkweeks,
  dateKey = berlinDateKey(),
  profiles,
}: {
  calendarWorkweeks: CalendarTeamWorkweek[];
  dateKey?: string;
  profiles: Profile[];
}): CurrentCalendarWorkweekRow[] {
  return profiles.map((profile) => ({
    profile,
    workweek: selectCalendarWorkweek(calendarWorkweeks, profile.id, dateKey),
  }));
}

function minuteForClock(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

const civilFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TEAM_WORKWEEK_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function civilStamp(instant: number) {
  const parts = Object.fromEntries(civilFormatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
}

export function berlinCivilInstant(dateKey: string, clock: string) {
  const nominal = Date.parse(`${dateKey}T${clock}:00Z`);
  const offsets = new Set([-2, -1, 0, 1, 2].map((days) => {
    const sample = nominal + days * 86_400_000;
    return civilStamp(sample) - sample;
  }));
  const candidates = [...offsets].map((offset) => nominal - offset);
  const exact = candidates.filter((candidate) => civilStamp(candidate) === nominal);
  if (exact.length) return Math.min(...exact);
  // RFC5545's pre-transition offset normalizes a spring-gap civil time forward.
  return candidates.filter((candidate) => civilStamp(candidate) > nominal)
    .sort((left, right) => civilStamp(left) - civilStamp(right))[0];
}

export function calendarWindowsForDate(workweek: CalendarTeamWorkweek, dateKey: string) {
  const startDate = workweek.effectiveAt ? berlinDateKey(new Date(workweek.effectiveAt)) : workweek.effectiveFrom;
  const endDate = workweek.effectiveUntil ? berlinDateKey(new Date(workweek.effectiveUntil)) : workweek.effectiveTo;
  if (dateKey < startDate || (endDate && dateKey > endDate)) return [];
  const lower = workweek.effectiveAt ? new Date(workweek.effectiveAt).getTime() : -Infinity;
  const upper = workweek.effectiveUntil ? new Date(workweek.effectiveUntil).getTime() : Infinity;
  const clock = (instant: number) => {
    const minute = berlinClockMinute(new Date(instant));
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  };
  const resolved = workweek.windows[weekdayForDate(dateKey).key].flatMap((window) => {
    const start = Math.max(berlinCivilInstant(dateKey, window.start), lower);
    const end = Math.min(berlinCivilInstant(dateKey, window.end), upper);
    return start < end ? [{ start, end }] : [];
  }).sort((left, right) => left.start - right.start);
  const united: Array<{ start: number; end: number }> = [];
  for (const interval of resolved) {
    const prior = united.at(-1);
    if (prior && interval.start < prior.end) prior.end = Math.max(prior.end, interval.end);
    else united.push({ ...interval });
  }
  const midnight = berlinCivilInstant(dateKey, "00:00");
  const nextMidnight = berlinCivilInstant(addCalendarDays(dateKey, 1), "00:00");
  const transitionDay = nextMidnight - midnight !== 86_400_000;
  return united.map(({ start, end }) => {
    const offsetChanged = transitionDay || civilStamp(start) - start !== civilStamp(end) - end
      || Math.floor(berlinCivilInstant(dateKey, clock(start)) / 60_000) !== Math.floor(start / 60_000)
      || Math.floor(berlinCivilInstant(dateKey, clock(end)) / 60_000) !== Math.floor(end / 60_000);
    return { start: clock(start), end: clock(end), ...(offsetChanged ? { startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() } : {}) };
  });
}

export function calendarWindowLabel(window: Readonly<{start:string;end:string;startsAt?:string;endsAt?:string}>) {
  if (!window.startsAt || !window.endsAt) return `${window.start}–${window.end}`;
  const format = (value:string) => new Intl.DateTimeFormat("de-DE", {timeZone:TEAM_WORKWEEK_TIMEZONE,hour:"2-digit",minute:"2-digit",timeZoneName:"short"}).format(new Date(value));
  return `${format(window.startsAt)}–${format(window.endsAt)}`;
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
  const todayKey = berlinDateKey(now);
  const minute = berlinClockMinute(now);

  return profiles.flatMap((profile) => {
    const segments = calendarWorkweeks.filter((entry) => entry.ownerProfileId === profile.id);
    const windows = segments.flatMap((entry) => calendarWindowsForDate(entry, dateKey)).sort((left, right) => left.start.localeCompare(right.start));
    if (!windows.length) return [];
    return [{
      profile,
      windows,
      workingNow: dateKey === todayKey && segments.some((entry) => (!entry.effectiveAt || new Date(entry.effectiveAt) <= now)
        && (!entry.effectiveUntil || new Date(entry.effectiveUntil) > now)
        && calendarWindowsForDate(entry, dateKey).some((window) => window.startsAt && window.endsAt
          ? now.getTime() >= new Date(window.startsAt).getTime() && now.getTime() < new Date(window.endsAt).getTime()
          : isMinuteInsideWindow(minute, window))),
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
