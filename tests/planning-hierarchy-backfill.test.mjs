import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("the historical backfill is followed by the verified canonical cutover", async () => {
  const [migration, cutover, verifier] = await Promise.all([
    read("supabase/migrations/20260804095226_verified_planning_hierarchy_backfill.sql"),
    read("supabase/migrations/20260813125245_planning_legacy_big_bang_cutover.sql"),
    read("scripts/verify-planning-legacy-cutover.mjs"),
  ]);

  assert.match(migration, /create or replace function public\.backfill_unified_planning_hierarchy\(\)/i);
  assert.match(migration, /select public\.backfill_unified_planning_hierarchy\(\)/i);
  assert.match(migration, /revoke all[^]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute[^]*to service_role/i);
  assert.match(migration, /planning_item_legacy_ids/i);
  assert.match(migration, /planning_item_strategy/i);
  assert.match(migration, /planning_item_raci_assignments/i);
  assert.match(migration, /set parent_task_id = legacy\.task_id/i);
  assert.match(migration, /set trash_root_id = legacy\.task_id/i);
  assert.match(migration, /profile_ui_preferences/i);

  assert.match(verifier, /Milestone row count and mapping/);
  assert.match(verifier, /Package fields, parent, approval, trash, and strategy parity/);
  assert.match(verifier, /historical links and source snapshots preserved/);
  assert.match(cutover, /rename to planning_item_historical_links/i);
  assert.match(cutover, /source_snapshot jsonb/i);
  assert.match(cutover, /drop table public\.packages restrict/i);
  assert.match(cutover, /drop table public\.milestones restrict/i);
});
