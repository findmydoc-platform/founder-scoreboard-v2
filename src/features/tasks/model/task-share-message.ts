import type { Task } from "@/lib/types";

export const googleChatUrl = "https://chat.google.com";

export function taskShareTypeLabel(taskType: Task["taskType"]) {
  return taskType === "sub_issue" ? "Sub-Issue" : "Deliverable";
}

function taskShareDeadlineLabel(value: string) {
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function buildTaskShareUrl(taskId: string, origin: string) {
  return new URL(`/tasks/${encodeURIComponent(taskId)}`, origin).toString();
}

export function taskShareRequestLabel(task: Pick<Task, "approvalStatus" | "reviewStatus" | "status" | "taskType">) {
  if (task.reviewStatus === "requested" || task.status === "Review") {
    return "Bitte prüfen und den Review freigeben.";
  }
  if (task.taskType === "deliverable" && (task.approvalStatus === "proposed" || !task.approvalStatus)) {
    return "Bitte den Vorschlag prüfen und bei Zustimmung freigeben, damit er eingeplant werden kann.";
  }
  return "Bitte ansehen und bei Bedarf kurz Rückmeldung geben.";
}

export function buildTaskShareMessage(task: Pick<Task, "approvalStatus" | "deadline" | "priority" | "reviewStatus" | "status" | "taskType" | "title">, taskUrl: string) {
  const metadata = [
    taskShareTypeLabel(task.taskType),
    task.status,
    task.priority,
    task.deadline ? `Ziel: ${taskShareDeadlineLabel(task.deadline)}` : "",
  ].filter(Boolean).join(" · ");

  return [
    task.title,
    metadata,
    "",
    taskShareRequestLabel(task),
    taskUrl,
  ].join("\n");
}
