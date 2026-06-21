import type { Meeting, PlanningData, Profile } from "@/lib/types";

import { availabilityReason, overlapsSlot, workingWindowFor } from "@/features/meetings/model/meeting-availability";
import { addDaysKey, clampMeetingDuration, dateKey, minutesToTime } from "@/features/meetings/model/meeting-time";

export type MeetingSlot = {
  date: string;
  startTime: string;
  endTime: string;
  availableProfileIds: string[];
  unavailable: Array<{ profileId: string; reason: string }>;
  matchType: "full" | "partial";
};

export function googleCalendarDate(date: string, time: string) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

export function meetingSlotIso(slot: MeetingSlot) {
  return new Date(`${slot.date}T${slot.startTime}:00`).toISOString();
}

export function googleCalendarUrl(slot: MeetingSlot, profiles: Profile[], title = "findmydoc Teammeeting", agenda = "") {
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
