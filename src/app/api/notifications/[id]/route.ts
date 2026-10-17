import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError, readJsonPayload } from "@/lib/api-response";
import { canManageNotificationEvent, type NotificationUserAction } from "@/lib/notification-lifecycle";

type NotificationStatusPayload = {
  action?: NotificationUserAction;
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "notification.status.write", targetId: id });
  if (!permission.ok) return authzError(permission);
  const payload = await readJsonPayload<NotificationStatusPayload>(request, {});
  const action = payload.action;
  if (!action || !["seen", "dismiss"].includes(action)) {
    return apiError("Ungültige Notification-Aktion.", 400);
  }

  const notificationId = Number(id);
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return apiError("Ungültige Notification.", 400);
  }

  const { data: event, error: readError } = await permission.resource.readNotification();

  if (readError || !event) return apiError("Notification wurde nicht gefunden.", 404);

  if (!canManageNotificationEvent(permission.profile, event.recipient_profile_id)) {
    return apiError("Keine Berechtigung für diese Notification.", 403);
  }

  if (event.status !== "pending") {
    return NextResponse.json({ ok: true, action, status: event.status });
  }

  const { error: updateError } = await permission.resource.saveNotificationStatus(action);
  if (updateError) return apiError(updateError.message, 500);

  return NextResponse.json({ ok: true, action, status: action === "dismiss" ? "dismissed" : "pending" });
}
