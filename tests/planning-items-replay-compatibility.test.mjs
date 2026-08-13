import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("v2 replay storage preserves canonical receipts and rejects v1 snapshots", async () => {
  const [create, update, remove, migration] = await Promise.all([
    readFile("src/features/planning-items/model/planning-items-create.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-team-update-route.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-empty-epic-delete.ts", "utf8"),
    readFile("supabase/migrations/20260813125245_planning_legacy_big_bang_cutover.sql", "utf8"),
  ]);
  assert.match(create, /contract_version \|\| 1\) < 2/);
  assert.match(update, /contract_version \|\| 1\) < 2/);
  assert.doesNotMatch(create, /planningItemLegacyCreateHash|allowLegacyReferences/);
  assert.doesNotMatch(update, /mapLegacyPlanningItemDatabaseRow|allowLegacyItemIds/);
  assert.match(remove, /team_planning_item_delete_requests/);
  assert.match(remove, /delete_team_planning_item_transaction/);
  assert.doesNotMatch(remove, /team_planning_milestone_delete_requests|delete_team_planning_milestone_transaction/);
  assert.match(migration, /rename to team_planning_item_delete_requests/);
  assert.match(migration, /rename column milestone_id to item_id/);
});
