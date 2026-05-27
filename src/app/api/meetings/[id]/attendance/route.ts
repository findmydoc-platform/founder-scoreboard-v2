import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import type { MeetingAttendanceStatus } from "@/lib/types";

type AttendancePayload = {
  profileId?: string;
  status?: MeetingAttendanceStatus;
  absenceReason?: string;
  reasonAccepted?: boolean;
  writtenUpdate?: string;
  points?: number;
};

const statuses = new Set(["pending", "present", "excused", "late_excused", "unexcused", "no_show"]);
const founderSelfReportStatuses = new Set(["pending", "excused", "late_excused"]);

function defaultPoints(status: MeetingAttendanceStatus, reasonAccepted: boolean, writtenUpdate: string) {
  if (status === "present") return 4;
  if (status === "excused") return Math.min(4, (reasonAccepted ? 2 : 0) + (writtenUpdate.trim() ? 2 : 0));
  if (status === "late_excused") return Math.min(3, (reasonAccepted ? 1 : 0) + (writtenUpdate.trim() ? 2 : 0));
  return 0;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const meetingId = Number(id);
  if (!Number.isFinite(meetingId)) return NextResponse.json({ error: "Ungültiges Meeting." }, { status: 400 });

  const payload = (await request.json()) as AttendancePayload;
  const isLead = permission.profile?.platformRole === "ceo" || permission.profile?.platformRole === "deputy";
  const profileId = payload.profileId || permission.profile?.id || "";
  if (!profileId) return NextResponse.json({ error: "Profil ist erforderlich." }, { status: 400 });
  if (!isLead && profileId !== permission.profile?.id) {
    return NextResponse.json({ error: "Founder können nur ihre eigene Meeting-Rückmeldung ändern." }, { status: 403 });
  }

  const status = payload.status && statuses.has(payload.status) ? payload.status : "pending";
  if (!isLead && !founderSelfReportStatuses.has(status)) {
    return NextResponse.json({ error: "Nur CEO oder Deputy können Anwesenheit final bewerten." }, { status: 403 });
  }

  const absenceReason = typeof payload.absenceReason === "string" ? payload.absenceReason.trim().slice(0, 2000) : "";
  const writtenUpdate = typeof payload.writtenUpdate === "string" ? payload.writtenUpdate.trim().slice(0, 4000) : "";
  if (!isLead && status !== "pending" && !absenceReason) {
    return NextResponse.json({ error: "Für eine Meeting-Rückmeldung ist ein konkreter Grund erforderlich." }, { status: 400 });
  }

  const reasonAccepted = isLead ? Boolean(payload.reasonAccepted) : false;
  const points = isLead && payload.points !== undefined
    ? Math.max(0, Math.min(4, Math.round(Number(payload.points))))
    : isLead ? defaultPoints(status, reasonAccepted, writtenUpdate) : 0;

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("id,title")
    .eq("id", meetingId)
    .single();
  if (meetingError || !meeting) return NextResponse.json({ error: "Meeting wurde nicht gefunden." }, { status: 404 });

  const { data: attendance, error } = await supabase
    .from("meeting_attendance")
    .upsert({
      meeting_id: meetingId,
      profile_id: profileId,
      status,
      absence_reason: absenceReason,
      reason_accepted: reasonAccepted,
      written_update: writtenUpdate,
      points,
      updated_at: new Date().toISOString(),
    }, { onConflict: "meeting_id,profile_id" })
    .select("id,meeting_id,profile_id,status,absence_reason,reason_accepted,written_update,points,created_at,updated_at")
    .single();

  if (error || !attendance) return NextResponse.json({ error: error?.message || "Meeting-Rückmeldung konnte nicht gespeichert werden." }, { status: 500 });

  if (!isLead && status !== "pending") {
    const { data: leads } = await supabase.from("profiles").select("id").in("platform_role", ["ceo", "deputy"]);
    const notifications = (leads || [])
      .filter((lead) => lead.id !== permission.profile?.id)
      .map((lead) => ({
        type: "meeting.attendance_updated",
        actor_profile_id: permission.profile?.id || null,
        recipient_profile_id: lead.id,
        entity_type: "meeting",
        entity_id: String(meetingId),
        title: `Meeting-Rückmeldung: ${meeting.title}`,
        body: `${profileId}: ${status}${absenceReason ? `\nGrund: ${absenceReason}` : ""}`,
      }));
    if (notifications.length) await supabase.from("notification_events").insert(notifications);
  }

  if (isLead && profileId !== permission.profile?.id) {
    await supabase.from("notification_events").insert({
      type: "meeting.attendance_updated",
      actor_profile_id: permission.profile?.id || null,
      recipient_profile_id: profileId,
      entity_type: "meeting",
      entity_id: String(meetingId),
      title: `Meeting bewertet: ${meeting.title}`,
      body: `${status} · ${points} Punkte${absenceReason ? `\nGrund: ${absenceReason}` : ""}`,
    });
  }

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "meeting.attendance.update",
    entity_type: "meeting",
    entity_id: String(meetingId),
    after_data: { profileId, status, absenceReason, reasonAccepted, points, mode: isLead ? "lead_review" : "founder_self_report" },
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    attendance: {
      id: attendance.id,
      meetingId: attendance.meeting_id,
      profileId: attendance.profile_id,
      status: attendance.status,
      absenceReason: attendance.absence_reason || "",
      reasonAccepted: attendance.reason_accepted,
      writtenUpdate: attendance.written_update || "",
      points: attendance.points,
      createdAt: attendance.created_at,
      updatedAt: attendance.updated_at,
    },
  });
}
