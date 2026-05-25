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

export function statusTone(status: string) {
  switch (normalizeStatus(status)) {
    case "Erledigt":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "In Arbeit":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "Review":
      return "border-violet-200 bg-violet-50 text-violet-700";
    case "Nacharbeit":
      return "border-orange-200 bg-orange-50 text-orange-700";
    case "Blockiert":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "Vorschlag":
      return "border-slate-300 bg-white text-slate-600";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

export function priorityTone(priority: string) {
  switch (priority) {
    case "P0":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "P1":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "P2":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-600";
  }
}
