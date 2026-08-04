import type { Task } from "@/lib/types";

export type PlanningLevel = Extract<Task["taskType"], "epic" | "initiative" | "deliverable">;

export const planningLevels: Array<{ value: PlanningLevel; label: string }> = [
  { value: "epic", label: "Epics" },
  { value: "initiative", label: "Initiativen" },
  { value: "deliverable", label: "Deliverables" },
];

export function planningLevelLabel(level: PlanningLevel) {
  if (level === "epic") return "Epic";
  if (level === "initiative") return "Initiative";
  return "Deliverable";
}

export function planningLevelCreateLabel(level: PlanningLevel) {
  if (level === "initiative") return "Neue Initiative";
  return `Neues ${planningLevelLabel(level)}`;
}
