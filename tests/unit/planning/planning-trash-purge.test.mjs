import assert from "node:assert/strict";
import { test } from "vitest";
import { parsePlanningTrashPurgeResult } from "../../../src/lib/planning-trash-maintenance-result.mjs";

test("purge API result parsing fails closed on missing or malformed safety metrics", () => {
  const valid = {
    busy: false,
    purgedRoots: 1,
    purgedTasks: 2,
    resolvedNotifications: 0,
    blockedExpiredRoots: 0,
    hasMore: false,
  };
  assert.deepEqual(parsePlanningTrashPurgeResult(valid), valid);

  for (const invalid of [
    null,
    {},
    { ...valid, blockedExpiredRoots: undefined },
    { ...valid, blockedExpiredRoots: "0" },
    { ...valid, blockedExpiredRoots: -1 },
    { ...valid, busy: 0 },
    { ...valid, hasMore: null },
    { ...valid, purgedRoots: 26 },
    { ...valid, purgedTasks: Number.NaN },
  ]) {
    assert.equal(parsePlanningTrashPurgeResult(invalid), null);
  }
});
