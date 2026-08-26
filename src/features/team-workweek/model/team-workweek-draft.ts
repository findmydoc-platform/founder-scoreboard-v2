export const TEAM_WORKWEEK_TIMEZONE = "Europe/Berlin";

export const TEAM_WORKWEEK_DAYS = [
  { weekday: 1, key: "monday", label: "Montag" },
  { weekday: 2, key: "tuesday", label: "Dienstag" },
  { weekday: 3, key: "wednesday", label: "Mittwoch" },
  { weekday: 4, key: "thursday", label: "Donnerstag" },
  { weekday: 5, key: "friday", label: "Freitag" },
  { weekday: 6, key: "saturday", label: "Samstag" },
  { weekday: 7, key: "sunday", label: "Sonntag" },
] as const;

export type TeamWorkweekDayKey = typeof TEAM_WORKWEEK_DAYS[number]["key"];
export type TeamWorkweekWindow = Readonly<{ start: string; end: string }>;
export type TeamWorkweekWindows = Record<TeamWorkweekDayKey, TeamWorkweekWindow[]>;

export type PrivateTeamWorkweekVersion = Readonly<{
  id: string;
  effectiveFrom: string;
  timezone: typeof TEAM_WORKWEEK_TIMEZONE;
  status: "preparing";
  createdAt: string;
  windows: TeamWorkweekWindows;
}>;

export type PrivateTeamWorkweekDraft = Readonly<{
  effectiveFrom: string;
  windows: TeamWorkweekWindows;
}>;

export type OwnTeamWorkweekPublication = Readonly<{
  id: string;
  effectiveFrom: string;
  status: "preparing" | "published";
  syncState: "pending" | "delayed" | "confirmed";
  publicationRevision: number;
  publishedAt: string | null;
  lastSyncAt: string | null;
}>;

export function emptyTeamWorkweekWindows(): TeamWorkweekWindows {
  return {
    monday: [],
    tuesday: [],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: [],
  };
}

function berlinDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TEAM_WORKWEEK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as Record<string, string>;
}

export function berlinTodayIso(now = new Date()) {
  const parts = berlinDateParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function nextMondayIso(now = new Date()) {
  const parts = berlinDateParts(now);
  const current = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
  const isoWeekday = current.getUTCDay() || 7;
  const daysUntilNextMonday = isoWeekday === 1 ? 7 : 8 - isoWeekday;
  current.setUTCDate(current.getUTCDate() + daysUntilNextMonday);
  return current.toISOString().slice(0, 10);
}

export function mondayAfterIso(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.getUTCDay() !== 1 || date.toISOString().slice(0, 10) !== value) {
    throw new RangeError("Team workweek boundary must be an ISO Monday.");
  }
  date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString().slice(0, 10);
}

export function nextVersionMondayIso(latestPublishedEffectiveFrom: string | null, now = new Date()) {
  const nextMonday = nextMondayIso(now);
  if (!latestPublishedEffectiveFrom) return nextMonday;
  const afterLatest = mondayAfterIso(latestPublishedEffectiveFrom);
  return afterLatest > nextMonday ? afterLatest : nextMonday;
}

function minuteForClock(value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function clockForMinute(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 1439) {
    throw new RangeError("Team workweek minute must stay inside one civil day.");
  }
  const hour = Math.floor(value / 60).toString().padStart(2, "0");
  const minute = (value % 60).toString().padStart(2, "0");
  return `${hour}:${minute}`;
}

function isMonday(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && parsed.getUTCDay() === 1;
}

