import type { UiTone } from "@/shared/atoms/ui-primitives";

export function notificationTypeLabel(type: string) {
  if (type === "task.review_requested") return "Review";
  if (type === "task.review_rework") return "Nacharbeit";
  if (type === "task.review_completed") return "Review erledigt";
  if (type === "task.blocker_reported") return "Blocker";
  if (type === "task.comment") return "Kommentar";
  if (type === "task.proposed") return "Vorschlag";
  if (type === "sprint.task_carried_over") return "Carry-over";
  if (type === "meeting.attendance_updated") return "Weekly";
  return "Hinweis";
}

export function notificationBadgeTone(type: string): UiTone {
  if (type === "task.blocker_reported") return "red";
  if (type === "task.review_rework") return "amber";
  if (type === "task.review_requested") return "blue";
  if (type === "task.review_completed") return "emerald";
  return "slate";
}
