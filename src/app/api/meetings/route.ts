import { NextResponse, type NextRequest } from "next/server";
import { requireOperationalLead } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import type { Meeting, MeetingAttendance } from "@/lib/types";

type CreateMeetingPayload = {
  title?: string;
  meetingAt?: string;
  agenda?: string;
  sprintId?: string;
  profileIds?: string[];
};

function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function cleanProfileIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)));
}

function mapMeeting(row: { id: number; sprint_id: string; title: string; meeting_at: string; status: Meeting["status"]; agenda: string | null }): Meeting {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    title: row.title,
    meetingAt: row.meeting_at,
    status: row.status,
    agenda: row.agenda || "",
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
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });
  if (!permission.profile) return NextResponse.json({ error: "Profil konnte nicht bestimmt werden." }, { status: 403 });

  const payload = (await request.json().catch(() => ({}))) as CreateMeetingPayload;
  const title = cleanText(payload.title, 160) || "FindMyDoc Teammeeting";
  const agenda = cleanText(payload.agenda, 4000);
  const sprintId = cleanText(payload.sprintId, 80);
  const profileIds = cleanProfileIds(payload.profileIds);
  const meetingAt = cleanText(payload.meetingAt, 80);
  const parsedMeetingAt = meetingAt ? new Date(meetingAt) : null;

  if (!sprintId) return NextResponse.json({ error: "Sprint ist erforderlich." }, { status: 400 });
  if (!parsedMeetingAt || Number.isNaN(parsedMeetingAt.getTime())) return NextResponse.json({ error: "Meeting-Zeitpunkt ist ungültig." }, { status: 400 });
  if (!profileIds.length) return NextResponse.json({ error: "Mindestens ein Teilnehmer ist erforderlich." }, { status: 400 });

  const [{ data: sprint }, { data: profiles }] = await Promise.all([
    supabase.from("sprints").select("id").eq("id", sprintId).single(),
    supabase.from("profiles").select("id").in("id", profileIds),
  ]);

  if (!sprint) return NextResponse.json({ error: "Sprint wurde nicht gefunden." }, { status: 404 });
  const validProfileIds = new Set((profiles || []).map((profile) => profile.id));
  if (validProfileIds.size !== profileIds.length) return NextResponse.json({ error: "Mindestens ein Teilnehmerprofil wurde nicht gefunden." }, { status: 404 });

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .insert({
      sprint_id: sprintId,
      title,
      meeting_at: parsedMeetingAt.toISOString(),
      status: "planned",
      agenda,
      updated_at: new Date().toISOString(),
    })
    .select("id,sprint_id,title,meeting_at,status,agenda")
    .single();

  if (meetingError || !meeting) return NextResponse.json({ error: meetingError?.message || "Meeting konnte nicht angelegt werden." }, { status: 500 });

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

  if (attendanceError) return NextResponse.json({ error: attendanceError.message }, { status: 500 });

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
    after_data: { title, agenda, sprintId, meetingAt: parsedMeetingAt.toISOString(), profileIds },
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    meeting: mapMeeting(meeting),
    attendance: (attendance || []).map(mapAttendance),
  });
}
