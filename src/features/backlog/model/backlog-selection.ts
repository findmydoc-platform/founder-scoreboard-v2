import { DEFAULT_BACKLOG_FILTERS, type BacklogTableFilters } from "./backlog-view-model";

export type BacklogSelectionQuery = Readonly<{
  view: "backlog";
  filters: BacklogTableFilters & { level: "deliverable" };
  limit: number;
  continuation?: string;
}>;

export type BacklogSelection = Readonly<{
  query: BacklogSelectionQuery;
  itemIds: readonly string[];
  contextIds: readonly string[];
  rankById: Readonly<Record<string, number>>;
  total: number;
  coverage: "complete" | "partial";
  continuation: string | null;
  scopeRevision: string;
  sourceRevision: string;
  observedAt: string;
  validUntil: string;
}>;

export function normalizeBacklogSelection(input: unknown): BacklogSelectionQuery | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.view !== "backlog" || !value.filters || typeof value.filters !== "object" || Array.isArray(value.filters)) return null;
  const filters = { ...DEFAULT_BACKLOG_FILTERS, ...value.filters } as Record<keyof BacklogTableFilters, unknown>;
  if (filters.level !== "deliverable" || !["all", "proposals", "ready", "unscheduled"].includes(String(filters.scope))
    || !["all", "ready", "incomplete"].includes(String(filters.readiness))
    || !["rank", "priority", "title", "approval", "initiative", "assignee", "readiness", "status"].includes(String(filters.sort))
    || !["asc", "desc"].includes(String(filters.direction))
    || ["query", "status", "priority", "epic", "initiative", "assignee"].some(key => typeof filters[key as keyof BacklogTableFilters] !== "string" || String(filters[key as keyof BacklogTableFilters]).length > 2048)
    || value.limit !== undefined && (!Number.isSafeInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100)
    || value.continuation !== undefined && (typeof value.continuation !== "string" || !value.continuation || value.continuation.length > 4096)) return null;
  return { view: "backlog", filters: {
    level: "deliverable", query: String(filters.query).trim().toLowerCase(), scope: filters.scope as BacklogTableFilters["scope"],
    status: String(filters.status), readiness: filters.readiness as BacklogTableFilters["readiness"], priority: String(filters.priority),
    epic: String(filters.epic), initiative: String(filters.initiative), assignee: String(filters.assignee),
    sort: filters.sort as BacklogTableFilters["sort"], direction: filters.direction as BacklogTableFilters["direction"],
  }, limit: value.limit as number | undefined ?? 20, ...(typeof value.continuation === "string" ? { continuation: value.continuation } : {}) };
}
