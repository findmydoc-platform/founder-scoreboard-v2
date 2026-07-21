import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20260721135448_normalize_review_work_status.sql";
const repairedTaskId = "sebastian-team-intake-f913a6437be042019ba8d3f5a95737e3-bb71383e2eaf4cd4b282b27ceaacc3fc-1";

test("invalid deliverable review states normalize to active work", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /create or replace function public\.normalize_task_approval_state/);
  assert.match(migration, /new\.status = 'Review'/);
  assert.match(migration, /new\.approval_status is distinct from 'approved'/);
  assert.match(migration, /new\.review_status is distinct from 'requested'/);
  assert.match(migration, /new\.status := 'In Arbeit'/);
  assert.match(migration, /'task\.status_changed'/);
  assert.match(migration, /'Status geändert: Review → In Arbeit'/);
});

test("the affected production item receives a narrowly guarded repair", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, new RegExp(`where id = '${repairedTaskId}'`));
  assert.match(migration, /and task_type = 'deliverable'/);
  assert.match(migration, /and status = 'Review'/);
  assert.match(migration, /approval_status is distinct from 'approved'/);
  assert.match(migration, /review_status is distinct from 'requested'/);
  assert.doesNotMatch(migration, /delete\s+from|truncate|drop\s+(?:table|schema)/i);
});
