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
  "decision.confirmation_requested",
  "event.upcoming",
  "meeting.attendance_updated",
  "feedback.bug_reported",
  "feedback.feature_requested",
] as const;

export const googleChatDirectDmEventTypes = [
  "task.blocker_reported",
  "task.mention",
  "task.review_requested",
  "task.review_rework",
  "task.deadline_overdue",
  "decision.confirmation_requested",
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
  if (eventType === "decision.confirmation_requested") return "Decision-Bestätigung";
  if (eventType === "event.upcoming") return "Event-Erinnerung";
  if (eventType === "meeting.attendance_updated") return "Meeting-Rückmeldung";
  if (eventType === "feedback.bug_reported") return "Bug gemeldet";
  if (eventType === "feedback.feature_requested") return "Feature-Wunsch";
  return eventType;
}

export function shouldSendToGoogleChatDigest(eventType: string) {
  return googleChatDigestEventTypes.includes(eventType as (typeof googleChatDigestEventTypes)[number]);
}

export function shouldSendToGoogleChatDm(eventType: string) {
  return googleChatDirectDmEventTypes.includes(eventType as (typeof googleChatDirectDmEventTypes)[number]);
}

export function notificationChannelLabel(eventType: string) {
  return shouldSendToGoogleChatDigest(eventType) ? "Google-Chat-Digest" : "Nur In-App";
}
