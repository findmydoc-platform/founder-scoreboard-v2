import type { AvailabilityEntry } from "@/lib/types";

import { blockerKindOptions } from "@/features/meetings/model/meeting-options";
import { timeToMinutes, weekdayForDate } from "@/features/meetings/model/meeting-time";
export { profileColor } from "@/lib/profile-style";

export function hexToRgba(hex: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return `rgba(100, 116, 139, ${alpha})`;
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function availabilitySummaryTone(kind: "open" | "blocked" | "closed" | "meeting") {
  if (kind === "meeting") return "border-blue-300 bg-blue-50 text-blue-900";
  if (kind === "blocked") return "border-red-300 bg-red-50 text-red-900";
  return "";
}

export function blockerKindLabel(kind: AvailabilityEntry["blockerKind"]) {
  if (kind === "working_hours") return "Arbeitszeit";
  if (kind === "calendar_event") return "Google Kalender";
  return blockerKindOptions.find((option) => option.value === kind)?.label || "Blocker";
}

export function availabilityTypeForBlockerKind(kind: AvailabilityEntry["blockerKind"]): AvailabilityEntry["type"] {
  if (kind === "working_hours") return "working_hours";
  if (kind === "vacation") return "vacation";
  if (kind === "sick") return "sick";
  return "busy";
}

export function blockerKindForAvailability(entry: AvailabilityEntry): AvailabilityEntry["blockerKind"] {
  if (entry.blockerKind) return entry.blockerKind;
  if (entry.source === "google_calendar") return "calendar_event";
  if (entry.type === "working_hours") return "working_hours";
  if (entry.type === "vacation") return "vacation";
  if (entry.type === "sick") return "sick";
  return "on_business";
}

export function availabilityTone(type: AvailabilityEntry["type"], source?: AvailabilityEntry["source"]) {
  if (source === "google_calendar") return "border-blue-200 bg-blue-50 text-blue-800";
  if (type === "working_hours") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (type === "vacation") return "border-amber-200 bg-amber-50 text-amber-800";
  if (type === "sick") return "border-red-200 bg-red-50 text-red-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function availabilityReason(entry: AvailabilityEntry) {
  const base = blockerKindLabel(blockerKindForAvailability(entry));
  const title = entry.title?.trim();
  if (title) return title === base ? base : `${base}: ${title}`;
  return entry.note ? `${base}: ${entry.note}` : base;
}

export function availabilityCalendarLabel(entry: AvailabilityEntry) {
  return entry.title?.trim() || (entry.source === "google_calendar" ? "Google Kalender" : blockerKindLabel(blockerKindForAvailability(entry)));
}

export function overlapsSlot(entry: AvailabilityEntry, date: string, start: number, end: number) {
  if (entry.type === "working_hours") return false;
  if (entry.startDate && entry.startDate > date) return false;
  if (entry.endDate && entry.endDate < date) return false;
  const blockStart = entry.startTime ? timeToMinutes(entry.startTime) : 0;
  const blockEnd = entry.endTime ? timeToMinutes(entry.endTime) : 24 * 60;
  return start < blockEnd && end > blockStart;
}

export function workingWindowFor(profileId: string, date: string, availability: AvailabilityEntry[]) {
  const weekday = weekdayForDate(date);
  const entry = availability.find((item) => item.profileId === profileId && item.type === "working_hours" && item.weekday === weekday);
  if (!entry?.startTime || !entry.endTime) return null;
  return { start: timeToMinutes(entry.startTime), end: timeToMinutes(entry.endTime) };
}
