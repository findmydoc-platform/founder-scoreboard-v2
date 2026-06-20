import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import type { MeetingAttendanceStatus } from "@/lib/types";
import { apiError, requireApiContext } from "@/lib/api-response";

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
  if (status === "present") return 2;
  if (status === "excused") return Math.min(2, (reasonAccepted ? 1 : 0) + (writtenUpdate.trim() ? 1 : 0));
  if (status === "late_excused") return Math.min(2, (reasonAccepted ? 1 : 0) + (writtenUpdate.trim() ? 1 : 0));
  return 0;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requireFounder);
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;

  const { id } = await context.params;
  const meetingId = Number(id);
  if (!Number.isFinite(meetingId)) return apiError("Ungültiges Meeting.", 400);

  const payload = (await request.json()) as AttendancePayload;
  const isLead = permission.profile?.platformRole === "ceo" || permission.profile?.platformRole === "deputy";
  const profileId = payload.profileId || permission.profile?.id || "";
  if (!profileId) return apiError("Profil ist erforderlich.", 400);
  if (!isLead && profileId !== permission.profile?.id) {
    return apiError("Founder können nur ihre eigene Meeting-Rückmeldung ändern.", 403);
  }

  const status = payload.status && statuses.has(payload.status) ? payload.status : "pending";
  if (!isLead && !founderSelfReportStatuses.has(status)) {
    return apiError("Nur CEO oder Deputy können Anwesenheit final bewerten.", 403);
  }

  const absenceReason = cleanText(payload.absenceReason, 2000);
  const writtenUpdate = cleanText(payload.writtenUpdate, 4000);
  if (!isLead && status !== "pending" && !absenceReason) {
    return apiError("Für eine Meeting-Rückmeldung ist ein konkreter Grund erforderlich.", 400);
  }

  const reasonAccepted = isLead ? Boolean(payload.reasonAccepted) : false;
  const points = isLead && payload.points !== undefined
    ? Math.max(0, Math.min(2, Math.round(Number(payload.points))))
    : isLead ? defaultPoints(status, reasonAccepted, writtenUpdate) : 0;

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .select("id,title")
    .eq("id", meetingId)
    .single();
  if (meetingError || !meeting) return apiError("Meeting wurde nicht gefunden.", 404);

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

  if (error || !attendance) return apiError(error?.message || "Meeting-Rückmeldung konnte nicht gespeichert werden.", 500);

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
    ...auditRequestMetadata(request),
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
