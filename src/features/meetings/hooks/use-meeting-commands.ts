"use client";

import { useRef, useState } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { AvailabilityEntry, Meeting, MeetingAttendance } from "@/lib/types";

type MeetingSlotPayload = {
  title: string;
  agenda: string;
  sprintId: string;
  meetingAt: string;
  durationMinutes: number;
  profileIds: string[];
};

export function useMeetingCommands({
  apiClient,
  data,
  setData,
  setSaveError,
  source,
  startTransition,
}: PlanningCommandContext) {
  const optimisticAvailabilityIdRef = useRef(-1);
  const [calendarSyncMessage, setCalendarSyncMessage] = useState("");
  const [meetingCreateMessage, setMeetingCreateMessage] = useState("");

  const updateMeetingAttendance = (meeting: Meeting, attendance: MeetingAttendance) => {
    setSaveError("");

    const previousData = data;
    setData((current) => {
      const exists = current.meetingAttendance.some((item) => item.meetingId === attendance.meetingId && item.profileId === attendance.profileId);
      return {
        ...current,
        meetingAttendance: exists
          ? current.meetingAttendance.map((item) => (item.meetingId === attendance.meetingId && item.profileId === attendance.profileId ? attendance : item))
          : [attendance, ...current.meetingAttendance],
      };
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.updateMeetingAttendanceRequest(apiClient, meeting.id, {
          profileId: attendance.profileId,
          status: attendance.status,
          absenceReason: attendance.absenceReason,
          reasonAccepted: attendance.reasonAccepted,
          writtenUpdate: attendance.writtenUpdate,
          points: attendance.points,
        });
        if (!response.ok || !body?.attendance) throw new Error(body?.error || "Meeting-Rückmeldung konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          meetingAttendance: current.meetingAttendance.map((item) =>
            item.meetingId === attendance.meetingId && item.profileId === attendance.profileId ? body.attendance! : item,
          ),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Meeting-Rückmeldung konnte nicht gespeichert werden.");
      }
    });
  };

  const createMeetingFromSlot = (payload: MeetingSlotPayload) => {
    setSaveError("");
    setMeetingCreateMessage("");

    const localMeetingId = Date.now();
    const now = new Date().toISOString();
    const localMeeting: Meeting = {
      id: localMeetingId,
      sprintId: payload.sprintId,
      title: payload.title,
      meetingAt: payload.meetingAt,
      durationMinutes: payload.durationMinutes,
      status: "planned",
      agenda: payload.agenda,
      googleCalendarSyncStatus: "not_synced",
    };
    const localAttendance: MeetingAttendance[] = payload.profileIds.map((profileId, index) => ({
      id: localMeetingId + index + 1,
      meetingId: localMeetingId,
      profileId,
      status: "pending",
      absenceReason: "",
      reasonAccepted: false,
      writtenUpdate: "",
      points: 0,
      createdAt: now,
      updatedAt: now,
    }));
    const previousData = data;

    setData((current) => ({
      ...current,
      meetings: [localMeeting, ...current.meetings],
      meetingAttendance: [...localAttendance, ...current.meetingAttendance],
    }));
    setMeetingCreateMessage(`Meeting vorgemerkt: ${payload.title}`);

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.createMeetingRequest(apiClient, payload);
        if (!response.ok || !body?.meeting) throw new Error(body?.error || "Meeting konnte nicht vorgemerkt werden.");

        setData((current) => ({
          ...current,
          meetings: current.meetings.map((item) => (item.id === localMeetingId ? body.meeting! : item)),
          meetingAttendance: [
            ...(body.attendance || []),
            ...current.meetingAttendance.filter((item) => item.meetingId !== localMeetingId),
          ],
        }));
        setMeetingCreateMessage(body.calendarSync?.status === "synced"
          ? `Meeting angelegt und mit Google Kalender synchronisiert: ${body.meeting.title}`
          : body.calendarSync?.status === "failed"
            ? `Meeting angelegt. Google Kalender Sync fehlgeschlagen: ${body.calendarSync.error}`
            : `Meeting in der App angelegt: ${body.meeting.title}`);
      } catch (error) {
        setData(previousData);
        setMeetingCreateMessage("");
        setSaveError(error instanceof Error ? error.message : "Meeting konnte nicht vorgemerkt werden.");
      }
    });
  };

  const updateMeeting = (meeting: Meeting, patch: Partial<Pick<Meeting, "title" | "agenda" | "meetingAt" | "status">>) => {
    setSaveError("");
    setMeetingCreateMessage("");

    const previousData = data;
    const nextMeeting = { ...meeting, ...patch };
    setData((current) => ({
      ...current,
      meetings: current.meetings.map((item) => (item.id === meeting.id ? nextMeeting : item)),
    }));
    setMeetingCreateMessage(nextMeeting.status === "cancelled" ? `Meeting abgesagt: ${nextMeeting.title}` : `Meeting aktualisiert: ${nextMeeting.title}`);

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.updateMeetingRequest(apiClient, {
          id: meeting.id,
          title: patch.title,
          agenda: patch.agenda,
          meetingAt: patch.meetingAt,
          status: patch.status,
        });
        if (!response.ok || !body?.meeting) throw new Error(body?.error || "Meeting konnte nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          meetings: current.meetings.map((item) => (item.id === meeting.id ? body.meeting! : item)),
        }));
        setMeetingCreateMessage(body.meeting.status === "cancelled" ? `Meeting abgesagt: ${body.meeting.title}` : `Meeting aktualisiert: ${body.meeting.title}`);
      } catch (error) {
        setData(previousData);
        setMeetingCreateMessage("");
        setSaveError(error instanceof Error ? error.message : "Meeting konnte nicht aktualisiert werden.");
      }
    });
  };

  const createAvailability = (entry: Omit<AvailabilityEntry, "id">) => {
    setSaveError("");

    const localEntry: AvailabilityEntry = { ...entry, id: optimisticAvailabilityIdRef.current };
    optimisticAvailabilityIdRef.current -= 1;
    const previousData = data;
    setData((current) => ({
      ...current,
      availability: [localEntry, ...current.availability],
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.availabilityRequest<{ error?: string; availability?: AvailabilityEntry }>(apiClient, "POST", entry);
        if (!response.ok || !body?.availability) throw new Error(body?.error || "Verfügbarkeit konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          availability: current.availability.map((item) => (item.id === localEntry.id ? body.availability! : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Verfügbarkeit konnte nicht gespeichert werden.");
      }
    });
  };

  const deleteAvailability = (entry: AvailabilityEntry) => {
    setSaveError("");

    const previousData = data;
    setData((current) => ({
      ...current,
      availability: current.availability.filter((item) => item.id !== entry.id),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.availabilityRequest<{ error?: string }>(apiClient, "DELETE", { id: entry.id });
        if (!response.ok) throw new Error(body?.error || "Verfügbarkeit konnte nicht gelöscht werden.");
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Verfügbarkeit konnte nicht gelöscht werden.");
      }
    });
  };

  const updateAvailability = (entry: AvailabilityEntry, patch: Partial<Omit<AvailabilityEntry, "id" | "source" | "externalId" | "externalCalendarId" | "syncedAt">>) => {
    setSaveError("");

    const updatedEntry: AvailabilityEntry = { ...entry, ...patch };
    const previousData = data;
    setData((current) => ({
      ...current,
      availability: current.availability.map((item) => (item.id === entry.id ? updatedEntry : item)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.availabilityRequest<{ error?: string; availability?: AvailabilityEntry }>(apiClient, "PATCH", { id: entry.id, ...patch });
        if (!response.ok || !body?.availability) throw new Error(body?.error || "Verfügbarkeit konnte nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          availability: current.availability.map((item) => (item.id === entry.id ? body.availability! : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Verfügbarkeit konnte nicht aktualisiert werden.");
      }
    });
  };

  const syncGoogleCalendar = () => {
    setSaveError("");
    setCalendarSyncMessage("Google Calendar Sync wird geprüft...");

    if (source !== "supabase") {
      setCalendarSyncMessage("Kalenderabgleich ist in diesem Arbeitsmodus nicht verfügbar.");
      return;
    }

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.syncGoogleCalendarRequest(apiClient);

        if (!response.ok) throw new Error(body?.error || "Google Calendar Sync konnte nicht ausgeführt werden.");

        if (body?.availability) {
          setData((current) => ({ ...current, availability: body.availability! }));
        }

        const failedProfiles = body?.results?.filter((result) => result.error).length || 0;
        if (body?.skipped) {
          setCalendarSyncMessage(body?.reason || "Google Calendar Sync wurde übersprungen.");
        } else {
          setCalendarSyncMessage(`Google Calendar Sync abgeschlossen: ${body?.imported || 0} Kalenderblöcke importiert, ${body?.removed || 0} alte Blöcke entfernt${failedProfiles ? `, ${failedProfiles} Profil(e) mit Fehler` : ""}.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Google Calendar Sync konnte nicht ausgeführt werden.";
        setCalendarSyncMessage(message);
        setSaveError(message);
      }
    });
  };

  return {
    calendarSyncMessage,
    createAvailability,
    createMeetingFromSlot,
    deleteAvailability,
    meetingCreateMessage,
    syncGoogleCalendar,
    updateAvailability,
    updateMeeting,
    updateMeetingAttendance,
  };
}
