export type PlanningTrashPurgeResult = {
  busy: boolean;
  purgedRoots: number;
  purgedTasks: number;
  resolvedNotifications: number;
  blockedExpiredRoots: number;
  hasMore: boolean;
};

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function parsePlanningTrashPurgeResult(value: unknown): PlanningTrashPurgeResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (
    typeof result.busy !== "boolean"
    || typeof result.hasMore !== "boolean"
    || !isNonNegativeSafeInteger(result.purgedRoots)
    || result.purgedRoots > 25
    || !isNonNegativeSafeInteger(result.purgedTasks)
    || !isNonNegativeSafeInteger(result.resolvedNotifications)
    || !isNonNegativeSafeInteger(result.blockedExpiredRoots)
  ) {
    return null;
  }

  return {
    busy: result.busy,
    purgedRoots: result.purgedRoots,
    purgedTasks: result.purgedTasks,
    resolvedNotifications: result.resolvedNotifications,
    blockedExpiredRoots: result.blockedExpiredRoots,
    hasMore: result.hasMore,
  };
}
