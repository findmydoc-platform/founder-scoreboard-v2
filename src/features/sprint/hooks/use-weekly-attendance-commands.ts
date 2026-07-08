"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { Meeting, MeetingAttendance } from "@/lib/types";

export function useWeeklyAttendanceCommands({
  apiClient,
  data,
  setData,
  setSaveError,
  source,
  startTransition,
}: PlanningCommandContext) {
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
        if (!response.ok || !body?.attendance) throw new Error(body?.error || "Weekly-Rückmeldung konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          meetingAttendance: current.meetingAttendance.map((item) =>
            item.meetingId === attendance.meetingId && item.profileId === attendance.profileId ? body.attendance! : item,
          ),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Weekly-Rückmeldung konnte nicht gespeichert werden.");
      }
    });
  };

  return { updateMeetingAttendance };
}
