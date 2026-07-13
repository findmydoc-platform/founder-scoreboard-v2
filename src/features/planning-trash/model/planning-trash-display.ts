import type { PlanningTrashMetadata } from "@/lib/planning-trash-detail";

export function formatTrashDateTime(value: string) {
  if (!value) return "Nicht gesetzt";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function trashCauseLabel(cause: PlanningTrashMetadata["cause"]) {
  return cause === "rejected" ? "Abgelehnt" : "Zurückgezogen";
}

export function trashRootLabel(trash: PlanningTrashMetadata) {
  const type = trash.rootType === "initiative" ? "Initiative" : "Deliverable";
  return `${type} · ${trash.rootId}`;
}

export function approvalStatusLabel(value: string | null | undefined) {
  if (value === "approved") return "Freigegeben";
  if (value === "proposed") return "Vorgeschlagen";
  if (value === "rejected") return "Abgelehnt";
  if (value === "draft") return "Entwurf";
  return "Vom Parent abgeleitet";
}
