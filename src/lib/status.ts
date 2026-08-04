import type { UiTone } from "@/shared/atoms/ui-primitives";
import type { TaskStatus } from "./types";

export const taskStatuses: TaskStatus[] = ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"];
export const SUB_ISSUE_STATUSES = ["Offen", "In Arbeit", "Blockiert", "Erledigt"] as const satisfies readonly TaskStatus[];

export function normalizeStatus(status: string): TaskStatus {
  const lower = status.toLowerCase();
  if (lower.includes("vorschlag") || lower.includes("draft") || lower.includes("idee")) return "Offen";
  if (lower.includes("nacharbeit") || lower.includes("rework") || lower.includes("changes_requested")) return "Nacharbeit";
  if (lower.includes("erledigt") || lower.includes("done") || lower.includes("beendet")) return "Erledigt";
  if (lower.includes("review")) return "Review";
  if (lower.includes("paus")) return "Pausiert";
  if (lower.includes("block")) return "Blockiert";
  if (lower.includes("arbeit") || lower.includes("aktiv") || lower.includes("progress")) return "In Arbeit";
  return "Offen";
}

export function normalizeSubIssueStatus(status: string): TaskStatus {
  const normalized = normalizeStatus(status);
  return normalized === "Review" || normalized === "Nacharbeit" || normalized === "Pausiert" ? "In Arbeit" : normalized;
}

export function isSubIssueStatus(status: string): status is (typeof SUB_ISSUE_STATUSES)[number] {
  return SUB_ISSUE_STATUSES.includes(status as (typeof SUB_ISSUE_STATUSES)[number]);
}

export function isTaskStatusChange(currentStatus: string, nextStatus: string) {
  return normalizeStatus(currentStatus) !== normalizeStatus(nextStatus);
}

export function statusBadgeTone(status: string): UiTone {
  switch (normalizeStatus(status)) {
    case "Erledigt":
      return "emerald";
    case "In Arbeit":
      return "blue";
    case "Pausiert":
      return "amber";
    case "Review":
      return "violet";
    case "Nacharbeit":
      return "orange";
    case "Blockiert":
      return "rose";
    default:
      return "slate";
  }
}

export function priorityBadgeTone(priority: string): UiTone {
  switch (priority) {
    case "P0":
      return "rose";
    case "P1":
      return "amber";
    case "P2":
      return "sky";
    default:
      return "slate";
  }
}
