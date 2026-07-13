/**
 * @typedef {object} PlanningTrashPurgeResult
 * @property {boolean} busy
 * @property {number} purgedRoots
 * @property {number} purgedTasks
 * @property {number} resolvedNotifications
 * @property {number} blockedExpiredRoots
 * @property {boolean} hasMore
 */

/** @param {unknown} value */
function isNonNegativeSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * @param {unknown} value
 * @returns {PlanningTrashPurgeResult | null}
 */
export function parsePlanningTrashPurgeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = /** @type {Record<string, unknown>} */ (value);
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
