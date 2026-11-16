export type InitiativeCandidateQuery = Readonly<{
  view: "candidates";
  kind: "initiative";
  query: string;
  limit: number;
  continuation?: string;
}>;

export type InitiativeCandidatePage = Readonly<{
  items: readonly { id: string; title: string; taskType: "initiative"; parentTaskId: string; approvalStatus: string; updatedAt: string }[];
  total: number;
  coverage: "complete" | "partial";
  continuation: string | null;
  sourceRevision: string;
  observedAt: string;
  validUntil: string;
}>;

export function normalizeInitiativeCandidateQuery(input: unknown): InitiativeCandidateQuery | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.view !== "candidates" || value.kind !== "initiative" || typeof value.query !== "string" || value.query.length > 2048
    || value.limit !== undefined && (!Number.isSafeInteger(value.limit) || (value.limit as number) < 1 || (value.limit as number) > 100)
    || value.continuation !== undefined && (typeof value.continuation !== "string" || !value.continuation || value.continuation.length > 4096)) return null;
  return { view: "candidates", kind: "initiative", query: value.query.trim().toLocaleLowerCase("de"), limit: value.limit as number | undefined ?? 20,
    ...(typeof value.continuation === "string" ? { continuation: value.continuation } : {}) };
}
