import { NextResponse, type NextRequest } from "next/server";
import { requireTeamMember } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { canManageNotificationEvent, type NotificationUserAction } from "@/lib/notification-lifecycle";

type NotificationStatusPayload = {
  action?: NotificationUserAction;
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<NotificationStatusPayload>(request, requireTeamMember, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  const action = payload.action;
  if (!action || !["seen", "dismiss"].includes(action)) {
    return apiError("Ungültige Notification-Aktion.", 400);
  }

  const { id } = await context.params;
  const notificationId = Number(id);
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return apiError("Ungültige Notification.", 400);
  }

  const { data: event, error: readError } = await supabase
    .from("notification_events")
    .select("id,recipient_profile_id,status,seen_at,dismissed_at")
    .eq("id", notificationId)
    .single();

  if (readError || !event) return apiError("Notification wurde nicht gefunden.", 404);

  if (!canManageNotificationEvent(permission.profile, event.recipient_profile_id)) {
    return apiError("Keine Berechtigung für diese Notification.", 403);
  }

  if (event.status !== "pending") {
    return NextResponse.json({ ok: true, action, status: event.status });
  }

  const now = new Date().toISOString();
  const update = action === "seen"
    ? { seen_at: event.seen_at || now }
    : { status: "dismissed", seen_at: event.seen_at || now, dismissed_at: event.dismissed_at || now };
  const { error: updateError } = await supabase
    .from("notification_events")
    .update(update)
    .eq("id", notificationId)
    .eq("status", "pending");

  if (updateError) return apiError(updateError.message, 500);

  return NextResponse.json({ ok: true, action, status: action === "dismiss" ? "dismissed" : "pending" });
}
