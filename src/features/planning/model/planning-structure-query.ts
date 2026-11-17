import type { Profile, Task } from "@/lib/types";

export type PlanningStructureQuery = Readonly<{ view: "structure"; area: "roots"; limit: number; continuation?: string }>;
export type PlanningStructureSelection = Readonly<{
  query: PlanningStructureQuery;
  itemIds: readonly string[];
  contextIds: readonly string[];
  total: number;
  coverage: "complete" | "partial";
  continuation: string | null;
  sourceRevision: string;
  scopeRevision: string;
  observedAt: string;
  validUntil: string;
}>;
export type PlanningStructureModel = Readonly<{
  revision: string;
  structure: PlanningStructureSelection;
  items: readonly Task[];
  people: readonly Profile[];
  taskOmittedFields: readonly (keyof Task)[];
}>;
export function normalizePlanningStructureQuery(input: unknown): PlanningStructureQuery | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const query = input as Record<string, unknown>;
  if (query.view !== "structure" || query.area !== "roots"
    || query.limit !== undefined && (!Number.isSafeInteger(query.limit) || (query.limit as number) < 1 || (query.limit as number) > 100)
    || query.continuation !== undefined && (typeof query.continuation !== "string" || !query.continuation || query.continuation.length > 4096)) return null;
  return { view: "structure", area: "roots", limit: query.limit as number | undefined ?? 20, ...(typeof query.continuation === "string" ? { continuation: query.continuation } : {}) };
}
