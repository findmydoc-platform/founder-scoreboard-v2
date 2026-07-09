export const googleChatDigestEventTypes = [
  "task.blocker_reported",
  "task.mention",
  "task.proposed",
  "task.review_requested",
  "task.review_rework",
  "task.review_completed",
  "task.deadline_overdue",
  "sprint.task_carried_over",
  "sprint.review_due",
  "event.upcoming",
  "meeting.attendance_updated",
] as const;

export const googleChatDirectDmEventTypes = [
  "task.blocker_reported",
  "task.mention",
  "task.review_requested",
  "task.review_rework",
  "task.deadline_overdue",
  "event.upcoming",
] as const;

export type GoogleChatDigestEventType = (typeof googleChatDigestEventTypes)[number];
export type GoogleChatDirectDmEventType = (typeof googleChatDirectDmEventTypes)[number];

export function notificationEventLabel(eventType: string) {
  if (eventType === "task.blocker_reported") return "Blocker gemeldet";
  if (eventType === "task.mention") return "Erwähnung";
  if (eventType === "task.proposed") return "Aufgabe vorgeschlagen";
  if (eventType === "task.review_requested") return "Review angefragt";
  if (eventType === "task.review_rework") return "Nacharbeit erforderlich";
  if (eventType === "task.review_completed") return "Review abgeschlossen";
  if (eventType === "task.deadline_overdue") return "Überfällig";
  if (eventType === "sprint.task_carried_over") return "Carry-over";
  if (eventType === "sprint.review_due") return "Sprint-Review fällig";
  if (eventType === "event.upcoming") return "Event-Erinnerung";
  if (eventType === "meeting.attendance_updated") return "Weekly-Rückmeldung";
  return eventType;
}

export function shouldSendToGoogleChatDigest(eventType: string) {
  return googleChatDigestEventTypes.includes(eventType as (typeof googleChatDigestEventTypes)[number]);
}

export function shouldSendToGoogleChatDm(eventType: string) {
  return googleChatDirectDmEventTypes.includes(eventType as (typeof googleChatDirectDmEventTypes)[number]);
}

export function notificationChannelLabel(eventType: string) {
  return shouldSendToGoogleChatDigest(eventType) ? "Sammelmeldung" : "Nur in der App";
}
