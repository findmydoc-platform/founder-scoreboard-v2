import { isOperationalLeadRole } from "./platform";
import type { NotificationEvent, PlatformRole } from "./types";

export type NotificationUserAction = "seen" | "dismiss";

export function canManageNotificationEvent(
  profile: { id: string; platformRole: PlatformRole } | null,
  recipientProfileId: string | null | undefined,
) {
  if (!profile) return false;
  if (recipientProfileId) return recipientProfileId === profile.id;
  return isOperationalLeadRole(profile.platformRole);
}

export function applyLocalNotificationAction(event: NotificationEvent, action: NotificationUserAction, now = new Date()) {
  const timestamp = now.toISOString();
  if (action === "seen") {
    if (event.status !== "pending" || event.seenAt) return event;
    return { ...event, seenAt: timestamp };
  }
  if (event.status !== "pending") return event;
  return {
    ...event,
    status: "dismissed" as const,
    seenAt: event.seenAt || timestamp,
    dismissedAt: timestamp,
  };
}

export function notificationLifecycleLabel(event: NotificationEvent) {
  if (event.status === "dismissed") return "vom Benutzer geschlossen";
  if (event.status === "resolved") return "automatisch erledigt";
  if (event.status === "pending" && event.seenAt) return "gesehen · offen";
  if (event.status === "pending") return "neu · offen";
  if (event.status === "sent") return "gesendet";
  return "fehlgeschlagen";
}
