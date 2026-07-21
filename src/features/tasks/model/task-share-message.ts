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

export function buildTaskShareMessage(task: Pick<Task, "deadline" | "priority" | "status" | "taskType" | "title">, taskUrl: string) {
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
    "Bitte prüfen und kurz Rückmeldung geben:",
    taskUrl,
  ].join("\n");
}
