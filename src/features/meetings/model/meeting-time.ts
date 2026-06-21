export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDaysKey(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function startOfWeekKey(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return dateKey(date);
}

export function addMonthsToWeekKey(value: string, months: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return startOfWeekKey(dateKey(date));
}

export function monthStartKey(value: string) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(1);
  return dateKey(date);
}

export function monthEndKey(value: string) {
  const date = new Date(`${value}T00:00:00`);
  date.setMonth(date.getMonth() + 1, 0);
  return dateKey(date);
}

export function calendarMonthGridDates(value: string) {
  const firstDay = monthStartKey(value);
  const lastDay = monthEndKey(value);
  const gridStart = startOfWeekKey(firstDay);
  const lastDate = new Date(`${lastDay}T00:00:00`);
  const lastDayOfWeek = lastDate.getDay();
  const sundayOffset = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
  const gridEnd = addDaysKey(lastDay, sundayOffset);
  const dates: string[] = [];
  for (let date = gridStart; date <= gridEnd; date = addDaysKey(date, 1)) {
    dates.push(date);
  }
  return dates;
}

export function timeToMinutes(value: string) {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

export function minutesToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function calendarBlockPosition(start: number, end: number, hour: number) {
  return {
    top: Math.max(4, ((start - hour) / 60) * 64 + 4),
    height: Math.max(34, ((end - start) / 60) * 64 - 8),
  };
}

export function clampMeetingDuration(value: number) {
  if (!Number.isFinite(value)) return 60;
  return Math.min(480, Math.max(15, Math.round(value)));
}

export function weekdayForDate(value: string) {
  return new Date(`${value}T00:00:00`).getDay();
}

export function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(`${value}T00:00:00`));
}

export function formatLongDateLabel(value: string) {
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long" }).format(new Date(`${value}T00:00:00`));
}

export function formatCalendarMonthLabel(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const month = new Intl.DateTimeFormat("de-DE", { month: "long" });
  const monthYear = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
  if (startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth()) {
    return monthYear.format(startDate);
  }
  if (startDate.getFullYear() === endDate.getFullYear()) {
    return `${month.format(startDate)}/${monthYear.format(endDate)}`;
  }
  return `${monthYear.format(startDate)} / ${monthYear.format(endDate)}`;
}

export function formatCalendarSingleMonthLabel(value: string) {
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

export function formatMeetingDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
