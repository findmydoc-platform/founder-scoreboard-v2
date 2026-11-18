import type { BacklogMoveAction, BacklogPlacement } from "./backlog-ordering";

export type BacklogRankQuery = Readonly<{ view: "backlog-rank"; sourceId: string; sourceUpdatedAt: string; sourceRevision: string; action: BacklogMoveAction }>;
export type BacklogRankTarget = Readonly<{
  sourceId: string; sourceUpdatedAt: string; targetId: string | null; action: BacklogMoveAction; placement: BacklogPlacement | null;
  noop: boolean; sourceRevision: string; scopeRevision: string; observedAt: string; validUntil: string;
}>;
export function normalizeBacklogRank(input: unknown): BacklogRankQuery | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.view !== "backlog-rank" || typeof value.sourceId !== "string" || !value.sourceId || value.sourceId.length > 2048
    || typeof value.sourceRevision !== "string" || !value.sourceRevision || value.sourceRevision.length > 2048
    || typeof value.sourceUpdatedAt !== "string" || value.sourceUpdatedAt.length > 100 || !Number.isFinite(Date.parse(value.sourceUpdatedAt))
    || !["up", "down", "top", "bottom"].includes(String(value.action))) return null;
  return { view: "backlog-rank", sourceId: value.sourceId, sourceUpdatedAt: value.sourceUpdatedAt, sourceRevision: value.sourceRevision, action: value.action as BacklogMoveAction };
}
