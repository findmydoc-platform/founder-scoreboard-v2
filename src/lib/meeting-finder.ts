import type { AvailabilityEntry, Meeting, PlanningData, Profile } from "@/lib/types";

export function hexToRgba(hex: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return `rgba(100, 116, 139, ${alpha})`;
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function profileColor(profile?: Pick<Profile, "color"> | null) {
  return profile?.color || "#64748b";
}

export const weekdayOptions = [
  { value: "1", label: "Montag" },
  { value: "2", label: "Dienstag" },
  { value: "3", label: "Mittwoch" },
  { value: "4", label: "Donnerstag" },
  { value: "5", label: "Freitag" },
  { value: "6", label: "Samstag" },
  { value: "0", label: "Sonntag" },
];

export const blockerKindOptions: Array<{ value: AvailabilityEntry["blockerKind"]; label: string }> = [
  { value: "on_business", label: "On Business" },
  { value: "customer_appointment", label: "Kundentermin" },
  { value: "internal_meeting", label: "Internes Meeting" },
  { value: "focus_time", label: "Fokuszeit" },
  { value: "admin", label: "Admin / Orga" },
  { value: "travel", label: "Reise / Anfahrt" },
  { value: "private_appointment", label: "Privater Termin" },
  { value: "vacation", label: "Urlaub" },
  { value: "sick", label: "Krank" },
  { value: "care", label: "Care-Arbeit" },
  { value: "other", label: "Sonstiges" },
];

export const durationOptions = [
  { value: "30", label: "30 Minuten" },
  { value: "45", label: "45 Minuten" },
  { value: "60", label: "60 Minuten" },
  { value: "90", label: "90 Minuten" },
  { value: "custom", label: "Eigene Dauer" },
];

export const timeOptions = Array.from({ length: 35 }, (_, index) => {
  const minutes = 6 * 60 + index * 30;
  const value = minutesToTime(minutes);
  return { value, label: value };
});

export type MeetingSlot = {
  date: string;
  startTime: string;
  endTime: string;
  availableProfileIds: string[];
  unavailable: Array<{ profileId: string; reason: string }>;
  matchType: "full" | "partial";
};

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

export function availabilitySummaryTone(kind: "open" | "blocked" | "closed" | "meeting") {
  if (kind === "meeting") return "border-blue-300 bg-blue-50 text-blue-900";
  if (kind === "blocked") return "border-red-300 bg-red-50 text-red-900";
  return "";
}

export type CalendarCellKind = "open" | "blocked" | "closed" | "meeting";

export type CalendarCell = {
  kind: CalendarCellKind;
  label: string;
  detail: string;
  availableCount: number;
};

export function buildCalendarCell({
  date,
  start,
  meetings,
  availability,
  selectedProfileIds,
  profileNameById,
}: {
  date: string;
  start: number;
  meetings: Meeting[];
  availability: AvailabilityEntry[];
  selectedProfileIds: string[];
  profileNameById: Map<string, string>;
}): CalendarCell {
  const end = start + 60;
  const meetingConflict = meetings.find((meeting) => meetingOverlapsSlot(meeting, date, start, end));
  if (meetingConflict) {
    return {
      kind: "meeting",
      label: "Meeting",
      detail: meetingConflict.title,
      availableCount: 0,
    };
  }

  let workingCount = 0;
  const reasons: string[] = [];

  for (const profileId of selectedProfileIds) {
    const name = profileNameById.get(profileId) || profileId;
    const window = workingWindowFor(profileId, date, availability);
    if (!window || start < window.start || end > window.end) {
      continue;
    }

    workingCount += 1;
    const blocker = availability.find((entry) => entry.profileId === profileId && overlapsSlot(entry, date, start, end));
    if (blocker) {
      reasons.push(`${name}: ${availabilityReason(blocker)}`);
    }
  }

  if (!selectedProfileIds.length) {
    return { kind: "closed", label: "Keine Auswahl", detail: "Wähle Teilnehmer aus.", availableCount: 0 };
  }
  if (!workingCount) {
    return { kind: "closed", label: "Keine Arbeitszeit", detail: "", availableCount: 0 };
  }
  if (reasons.length) {
    return {
      kind: "blocked",
      label: reasons.length === 1 ? "Blocker" : "Mehrere Blocker",
      detail: reasons.slice(0, 3).join(", "),
      availableCount: workingCount - reasons.length,
    };
  }
  return { kind: "open", label: "Arbeitszeit frei", detail: "", availableCount: workingCount };
}

export function summarizeCalendarDay(hours: number[], cellForHour: (hour: number) => { kind: CalendarCellKind }) {
  const summary = { open: 0, blocked: 0, meetings: 0, closed: 0 };
  for (const hour of hours) {
    const cell = cellForHour(hour);
    if (cell.kind === "open") summary.open += 1;
    if (cell.kind === "blocked") summary.blocked += 1;
    if (cell.kind === "meeting") summary.meetings += 1;
    if (cell.kind === "closed") summary.closed += 1;
  }
  return summary;
}

export type CalendarBlock = {
  id: string;
  kind: "blocked" | "meeting";
  entry?: AvailabilityEntry;
  profileId?: string;
  ownerName?: string;
  color: string;
  label: string;
  detail: string;
  start: number;
  end: number;
  tone: string;
};

export function buildCalendarBlocksForDate({
  date,
  hours,
  meetings,
  availability,
  selectedProfileIds,
  profileById,
  profileNameById,
}: {
  date: string;
  hours: number[];
  meetings: Meeting[];
  availability: AvailabilityEntry[];
  selectedProfileIds: string[];
  profileById: Map<string, Profile>;
  profileNameById: Map<string, string>;
}) {
  const firstVisibleMinute = hours[0] || 8 * 60;
  const lastVisibleMinute = (hours.at(-1) || 21 * 60) + 60;
  const blocks: CalendarBlock[] = [];

  for (const meeting of meetings) {
    if (!meetingOverlapsSlot(meeting, date, firstVisibleMinute, lastVisibleMinute)) continue;
    const meetingDate = new Date(meeting.meetingAt);
    const meetingStart = meetingDate.getHours() * 60 + meetingDate.getMinutes();
    const meetingEnd = meetingStart + (meeting.durationMinutes || 60);
    blocks.push({
      id: `meeting-${meeting.id}-${date}`,
      kind: "meeting",
      color: "#3b82f6",
      label: meeting.title,
      detail: `${minutesToTime(meetingStart)} bis ${minutesToTime(meetingEnd)}`,
      start: Math.max(firstVisibleMinute, meetingStart),
      end: Math.min(lastVisibleMinute, meetingEnd),
      tone: availabilitySummaryTone("meeting"),
    });
  }

  for (const profileId of selectedProfileIds) {
    const window = workingWindowFor(profileId, date, availability);
    if (!window) continue;
    const profile = profileById.get(profileId);
    const name = profile?.name || profileNameById.get(profileId) || profileId;
    const color = profileColor(profile);
    for (const entry of availability) {
      if (entry.profileId !== profileId || entry.type === "working_hours") continue;
      if (!overlapsSlot(entry, date, firstVisibleMinute, lastVisibleMinute)) continue;

      const entryStart = entry.startTime ? timeToMinutes(entry.startTime) : 0;
      const entryEnd = entry.endTime ? timeToMinutes(entry.endTime) : 24 * 60;
      const start = Math.max(firstVisibleMinute, window.start, entryStart);
      const end = Math.min(lastVisibleMinute, window.end, entryEnd);
      if (start >= end) continue;

      blocks.push({
        id: `blocker-${entry.id}-${profileId}-${date}`,
        kind: "blocked",
        entry,
        profileId,
        ownerName: name,
        color,
        label: availabilityCalendarLabel(entry),
        detail: `${minutesToTime(start)} bis ${minutesToTime(end)}`,
        start,
        end,
        tone: availabilityTone(entry.type, entry.source),
      });
    }
  }

  return blocks.sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
}

export function googleCalendarDate(date: string, time: string) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

export function meetingSlotIso(slot: MeetingSlot) {
  return new Date(`${slot.date}T${slot.startTime}:00`).toISOString();
}

export function googleCalendarUrl(slot: MeetingSlot, profiles: Profile[], title = "FindMyDoc Teammeeting", agenda = "") {
  const attendeeEmails = profiles.map((profile) => profile.googleCalendarEmail).filter(Boolean);
  const encodedTitle = encodeURIComponent(title);
  const details = encodeURIComponent(`${agenda ? `${agenda}\n\n` : ""}Teilnehmer: ${profiles.map((profile) => profile.name).join(", ")}`);
  const dates = `${googleCalendarDate(slot.date, slot.startTime)}/${googleCalendarDate(slot.date, slot.endTime)}`;
  const attendees = attendeeEmails.length ? `&add=${encodeURIComponent(attendeeEmails.join(","))}` : "";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodedTitle}&dates=${dates}&ctz=Europe/Berlin&details=${details}${attendees}`;
}

export function meetingOverlapsSlot(meeting: Meeting, date: string, start: number, end: number) {
  if (meeting.status === "cancelled") return false;
  const meetingDate = new Date(meeting.meetingAt);
  if (dateKey(meetingDate) !== date) return false;
  const meetingStart = meetingDate.getHours() * 60 + meetingDate.getMinutes();
  const meetingEnd = meetingStart + (meeting.durationMinutes || 60);
  return start < meetingEnd && end > meetingStart;
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

export function findMeetingSlots(data: PlanningData, profileIds: string[], from: string, to: string, durationMinutes: number, searchStart: number, searchEnd: number) {
  const slots: MeetingSlot[] = [];
  let current = from;
  let guard = 0;
  const safeDuration = clampMeetingDuration(durationMinutes);
  const windowStart = Math.max(0, Math.min(searchStart, searchEnd - 15));
  const windowEnd = Math.min(24 * 60, Math.max(searchEnd, windowStart + safeDuration));

  while (current <= to && guard < 21 && slots.length < 60) {
    guard += 1;
    for (let start = windowStart; start + safeDuration <= windowEnd && slots.length < 60; start += 30) {
      const end = start + safeDuration;
      const availableProfileIds: string[] = [];
      const unavailable: MeetingSlot["unavailable"] = [];

      for (const profileId of profileIds) {
        const window = workingWindowFor(profileId, current, data.availability);
        if (!window) {
          unavailable.push({ profileId, reason: "Keine Arbeitszeit hinterlegt" });
          continue;
        }
        if (start < window.start || end > window.end) {
          unavailable.push({ profileId, reason: "Außerhalb Arbeitszeit" });
          continue;
        }
        const blocker = data.availability.find((entry) => entry.profileId === profileId && overlapsSlot(entry, current, start, end));
        if (blocker) {
          unavailable.push({ profileId, reason: availabilityReason(blocker) });
          continue;
        }
        const meetingConflict = data.meetings.find((meeting) => meetingOverlapsSlot(meeting, current, start, end));
        if (meetingConflict) {
          unavailable.push({ profileId, reason: `Schon belegt: ${meetingConflict.title}` });
          continue;
        }
        availableProfileIds.push(profileId);
      }

      if (availableProfileIds.length === profileIds.length || availableProfileIds.length >= Math.ceil(profileIds.length * 0.6)) {
        slots.push({
          date: current,
          startTime: minutesToTime(start),
          endTime: minutesToTime(end),
          availableProfileIds,
          unavailable,
          matchType: unavailable.length ? "partial" : "full",
        });
      }
    }
    current = addDaysKey(current, 1);
  }

  return slots.sort((a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === "full" ? -1 : 1;
    return `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`);
  });
}
