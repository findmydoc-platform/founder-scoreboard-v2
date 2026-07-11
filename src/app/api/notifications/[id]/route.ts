import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type NotificationStatusPayload = {
  status?: "dismissed" | "resolved";
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<NotificationStatusPayload>(request, requireFounder, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  const status = payload.status;
  if (!status || !["dismissed", "resolved"].includes(status)) {
    return apiError("Ungültiger Notification-Status.", 400);
  }

  const { id } = await context.params;
  const notificationId = Number(id);
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return apiError("Ungültige Notification.", 400);
  }

  const { data: event, error: readError } = await supabase
    .from("notification_events")
    .select("id,recipient_profile_id,status")
    .eq("id", notificationId)
    .single();

  if (readError || !event) return apiError("Notification wurde nicht gefunden.", 404);

  const canDismiss = !permission.profile
    || permission.profile.platformRole === "ceo"
    || permission.profile.platformRole === "deputy"
    || event.recipient_profile_id === permission.profile.id;

  if (!canDismiss) {
    return apiError("Keine Berechtigung für diese Notification.", 403);
  }

  const { error: updateError } = await supabase
    .from("notification_events")
    .update({ status })
    .eq("id", notificationId);

  if (updateError) return apiError(updateError.message, 500);

  return NextResponse.json({ ok: true, status });
}
