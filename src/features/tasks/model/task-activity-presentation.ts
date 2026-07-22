import type { TaskActivity } from "@/lib/types";

export type TaskActivityIconKey =
  | "approval"
  | "assignment"
  | "attachment"
  | "blocker"
  | "create"
  | "delete"
  | "github"
  | "github-error"
  | "history"
  | "priority"
  | "relationship-add"
  | "relationship-remove"
  | "restore"
  | "review"
  | "review-rework"
  | "schedule"
  | "status"
  | "structure"
  | "update";

export type TaskActivityTone = "amber" | "blue" | "emerald" | "red" | "slate" | "violet";

export type TaskActivityPresentation = {
  title: string;
  detail: string;
  icon: TaskActivityIconKey;
  tone: TaskActivityTone;
};

type PresentationContext = {
  labelsById?: ReadonlyMap<string, string>;
};

const reviewStatusLabels: Record<string, string> = {
  not_requested: "Nicht angefragt",
  requested: "Angefragt",
  accepted: "Angenommen",
  partial: "Teilweise angenommen",
  changes_requested: "Änderungen angefragt",
};

function messageDetail(message: string) {
  const separator = message.indexOf(":");
  return separator >= 0 ? message.slice(separator + 1).trim() : "";
}

function replaceKnownValues(value: string, labelsById?: ReadonlyMap<string, string>) {
  let result = value;
  for (const [technicalValue, label] of Object.entries(reviewStatusLabels)) {
    result = result.replaceAll(technicalValue, label);
  }
  if (labelsById) {
    for (const [id, label] of labelsById) {
      if (id) result = result.replaceAll(id, label);
    }
  }
  return result.replaceAll("leer", "Nicht gesetzt");
}

function relationshipDetail(activity: TaskActivity, labelsById?: ReadonlyMap<string, string>) {
  const data = activity.afterData || activity.beforeData || {};
  const relatedTaskId = typeof data.relatedTaskId === "string"
    ? data.relatedTaskId
    : typeof data.related_task_id === "string"
      ? data.related_task_id
      : "";
  const relationType = typeof data.relationType === "string"
    ? data.relationType
    : typeof data.relation_type === "string"
      ? data.relation_type
      : "";
  const relationLabel = relationType === "blocked_by"
    ? "Wartet auf"
    : relationType === "blocks"
      ? "Blockiert"
      : relationType === "relates_to"
        ? "Verknüpft mit"
        : "";
  const targetLabel = relatedTaskId ? labelsById?.get(relatedTaskId) || "Verknüpfte Aufgabe" : "";
  return [relationLabel, targetLabel].filter(Boolean).join(": ");
}

