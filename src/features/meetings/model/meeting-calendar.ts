import type { AvailabilityEntry, Meeting, Profile } from "@/lib/types";

import {
  availabilityCalendarLabel,
  availabilityReason,
  availabilitySummaryTone,
  availabilityTone,
  overlapsSlot,
  profileColor,
  workingWindowFor,
} from "@/features/meetings/model/meeting-availability";
import { meetingOverlapsSlot } from "@/features/meetings/model/meeting-slots";
import { minutesToTime, timeToMinutes } from "@/features/meetings/model/meeting-time";

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
