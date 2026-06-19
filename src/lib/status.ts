import type { UiTone } from "@/shared/atoms/ui-primitives";
import type { TaskStatus } from "./types";

export const taskStatuses: TaskStatus[] = ["Vorschlag", "Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"];

export function normalizeStatus(status: string): TaskStatus {
  const lower = status.toLowerCase();
  if (lower.includes("vorschlag") || lower.includes("draft") || lower.includes("idee")) return "Vorschlag";
  if (lower.includes("nacharbeit") || lower.includes("rework") || lower.includes("changes_requested")) return "Nacharbeit";
  if (lower.includes("erledigt") || lower.includes("done") || lower.includes("beendet")) return "Erledigt";
  if (lower.includes("review")) return "Review";
  if (lower.includes("block")) return "Blockiert";
  if (lower.includes("arbeit") || lower.includes("aktiv") || lower.includes("progress")) return "In Arbeit";
  return "Offen";
}

export function statusBadgeTone(status: string): UiTone {
  switch (normalizeStatus(status)) {
    case "Erledigt":
      return "emerald";
    case "In Arbeit":
      return "blue";
    case "Review":
      return "violet";
    case "Nacharbeit":
      return "orange";
    case "Blockiert":
      return "rose";
    case "Vorschlag":
      return "white";
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
