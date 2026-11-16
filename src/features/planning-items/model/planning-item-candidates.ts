export type PlanningItemCandidateQuery = Readonly<{
  view: "candidates";
  kind: "initiative" | "epic" | "deliverable";
  query: string;
  limit: number;
  continuation?: string;
}>;

export type PlanningItemCandidate = Readonly<{ id: string; title: string; parentTaskId: string; approvalStatus: string; updatedAt: string } & (
  | { taskType: "initiative" | "epic"; parentTitle?: never }
  | { taskType: "deliverable"; parentTitle: string | null }
)>;

type CandidatePageFields = Readonly<{
  items: readonly PlanningItemCandidate[];
  total: number;
  coverage: "complete" | "partial";
  continuation: string | null;
  sourceRevision: string;
  observedAt: string;
  validUntil: string;
}>;

// Initiative responses retain their existing shape. Only the Epic intent
// provides an authoritative default from its complete, unfiltered scope.
export type PlanningItemCandidatePage = CandidatePageFields & (
  | { kind?: "initiative"; defaultCandidate?: never }
  | { kind: "deliverable"; defaultCandidate?: never }
  | { kind: "epic"; defaultCandidate: PlanningItemCandidate | null }
);

export type PlanningCandidateDefault = { status: "not-applicable" | "unknown" }
  | { status: "current"; item: PlanningItemCandidate | null };

export type PlanningItemCandidateReceipt = Readonly<{
  candidates: PlanningItemCandidatePage;
  readAuthority: import("@/features/planning/model/planning-server-header-read").PlanningReadAuthority;
  readActor: Readonly<{ profileId: string; platformRole: import("@/lib/types").Profile["platformRole"] }>;
}>;

export type PlanningItemCandidateView = Readonly<{
  query: PlanningItemCandidateQuery;
  readStatus: import("@/features/planning/model/planning-state").PlanningReadStatus;
  furtherReadStatus: import("@/features/planning/model/planning-state").PlanningReadStatus;
  items: PlanningItemCandidatePage["items"];
  total: number | null;
  coverage: "complete" | "partial" | "unknown";
  continuation: string | null;
  defaultChoice: PlanningCandidateDefault;
}>;

export type PlanningCandidateAccess = {
  candidates(query: PlanningItemCandidateQuery): PlanningItemCandidateView;
  candidate(id: string): PlanningItemCandidatePage["items"][number] | null;
  loadCandidates(query: PlanningItemCandidateQuery, options?: { immediate?: boolean; refresh?: boolean; signal?: AbortSignal }): Promise<{ ok: boolean }>;
};

export function normalizePlanningItemCandidateQuery(input: unknown): PlanningItemCandidateQuery | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.view !== "candidates" || value.kind !== "initiative" && value.kind !== "epic" && value.kind !== "deliverable" || typeof value.query !== "string" || value.query.length > 2048
    || value.limit !== undefined && (!Number.isSafeInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100)
    || value.continuation !== undefined && (typeof value.continuation !== "string" || !value.continuation || value.continuation.length > 4096)) return null;
  return { view: "candidates", kind: value.kind, query: value.query.trim().toLocaleLowerCase("de"), limit: value.limit as number | undefined ?? 20,
    ...(typeof value.continuation === "string" ? { continuation: value.continuation } : {}) };
}
