import type { Task } from "@/lib/types";
import { taskStatuses } from "@/lib/status";
import { DEFAULT_BACKLOG_FILTERS, type BacklogTableFilters } from "./backlog-view-model";

export type BacklogOrphanSection = "orphanInitiatives" | "orphanDeliverables";
export type BacklogSection = "level" | BacklogOrphanSection;

export type BacklogSelectionQuery = Readonly<{
  view: "backlog";
  filters: BacklogTableFilters;
  section?: BacklogOrphanSection;
  limit: number;
  continuation?: string;
}>;

export type BacklogParentProgress = Readonly<{ total: number; completed: number; unfinished: number; percentage: number }>;

export function validBacklogParentProgress(value: unknown, contextIds: readonly string[]): value is Record<string, BacklogParentProgress> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([id, progress]) => contextIds.includes(id) && progress && typeof progress === "object"
    && [progress.total, progress.completed, progress.unfinished, progress.percentage].every(Number.isSafeInteger)
    && progress.total >= 0 && progress.completed >= 0 && progress.unfinished >= 0
    && progress.completed + progress.unfinished === progress.total
    && progress.percentage === (progress.total ? Math.round(progress.completed / progress.total * 100) : 0));
}

export type BacklogSelection = Readonly<{
  parentProgressById?: Readonly<Record<string, BacklogParentProgress>>;
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
  const section = value.section ?? "level";
  if (!["level", "orphanInitiatives", "orphanDeliverables"].includes(String(section))) return null;
  let filters = { ...DEFAULT_BACKLOG_FILTERS, ...value.filters } as Record<keyof BacklogTableFilters, unknown>;
  if (section !== "level") {
    if (filters.level !== "epic") return null;
    filters = { ...DEFAULT_BACKLOG_FILTERS, level: "epic" };
  }
  if (!["deliverable", "initiative", "epic"].includes(String(filters.level)) || !["all", "proposals", "ready", "unscheduled"].includes(String(filters.scope))
    || !["all", "ready", "incomplete"].includes(String(filters.readiness))
    || !["rank", "priority", "title", "approval", "initiative", "assignee", "readiness", "status"].includes(String(filters.sort))
    || !["asc", "desc"].includes(String(filters.direction))
    || ["query", "status", "priority", "epic", "initiative", "assignee"].some(key => typeof filters[key as keyof BacklogTableFilters] !== "string" || String(filters[key as keyof BacklogTableFilters]).length > 2048)
    || value.limit !== undefined && (!Number.isSafeInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100)
    || value.continuation !== undefined && (typeof value.continuation !== "string" || !value.continuation || value.continuation.length > 4096)) return null;
  return { view: "backlog", filters: {
    level: filters.level as BacklogTableFilters["level"], query: String(filters.query).trim().toLowerCase(), scope: filters.scope as BacklogTableFilters["scope"],
    status: String(filters.status), readiness: filters.readiness as BacklogTableFilters["readiness"], priority: String(filters.priority),
    epic: String(filters.epic), initiative: String(filters.initiative), assignee: String(filters.assignee),
    sort: filters.sort as BacklogTableFilters["sort"], direction: filters.direction as BacklogTableFilters["direction"],
  }, ...(section !== "level" ? { section: section as BacklogOrphanSection } : {}), limit: value.limit as number | undefined ?? 20, ...(typeof value.continuation === "string" ? { continuation: value.continuation } : {}) };
}

export function completeBacklogParentMembership(selection: BacklogSelection | undefined, task: (id: string) => Task | undefined, blocked: (id: string) => boolean = () => false): string[] {
  if (!selection || selection.query.section || selection.query.filters.level !== "deliverable"
    || (Object.keys(DEFAULT_BACKLOG_FILTERS) as Array<keyof BacklogTableFilters>).some(key => selection.query.filters[key] !== DEFAULT_BACKLOG_FILTERS[key])
    || !selection.parentProgressById || !validBacklogParentProgress(selection.parentProgressById, selection.contextIds)
    || new Set(selection.itemIds).size !== selection.itemIds.length) return [];
  const candidates = Object.entries(selection.parentProgressById).filter(([,progress]) => progress.unfinished <= selection.itemIds.length);
  if (!candidates.length) return [];
  const members = selection.itemIds.map(id => task(id));
  if (members.some((row,index) => !row || row.id !== selection.itemIds[index] || row.taskType !== "deliverable" || !row.updatedAt
    || ![...taskStatuses,"Pausiert"].includes(row.status) || row.status === "Erledigt" || !row.parentTaskId)) return [];
  return candidates.flatMap(([id, progress]) => {
    const parent = task(id), children = members.filter(row => row!.parentTaskId === id);
    return parent?.id === id && parent.taskType === "initiative" && parent.updatedAt && !blocked(id) && children.every(row => !blocked(row!.id))
      && children.length === progress.unfinished ? [id] : [];
  });
}
