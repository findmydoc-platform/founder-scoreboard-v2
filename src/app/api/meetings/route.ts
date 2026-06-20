import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireFounder, requireOperationalLead } from "@/lib/authz";
import { createGoogleCalendarEvent, isGoogleCalendarSyncConfigured } from "@/lib/google-calendar";
import type { Meeting, MeetingAttendance } from "@/lib/types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type CreateMeetingPayload = {
  id?: number;
  title?: string;
  meetingAt?: string;
  durationMinutes?: number;
  agenda?: string;
  sprintId?: string;
  profileIds?: string[];
  status?: Meeting["status"];
};

function cleanProfileIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)));
}

function cleanDurationMinutes(value: unknown) {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 480) return 60;
  return minutes;
}

function mapMeeting(row: {
  id: number;
  sprint_id: string;
  title: string;
  meeting_at: string;
  duration_minutes: number | null;
  status: Meeting["status"];
  agenda: string | null;
  google_calendar_id: string | null;
  google_calendar_event_id: string | null;
  google_calendar_html_link: string | null;
  google_calendar_sync_status: Meeting["googleCalendarSyncStatus"] | null;
  google_calendar_sync_error: string | null;
  google_calendar_synced_at: string | null;
}): Meeting {
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

function mapAttendance(row: {
  id: number;
  meeting_id: number;
  profile_id: string;
  status: MeetingAttendance["status"];
  absence_reason: string | null;
  reason_accepted: boolean;
  written_update: string | null;
  points: number;
  created_at: string;
  updated_at: string;
}): MeetingAttendance {
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

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<CreateMeetingPayload>(request, requireFounder, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const title = cleanText(payload.title, 160) || "findmydoc Teammeeting";
  const agenda = cleanText(payload.agenda, 4000);
  const sprintId = cleanText(payload.sprintId, 80);
  const profileIds = cleanProfileIds(payload.profileIds);
  const meetingAt = cleanText(payload.meetingAt, 80);
  const parsedMeetingAt = meetingAt ? new Date(meetingAt) : null;
  const durationMinutes = cleanDurationMinutes(payload.durationMinutes);

  if (!sprintId) return apiError("Sprint ist erforderlich.", 400);
  if (!parsedMeetingAt || Number.isNaN(parsedMeetingAt.getTime())) return apiError("Meeting-Zeitpunkt ist ungültig.", 400);
  if (!profileIds.length) return apiError("Mindestens ein Teilnehmer ist erforderlich.", 400);

  const [{ data: sprint }, { data: profiles }, { data: actorProfile }] = await Promise.all([
    supabase.from("sprints").select("id").eq("id", sprintId).single(),
    supabase.from("profiles").select("id,name,google_calendar_email").in("id", profileIds),
    permission.profile?.id
      ? supabase.from("profiles").select("id,google_calendar_email").eq("id", permission.profile.id).single()
      : Promise.resolve({ data: null }),
  ]);

  if (!sprint) return apiError("Sprint wurde nicht gefunden.", 404);
  const validProfileIds = new Set((profiles || []).map((profile) => profile.id));
  if (validProfileIds.size !== profileIds.length) return apiError("Mindestens ein Teilnehmerprofil wurde nicht gefunden.", 404);

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .insert({
      sprint_id: sprintId,
      title,
      meeting_at: parsedMeetingAt.toISOString(),
      duration_minutes: durationMinutes,
      status: "planned",
      agenda,
      updated_at: new Date().toISOString(),
    })
    .select("id,sprint_id,title,meeting_at,duration_minutes,status,agenda,google_calendar_id,google_calendar_event_id,google_calendar_html_link,google_calendar_sync_status,google_calendar_sync_error,google_calendar_synced_at")
    .single();

  if (meetingError || !meeting) return apiError(meetingError?.message || "Meeting konnte nicht angelegt werden.", 500);

  const { data: attendance, error: attendanceError } = await supabase
    .from("meeting_attendance")
    .insert(profileIds.map((profileId) => ({
      meeting_id: meeting.id,
      profile_id: profileId,
      status: "pending",
      absence_reason: "",
      reason_accepted: false,
      written_update: "",
      points: 0,
    })))
    .select("id,meeting_id,profile_id,status,absence_reason,reason_accepted,written_update,points,created_at,updated_at");

  if (attendanceError) return apiError(attendanceError.message, 500);

  const attendeeEmails = (profiles || [])
    .map((profile) => profile.google_calendar_email)
    .filter((email): email is string => Boolean(email));
  const organizerEmail = actorProfile?.google_calendar_email || attendeeEmails[0] || "";
  let calendarSync: { status: "synced" | "skipped" | "failed"; htmlLink?: string; error?: string } = { status: "skipped" };

  if (isGoogleCalendarSyncConfigured() && organizerEmail) {
    try {
      const synced = await createGoogleCalendarEvent({
        organizerEmail,
        attendeeEmails: attendeeEmails.filter((email) => email !== organizerEmail),
        title,
        agenda,
        startIso: parsedMeetingAt.toISOString(),
        durationMinutes,
      });
      const syncedAt = new Date().toISOString();
      const { data: syncedMeeting } = await supabase
        .from("meetings")
        .update({
          google_calendar_id: synced.calendarId,
          google_calendar_event_id: synced.eventId,
          google_calendar_html_link: synced.htmlLink,
          google_calendar_sync_status: "synced",
          google_calendar_sync_error: "",
          google_calendar_synced_at: syncedAt,
          updated_at: syncedAt,
        })
        .eq("id", meeting.id)
        .select("id,sprint_id,title,meeting_at,duration_minutes,status,agenda,google_calendar_id,google_calendar_event_id,google_calendar_html_link,google_calendar_sync_status,google_calendar_sync_error,google_calendar_synced_at")
        .single();
      if (syncedMeeting) Object.assign(meeting, syncedMeeting);
      calendarSync = { status: "synced", htmlLink: synced.htmlLink };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Calendar Sync fehlgeschlagen.";
      await supabase
        .from("meetings")
        .update({
          google_calendar_sync_status: "failed",
          google_calendar_sync_error: message.slice(0, 1000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", meeting.id);
      meeting.google_calendar_sync_status = "failed";
      meeting.google_calendar_sync_error = message;
      calendarSync = { status: "failed", error: message };
    }
  }

  const notifications = profileIds
    .filter((profileId) => profileId !== permission.profile?.id)
    .map((profileId) => ({
      type: "meeting.created",
      actor_profile_id: permission.profile?.id || null,
      recipient_profile_id: profileId,
      entity_type: "meeting",
      entity_id: String(meeting.id),
      title: `Meeting vorgemerkt: ${title}`,
      body: `${parsedMeetingAt.toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" })}${agenda ? `\nAgenda: ${agenda}` : ""}`,
    }));
  if (notifications.length) await supabase.from("notification_events").insert(notifications);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile.id,
    action: "meeting.create",
    entity_type: "meeting",
    entity_id: String(meeting.id),
    after_data: { title, agenda, sprintId, meetingAt: parsedMeetingAt.toISOString(), durationMinutes, profileIds, calendarSync },
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({
    meeting: mapMeeting(meeting),
    attendance: (attendance || []).map(mapAttendance),
    calendarSync,
  });
}

export async function PATCH(request: NextRequest) {
  const context = await requireJsonApiContext<CreateMeetingPayload>(request, requireOperationalLead, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const id = Number(payload.id);
  if (!Number.isFinite(id)) return apiError("Meeting ist erforderlich.", 400);

  const { data: current, error: currentError } = await supabase
    .from("meetings")
    .select("id,sprint_id,title,meeting_at,duration_minutes,status,agenda,google_calendar_id,google_calendar_event_id,google_calendar_html_link,google_calendar_sync_status,google_calendar_sync_error,google_calendar_synced_at")
    .eq("id", id)
    .single();
  if (currentError || !current) return apiError("Meeting wurde nicht gefunden.", 404);

  const patch: Record<string, string> = { updated_at: new Date().toISOString() };
  const title = cleanText(payload.title, 160);
  const agenda = cleanText(payload.agenda, 4000);
  const status = payload.status;
  const meetingAt = cleanText(payload.meetingAt, 80);
  const parsedMeetingAt = meetingAt ? new Date(meetingAt) : null;

  if (title) patch.title = title;
  if (typeof payload.agenda === "string") patch.agenda = agenda;
  if (status) {
    if (!["planned", "done", "cancelled"].includes(status)) return apiError("Meeting-Status ist ungültig.", 400);
    patch.status = status;
  }
  if (meetingAt) {
    if (!parsedMeetingAt || Number.isNaN(parsedMeetingAt.getTime())) return apiError("Meeting-Zeitpunkt ist ungültig.", 400);
    patch.meeting_at = parsedMeetingAt.toISOString();
  }

  const { data: meeting, error } = await supabase
    .from("meetings")
    .update(patch)
    .eq("id", id)
    .select("id,sprint_id,title,meeting_at,duration_minutes,status,agenda,google_calendar_id,google_calendar_event_id,google_calendar_html_link,google_calendar_sync_status,google_calendar_sync_error,google_calendar_synced_at")
    .single();

  if (error || !meeting) return apiError(error?.message || "Meeting konnte nicht aktualisiert werden.", 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile.id,
    action: "meeting.update",
    entity_type: "meeting",
    entity_id: String(id),
    before_data: current,
    after_data: patch,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ meeting: mapMeeting(meeting) });
}