function githubDetail(activity: TaskActivity) {
  const issueNumber = activity.message.match(/#(\d+)/)?.[1];
  if (issueNumber) return `Issue #${issueNumber}`;
  if (activity.action === "task.github_sync_failed") return "Bitte erneut versuchen oder die GitHub-Verbindung prüfen.";
  return "";
}

function attachmentDetail(activity: TaskActivity) {
  const filename = activity.afterData?.filename;
  return typeof filename === "string" ? filename : messageDetail(activity.message);
}

function approvalDetail(activity: TaskActivity) {
  const note = activity.afterData?.note;
  return typeof note === "string" ? note : "";
}

const exactPresentations: Record<string, Omit<TaskActivityPresentation, "detail">> = {
  "task.status_changed": { title: "Status geändert", icon: "status", tone: "blue" },
  "task.priority_changed": { title: "Priorität geändert", icon: "priority", tone: "amber" },
  "task.sprint_changed": { title: "Sprint geändert", icon: "schedule", tone: "blue" },
  "task.schedule_changed": { title: "Zeitraum geändert", icon: "schedule", tone: "blue" },
  "task.assignment_changed": { title: "Zuständigkeit geändert", icon: "assignment", tone: "blue" },
  "task.review_owner_changed": { title: "Verantwortlich für die Prüfung geändert", icon: "assignment", tone: "blue" },
  "task.structure_changed": { title: "Einordnung geändert", icon: "structure", tone: "slate" },
  "task.parent_changed": { title: "Übergeordnete Aufgabe geändert", icon: "structure", tone: "slate" },
  "task.title_changed": { title: "Titel geändert", icon: "update", tone: "slate" },
  "task.evidence_changed": { title: "Nachweis-Link geändert", icon: "update", tone: "slate" },
  "task.attachment_uploaded": { title: "Anhang hochgeladen", icon: "attachment", tone: "slate" },
  "task.blocker_reported": { title: "Blocker gemeldet", icon: "blocker", tone: "red" },
  "task.relationship_created": { title: "Abhängigkeit hinzugefügt", icon: "relationship-add", tone: "slate" },
  "task.relationship_deleted": { title: "Abhängigkeit entfernt", icon: "relationship-remove", tone: "slate" },
  "task.github_sync_succeeded": { title: "GitHub aktualisiert", icon: "github", tone: "violet" },
  "task.github_sync_failed": { title: "GitHub konnte nicht aktualisiert werden", icon: "github-error", tone: "red" },
  "task.review.reopen": { title: "Prüfung wieder geöffnet", icon: "review", tone: "emerald" },
  "task.review_status_changed": { title: "Prüfstatus geändert", icon: "review", tone: "emerald" },
  "task.review": { title: "Prüfung abgeschlossen", icon: "review", tone: "emerald" },
  "task.approval_approve": { title: "Aufgabe freigegeben", icon: "approval", tone: "emerald" },
  "task.approval_reject": { title: "Aufgabe abgelehnt", icon: "delete", tone: "red" },
  "task.approval_return_to_draft": { title: "Zur Überarbeitung zurückgegeben", icon: "review-rework", tone: "amber" },
  "task.approval_reset": { title: "Freigabe erneut erforderlich", icon: "review-rework", tone: "amber" },
  "task.approval_revised": { title: "Freigabe erneut angefragt", icon: "review", tone: "blue" },
  "task.approval_resubmitted": { title: "Erneut zur Freigabe eingereicht", icon: "review", tone: "blue" },
  "task.create": { title: "Aufgabe erstellt", icon: "create", tone: "emerald" },
  "task_intake.create": { title: "Aufgabe erfasst", icon: "create", tone: "emerald" },
  "task.delete": { title: "Aufgabe gelöscht", icon: "delete", tone: "red" },
  "task.withdrawn": { title: "Aufgabe zurückgezogen", icon: "delete", tone: "red" },
  "task.restored": { title: "Aufgabe wiederhergestellt", icon: "restore", tone: "emerald" },
};

function fallbackPresentation(action: string): Omit<TaskActivityPresentation, "detail"> {
  if (action.startsWith("task.approval_")) return { title: "Freigabe geändert", icon: "approval", tone: "emerald" };
  if (action.startsWith("task.review")) return { title: "Prüfung geändert", icon: "review", tone: "emerald" };
  if (action.startsWith("task.github_")) return { title: "GitHub aktualisiert", icon: "github", tone: "violet" };
  if (action.startsWith("task.relationship_")) return { title: "Abhängigkeit geändert", icon: "relationship-add", tone: "slate" };
  if (action.startsWith("task.")) return { title: "Aufgabe aktualisiert", icon: "update", tone: "slate" };
  return { title: "Änderung protokolliert", icon: "history", tone: "slate" };
}

export function describeTaskActivity(activity: TaskActivity, context: PresentationContext = {}): TaskActivityPresentation {
  const base = exactPresentations[activity.action] || fallbackPresentation(activity.action);
  let detail = replaceKnownValues(messageDetail(activity.message), context.labelsById);

  if (activity.action.startsWith("task.relationship_")) detail = relationshipDetail(activity, context.labelsById);
  if (activity.action.startsWith("task.github_")) detail = githubDetail(activity);
  if (activity.action === "task.attachment_uploaded") detail = attachmentDetail(activity);
  if (activity.action.startsWith("task.approval_")) detail = approvalDetail(activity) || detail;
  if (activity.action === "task.blocker_reported") detail = "";

  return { ...base, detail };
}