export function validatePrivateTeamWorkweekDraft(
  value: unknown,
  now = new Date(),
  minimumEffectiveFrom = nextMondayIso(now),
) {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const errors: string[] = [];
  if (Object.keys(input).some((key) => !["effectiveFrom", "windows"].includes(key))) {
    errors.push("Die Anfrage enthält nicht unterstützte Felder.");
  }
  const effectiveFrom = typeof input.effectiveFrom === "string" ? input.effectiveFrom.trim() : "";
  const earliest = minimumEffectiveFrom > nextMondayIso(now) ? minimumEffectiveFrom : nextMondayIso(now);
  if (!isMonday(effectiveFrom)) {
    errors.push("Der Gültigkeitsbeginn muss ein Montag sein.");
  } else if (effectiveFrom < earliest) {
    errors.push("Der Gültigkeitsbeginn darf nicht rückwirkend sein.");
  }

  const windowsInput = input.windows && typeof input.windows === "object" && !Array.isArray(input.windows)
    ? input.windows as Record<string, unknown>
    : null;
  if (!windowsInput) errors.push("Die Grundwoche ist ungültig.");
  if (windowsInput && Object.keys(windowsInput).some((key) => !TEAM_WORKWEEK_DAYS.some((day) => day.key === key))) {
    errors.push("Die Grundwoche enthält einen unbekannten Wochentag.");
  }

  const windows = emptyTeamWorkweekWindows();
  for (const day of TEAM_WORKWEEK_DAYS) {
    const dayValue = windowsInput?.[day.key] ?? [];
    if (!Array.isArray(dayValue) || dayValue.length > 12) {
      errors.push(`${day.label}: Es sind höchstens zwölf Zeitfenster erlaubt.`);
      continue;
    }
    const normalized: Array<TeamWorkweekWindow & { startMinute: number; endMinute: number }> = [];
    for (const [index, rawWindow] of dayValue.entries()) {
      const windowValue = rawWindow && typeof rawWindow === "object" ? rawWindow as Record<string, unknown> : {};
      if (Object.keys(windowValue).some((key) => !["start", "end"].includes(key))) {
        errors.push(`${day.label}, Fenster ${index + 1}: Nicht unterstützte Felder.`);
      }
      const start = typeof windowValue.start === "string" ? windowValue.start : "";
      const end = typeof windowValue.end === "string" ? windowValue.end : "";
      const startMinute = minuteForClock(start);
      const endMinute = minuteForClock(end);
      if (startMinute === null || endMinute === null || startMinute >= endMinute) {
        errors.push(`${day.label}, Fenster ${index + 1}: Beginn muss vor Ende innerhalb desselben Tages liegen.`);
        continue;
      }
      normalized.push({ start, end, startMinute, endMinute });
    }
    normalized.sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
    for (let index = 1; index < normalized.length; index += 1) {
      if (normalized[index].startMinute < normalized[index - 1].endMinute) {
        errors.push(`${day.label}: Zeitfenster dürfen sich nicht überschneiden.`);
        break;
      }
    }
    windows[day.key] = normalized.map(({ start, end }) => ({ start, end }));
  }

  return errors.length
    ? { ok: false as const, errors }
    : { ok: true as const, draft: { effectiveFrom, windows } satisfies PrivateTeamWorkweekDraft };
}

export function flattenTeamWorkweekWindows(windows: TeamWorkweekWindows) {
  return TEAM_WORKWEEK_DAYS.flatMap((day) => windows[day.key].map((window) => ({
    weekday: day.weekday,
    startMinute: minuteForClock(window.start)!,
    endMinute: minuteForClock(window.end)!,
  })));
}

export function inflateTeamWorkweekWindows(
  rows: Array<{ weekday: number; start_minute: number; end_minute: number }>,
) {
  const windows = emptyTeamWorkweekWindows();
  for (const row of rows) {
    const day = TEAM_WORKWEEK_DAYS.find((entry) => entry.weekday === row.weekday);
    if (!day) continue;
    windows[day.key].push({ start: clockForMinute(row.start_minute), end: clockForMinute(row.end_minute) });
  }
  for (const day of TEAM_WORKWEEK_DAYS) {
    windows[day.key].sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end));
  }
  return windows;
}
