export const notificationCatalog = {
  "planning_item.returned": { lifecycle: "actionable", label: "Überarbeitung", eventLabel: "Zur Überarbeitung zurückgegeben", tone: "amber", digest: true, directDm: true },
  "task.blocker_reported": { lifecycle: "actionable", label: "Blocker", eventLabel: "Blocker gemeldet", tone: "red", digest: true, directDm: true },
  "task.comment": { lifecycle: "informational", label: "Kommentar", eventLabel: "Kommentar", tone: "slate", digest: false, directDm: false },
  "task.mention": { lifecycle: "informational", label: "Erwähnung", eventLabel: "Erwähnung", tone: "blue", digest: true, directDm: true },
  "task.proposed": { lifecycle: "actionable", label: "Vorschlag", eventLabel: "Aufgabe vorgeschlagen", tone: "amber", digest: true, directDm: false },
  "task.review_requested": { lifecycle: "actionable", label: "Review", eventLabel: "Review angefragt", tone: "blue", digest: true, directDm: true },
  "task.review_reopened": { lifecycle: "informational", label: "Review wieder offen", eventLabel: "Review wieder geöffnet", tone: "blue", digest: true, directDm: false },
  "task.review_rework": { lifecycle: "actionable", label: "Nacharbeit", eventLabel: "Nacharbeit erforderlich", tone: "amber", digest: true, directDm: true },
  "task.review_completed": { lifecycle: "informational", label: "Review erledigt", eventLabel: "Review abgeschlossen", tone: "emerald", digest: true, directDm: false },
  "task.deadline_overdue": { lifecycle: "actionable", label: "Überfällig", eventLabel: "Überfällig", tone: "red", digest: true, directDm: true },
  "sprint.task_carried_over": { lifecycle: "informational", label: "Carry-over", eventLabel: "Carry-over", tone: "slate", digest: true, directDm: false },
  "sprint.review_due": { lifecycle: "actionable", label: "Sprint-Review", eventLabel: "Sprint-Review fällig", tone: "amber", digest: true, directDm: false },
  "event.upcoming": { lifecycle: "actionable", label: "Event", eventLabel: "Event-Erinnerung", tone: "blue", digest: true, directDm: true },
  "meeting.attendance_updated": { lifecycle: "informational", label: "Weekly", eventLabel: "Weekly-Rückmeldung", tone: "slate", digest: true, directDm: false },
} as const;

export type NotificationType = keyof typeof notificationCatalog;
export type NotificationLifecycleClass = (typeof notificationCatalog)[NotificationType]["lifecycle"];
export type NotificationBadgeTone = (typeof notificationCatalog)[NotificationType]["tone"] | "slate";

export type NotificationPayloadInput = {
  actorProfileId?: string | null;
  recipientProfileId?: string | null;
  entityType: string;
  entityId: string;
  title: string;
  body?: string;
  dedupeKey?: string | null;
};

export function isKnownNotificationType(type: string): type is NotificationType {
  return Object.prototype.hasOwnProperty.call(notificationCatalog, type);
}

export function notificationDefinition(type: string) {
  return isKnownNotificationType(type) ? notificationCatalog[type] : null;
}

export function createNotificationPayload(type: NotificationType, input: NotificationPayloadInput) {
  return {
    type,
    actor_profile_id: input.actorProfileId || null,
    recipient_profile_id: input.recipientProfileId || null,
    entity_type: input.entityType,
    entity_id: input.entityId,
    title: input.title,
    body: input.body || "",
    ...(input.dedupeKey ? { dedupe_key: input.dedupeKey } : {}),
  };
}

export const googleChatDigestEventTypes = Object.entries(notificationCatalog)
  .filter(([, definition]) => definition.digest)
  .map(([type]) => type) as NotificationType[];

export const googleChatDirectDmEventTypes = Object.entries(notificationCatalog)
  .filter(([, definition]) => definition.directDm)
  .map(([type]) => type) as NotificationType[];

export function notificationEventLabel(type: string) {
  return notificationDefinition(type)?.eventLabel || type;
}

export function notificationTypeLabel(type: string) {
  return notificationDefinition(type)?.label || "Hinweis";
}

export function notificationBadgeTone(type: string): NotificationBadgeTone {
  return notificationDefinition(type)?.tone || "slate";
}

export function shouldSendToGoogleChatDigest(type: string) {
  return Boolean(notificationDefinition(type)?.digest);
}

export function shouldSendToGoogleChatDm(type: string) {
  return Boolean(notificationDefinition(type)?.directDm);
}

export function notificationChannelLabel(type: string) {
  return shouldSendToGoogleChatDigest(type) ? "Sammelmeldung" : "Nur in der App";
}
