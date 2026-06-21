import type { Meeting, MeetingAttendance } from "./types";
import type { DbMeeting, DbMeetingAttendance } from "./planning-data-row-types";

export function mapMeeting(row: DbMeeting): Meeting {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    title: row.title,
    meetingAt: row.meeting_at,
    durationMinutes: row.duration_minutes || 60,
    status: row.status,
    agenda: row.agenda || "",
    googleCalendarId: row.google_calendar_id || "",
    googleCalendarEventId: row.google_calendar_event_id || "",
    googleCalendarHtmlLink: row.google_calendar_html_link || "",
    googleCalendarSyncStatus: row.google_calendar_sync_status || "not_synced",
    googleCalendarSyncError: row.google_calendar_sync_error || "",
    googleCalendarSyncedAt: row.google_calendar_synced_at || "",
  };
}

export function mapMeetingAttendance(row: DbMeetingAttendance): MeetingAttendance {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    profileId: row.profile_id,
    status: row.status,
    absenceReason: row.absence_reason || "",
    reasonAccepted: row.reason_accepted,
    writtenUpdate: row.written_update || "",
    points: row.points,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
