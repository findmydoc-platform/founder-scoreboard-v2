import type { PlanningFilterPreferences } from "@/lib/types";
import { normalizePlanningBoardQuery } from "./planning-board-query";

export type PlanningGanttQuery = Readonly<{
  view: "gantt";
  filters: PlanningFilterPreferences;
}>;

export function normalizePlanningGanttQuery(input: unknown): PlanningGanttQuery | null {
  if (!input || typeof input !== "object" || Array.isArray(input) || !("view" in input) || input.view !== "gantt"
    || Object.keys(input).some(key => key !== "view" && key !== "filters")) return null;
  const candidate = "filters" in input ? input.filters : undefined;
  if (candidate !== undefined && (!candidate || typeof candidate !== "object" || Array.isArray(candidate))) return null;
  const normalized = normalizePlanningBoardQuery({ view: "table", filters: { ...candidate } });
  return { view: "gantt", filters: { ...normalized.filters, sort: "priority", direction: "asc" } };
}

export function planningGanttQueryKey(query: PlanningGanttQuery) {
  return JSON.stringify(normalizePlanningGanttQuery(query));
}
