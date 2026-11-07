import type { PlanningFilterPreferences, TaskStatus } from "@/lib/types";
import type { PlanningLevel } from "./planning-level";

export const DEFAULT_PLANNING_FILTERS: PlanningFilterPreferences = {
  query: "", assignee: "Alle", status: "Alle", priority: "Alle", review: "Alle", initiativeId: "Alle", quick: [],
  sprintId: "Alle", workstream: "Alle", risk: "Alle", targetFrom: "", targetTo: "", sort: "priority", direction: "asc",
};
export type PlanningBoardQuery = Readonly<{
  view: "board" | "complete";
  level: PlanningLevel;
  parentId: string;
  filters: PlanningFilterPreferences;
  ordering: "priority-order-id-and-completed-updated-desc-order-id";
}>;
export type PlanningBoardQueryInput = Partial<Omit<PlanningBoardQuery, "filters" | "ordering">> & {
  filters?: Partial<PlanningFilterPreferences>;
  limit?: number;
  continuation?: string;
  column?: TaskStatus;
};
export type PlanningBoardColumn = Readonly<{ total: number; loaded: number; completeness: "complete" | "partial"; continuation: string | null }>;
export type PlanningBoardResult = Readonly<{
  query: PlanningBoardQuery;
  column?: TaskStatus;
  queryKey: string;
  revision: string;
  observedAt: string;
  cardIds: readonly string[];
  levelTotals?: Record<PlanningLevel, number>;
  childProgressById: Record<string, { completed: number; total: number; unfinished: number; percentage: number }>;
  columns: Record<TaskStatus, PlanningBoardColumn>;
  metrics: { total: number; open: number; blocked: number; done: number };
  viewerOpenSubIssueIdsByDeliverableId: Record<string, string[]>;
  workspaceRevision: { activeTaskCount: number; latestUpdatedAt: string };
}>;

export function normalizePlanningBoardQuery(input: PlanningBoardQueryInput = {}): PlanningBoardQuery {
  const candidate = input.filters || {};
  const filters = { ...DEFAULT_PLANNING_FILTERS };
  for (const key of Object.keys(filters) as (keyof PlanningFilterPreferences)[]) {
    if (key === "quick" || key === "direction") continue;
    const value = candidate[key];
    if (typeof value === "string") Object.assign(filters, { [key]: value.slice(0, key === "query" ? 2048 : 512) });
  }
  filters.query = filters.query.trim().toLocaleLowerCase("de");
  filters.quick = Array.isArray(candidate.quick) ? [...new Set(candidate.quick.filter(value => ["mine", "my-reviews", "open", "critical", "blocked", "week", "high", "evidence"].includes(value)))].sort() : [];
  filters.direction = candidate.direction === "desc" ? "desc" : "asc";
  return { view: input.view === "complete" ? "complete" : "board", level: input.level === "epic" || input.level === "initiative" ? input.level : "deliverable", parentId: typeof input.parentId === "string" ? input.parentId.slice(0, 512) : "all", filters, ordering: "priority-order-id-and-completed-updated-desc-order-id" };
}
export function planningBoardQueryKey(query: PlanningBoardQueryInput = {}) {
  const normalized = normalizePlanningBoardQuery(query);
  // Complete views receive the whole authorized Planning collection and filter it locally.
  return JSON.stringify(normalized.view === "complete" ? { view: "complete" } : normalized);
}
export function planningBoardQueryFromSearchParams(params: URLSearchParams): PlanningBoardQueryInput {
  const filters: Record<string, unknown> = {};
  for (const key of Object.keys(DEFAULT_PLANNING_FILTERS)) {
    if (params.has(`tasks.${key}`)) filters[key] = key === "quick" ? params.getAll(`tasks.${key}`) : params.get(`tasks.${key}`);
  }
  return {
    ...(params.has("board.level") ? { level: params.get("board.level") as PlanningLevel } : {}),
    ...(params.has("board.parentId") ? { parentId: params.get("board.parentId")! } : {}),
    ...(Object.keys(filters).length ? { filters: filters as Partial<PlanningFilterPreferences> } : {}),
  };
}
