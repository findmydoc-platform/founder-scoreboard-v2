import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";
import { mapMeetingAttendance } from "@/lib/planning-meeting-mappers";
import type { MeetingAttendanceStatus } from "@/lib/types";
import { apiError } from "@/lib/api-response";
import { createNotificationPayload } from "@/lib/notification-catalog";

type AttendancePayload = {
  expectedUpdatedAt?: string | null;
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

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningContext(request, "planning.attendance.write", id);
  if (!apiContext.ok) return apiContext.response;
  const { planning, permission } = apiContext;
  const profileId = request.nextUrl.searchParams.get("profileId") || permission.profile?.id || "";
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !profileId) return apiError("Ungültiges Meeting oder Profil.", 400);
  const isLead = permission.profile?.platformRole === "ceo" || permission.profile?.platformRole === "deputy";
  if (!isLead && profileId !== permission.profile?.id) return apiError("Founder können nur ihre eigene Weekly-Rückmeldung prüfen.", 403);
  const meeting = await planning.readAttendanceMeeting();
  if (meeting.error || !meeting.data) return apiError("Meeting wurde nicht gefunden.", 404);
  const result = await planning.readAttendance(profileId);
  if (result.error) return apiError("Weekly-Rückmeldung konnte nicht geladen werden.", result.error.code === "42501" ? 403 : 503);
  return NextResponse.json({ attendance: result.data ? mapMeetingAttendance(result.data) : null });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningContext(request, "planning.attendance.write", id);
  if (!apiContext.ok) return apiContext.response;

  const { permission, planning } = apiContext;

  const meetingId = Number(id);
  if (!Number.isFinite(meetingId)) return apiError("Ungültiges Meeting.", 400);

  const payload = (await request.json()) as AttendancePayload;
  const isLead = permission.profile?.platformRole === "ceo" || permission.profile?.platformRole === "deputy";
  const profileId = payload.profileId || permission.profile?.id || "";
  if (!profileId) return apiError("Profil ist erforderlich.", 400);
  if (!isLead && profileId !== permission.profile?.id) {
    return apiError("Founder können nur ihre eigene Weekly-Rückmeldung ändern.", 403);
  }

  const status = payload.status && statuses.has(payload.status) ? payload.status : "pending";
  if (!isLead && !founderSelfReportStatuses.has(status)) {
    return apiError("Nur CEO oder Deputy können Anwesenheit final bewerten.", 403);
  }

  const absenceReason = cleanText(payload.absenceReason, 2000);
  const writtenUpdate = cleanText(payload.writtenUpdate, 4000);
  if (!isLead && status !== "pending" && !absenceReason) {
    return apiError("Für eine Weekly-Rückmeldung ist ein konkreter Grund erforderlich.", 400);
  }

  const reasonAccepted = isLead ? Boolean(payload.reasonAccepted) : false;
  const points = isLead && payload.points !== undefined
    ? Math.max(0, Math.min(2, Math.round(Number(payload.points))))
    : isLead ? defaultPoints(status, reasonAccepted, writtenUpdate) : 0;

  if (payload.expectedUpdatedAt !== null && (typeof payload.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(payload.expectedUpdatedAt)))) return apiError("Lade die Weekly-Rückmeldung neu, bevor du speicherst.", 400);

  const { data: meeting, error: meetingError } = await planning.readAttendanceMeeting();
  if (meetingError || !meeting) return apiError("Meeting wurde nicht gefunden.", 404);

  const { data: attendance, error } = await planning.writeAttendance({ profileId, status, absenceReason, reasonAccepted, writtenUpdate, points, expectedUpdatedAt: payload.expectedUpdatedAt });

  if (error || !attendance) return NextResponse.json({ error: error?.message || "Weekly-Rückmeldung konnte nicht gespeichert werden.", ...(error?.code ? { code: error.code } : {}) }, { status: error?.code === "attendance_revision_conflict" ? 409 : error?.code === "42501" ? 403 : 500 });
  let effects: "confirmed" | "unconfirmed" = "confirmed";
  try {

  if (!isLead && status !== "pending") {
    const { data: leads } = await planning.readAttendanceLeads();
    if (!leads) effects = "unconfirmed";
    const notifications = (leads || [])
      .filter((lead) => lead.id !== permission.profile?.id)
      .map((lead) => createNotificationPayload("meeting.attendance_updated", {
        actorProfileId: permission.profile?.id,
        recipientProfileId: lead.id,
        entityType: "meeting",
        entityId: String(meetingId),
        title: `Weekly-Rückmeldung: ${meeting.title}`,
        body: `${profileId}: ${status}${absenceReason ? `\nGrund: ${absenceReason}` : ""}`,
      }));
    if (notifications.length && (await planning.notifyAttendance(notifications)).error) effects = "unconfirmed";
  }

  if (isLead && profileId !== permission.profile?.id) {
    const notification = await planning.notifyAttendance([createNotificationPayload("meeting.attendance_updated", {
      actorProfileId: permission.profile?.id,
      recipientProfileId: profileId,
      entityType: "meeting",
      entityId: String(meetingId),
      title: `Weekly bewertet: ${meeting.title}`,
      body: `${status} · ${points} Punkte${absenceReason ? `\nGrund: ${absenceReason}` : ""}`,
    })]);
    if (notification.error) effects = "unconfirmed";
  }

  const audit = await planning.auditAttendance({ profileId, status, absenceReason, reasonAccepted, points, mode: isLead ? "lead_review" : "founder_self_report" }, auditRequestMetadata(request));

  if (audit.error) effects = "unconfirmed";
  } catch { effects = "unconfirmed"; }
  return NextResponse.json({ ok: true, attendance: mapMeetingAttendance(attendance), effects,
    ...(effects === "unconfirmed" ? { code: "attendance_saved_effects_unconfirmed", warning: "Rückmeldung gespeichert. Ob Benachrichtigung und Protokoll erstellt wurden, ist noch unklar." } : {}) });
}
