import type { TaskActivity } from "@/lib/types";

export function repairGermanText(value: string) {
  return value
    .replace(new RegExp("\u00c3\u00a4", "g"), "ä")
    .replace(new RegExp("\u00c3\u00b6", "g"), "ö")
    .replace(new RegExp("\u00c3\u00bc", "g"), "ü")
    .replace(new RegExp("\u00c3\u0084", "g"), "Ä")
    .replace(new RegExp("\u00c3\u0096", "g"), "Ö")
    .replace(new RegExp("\u00c3\u009c", "g"), "Ü")
    .replace(new RegExp("\u00c3\u009f", "g"), "ß")
    .replace(new RegExp("\u00c2\u00b7", "g"), "·");
}

export function taskAuditActionFromMessage(message: string) {
  const normalized = repairGermanText(message).trim();
  if (normalized.startsWith("Titel geändert:")) return "task.title_changed";
  if (normalized.startsWith("Status geändert:")) return "task.status_changed";
  if (normalized.startsWith("Review geändert:")) return "task.review_status_changed";
  if (normalized.startsWith("Review Owner geändert:")) return "task.review_owner_changed";
  if (normalized.startsWith("Zuständigkeit geändert:") || normalized.startsWith("Assignee geändert:") || normalized.startsWith("Owner geändert:")) return "task.assignment_changed";
  if (normalized.startsWith("Priorität geändert:")) return "task.priority_changed";
  if (normalized.startsWith("Sprint-Zuordnung geändert:")) return "task.sprint_changed";
  if (normalized.startsWith("Epic / Meilenstein geändert:") || normalized.startsWith("Initiative geändert:")) return "task.structure_changed";
  if (normalized.startsWith("Zeitraum geändert:")) return "task.schedule_changed";
  if (normalized.startsWith("Evidence-Link geändert")) return "task.evidence_changed";
  if (normalized.startsWith("Anhang hochgeladen:")) return "task.attachment_uploaded";
  if (normalized.startsWith("GitHub-Sync fehlgeschlagen:")) return "task.github_sync_failed";
  if (normalized.startsWith("GitHub-Sync ausgeführt:")) return "task.github_sync_succeeded";
  return "";
}

export function isUsefulActivity(activity: Pick<TaskActivity, "action">) {
  return Boolean(activity.action)
    && activity.action !== "task.comment"
    && activity.action !== "task.github_comments_imported"
    && !activity.action.startsWith("task.focus_");
}
