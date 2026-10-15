import { addCalendarDays, berlinDateKey, isIsoCalendarDate, weekdayForDate } from "./team-workweek-calendar";

export function workweekStart(dateKey = berlinDateKey()) {
  return addCalendarDays(dateKey, 1 - weekdayForDate(dateKey).weekday);
}

export function workweekInputValue(dateKey: string) {
  const thursday = addCalendarDays(workweekStart(dateKey), 3);
  const year = thursday.slice(0, 4);
  const first = workweekStart(`${year}-01-04`);
  const number = 1 + Math.round((Date.parse(`${workweekStart(dateKey)}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 604_800_000);
  return `${year}-W${String(number).padStart(2, "0")}`;
}

export function weekStartFromInput(value: string) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 53) return null;
  const date = addCalendarDays(workweekStart(`${match[1]}-01-04`), (Number(match[2]) - 1) * 7);
  return workweekInputValue(date) === value ? date : null;
}

export function selectedWorkweek(value: string, now = new Date()) {
  if (!isIsoCalendarDate(value) || workweekStart(value) !== value || value < workweekStart(berlinDateKey(now))) {
    return { ok: false as const, error: "Wähle die aktuelle oder eine zukünftige Woche." };
  }
  return { ok: true as const, weekStart: value, activationMode: value === workweekStart(berlinDateKey(now)) ? "immediate" as const : "future_monday" as const };
}

export function workweekLabel(dateKey: string, today = berlinDateKey(), compact = false) {
  const start = workweekStart(dateKey);
  const end = addCalendarDays(start, 6);
  const format = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("de-DE", { timeZone: "UTC", ...options }).format(new Date(`${value}T12:00:00Z`));
  const range = start.slice(0, 7) === end.slice(0, 7)
    ? `${format(start, { day: "numeric" })}.–${format(end, { day: "numeric", month: compact ? "short" : "long", ...(compact ? {} : { year: "numeric" }) })}`
    : `${format(start, { day: "numeric", month: "short", ...(compact ? {} : { year: "numeric" }) })}–${format(end, { day: "numeric", month: "short", ...(compact ? {} : { year: "numeric" }) })}`;
  const current = workweekStart(today);
  const relative = start === current ? "Diese Woche · " : start === addCalendarDays(current, 7) ? "Nächste Woche · " : "";
  return `${relative}${range}`;
}
