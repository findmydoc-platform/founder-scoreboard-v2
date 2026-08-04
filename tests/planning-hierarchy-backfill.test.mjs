import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("the production backfill and local upgrade fixture execute the same idempotent routine", async () => {
  const [migration, verifier, localIntegration] = await Promise.all([
    read("supabase/migrations/20260804095226_verified_planning_hierarchy_backfill.sql"),
    read("scripts/verify-planning-items-transaction.mjs"),
    read("scripts/verify-local-integration.mjs"),
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

  assert.match(verifier, /Invalid legacy input must not leave a partial id mapping/);
  assert.match(verifier, /Legacy active Initiative/);
  assert.match(verifier, /Legacy trashed Initiative/);
  assert.match(verifier, /Legacy trashed Sub-Issue/);
  assert.match(verifier, /Every legacy root must retain a canonical id mapping/);
  assert.match(verifier, /Backfill must be idempotent/);
  assert.match(verifier, /legacy_create: 1, legacy_update: 1, legacy_delete: 1/);
  assert.match(localIntegration, /verify-planning-items-transaction\.mjs/);
});
