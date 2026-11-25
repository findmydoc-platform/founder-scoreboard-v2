import type { PlanningGanttQuery } from "./planning-gantt-query";

export type PlanningGanttResult = Readonly<{
  query: PlanningGanttQuery;
  queryKey: string;
  itemIds: readonly string[];
  contextIds: readonly string[];
  total: number;
  toolbarCounts: Readonly<{ filtered: number; unfiltered: number }>;
  coverage: Readonly<Record<"items" | "hierarchy" | "schedule" | "relationships", "complete">>;
  sourceRevision: string;
  observedAt: string;
  temporalKey: string;
  validUntil: string | null;
}>;
