import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20260721112813_remove_redundant_comment_activity.sql";

test("task comment persistence no longer copies comments into task activity", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /create or replace function public\.create_task_comment_with_github_delivery/);
  assert.match(migration, /insert into public\.task_comments/);
  assert.match(migration, /insert into public\.task_comment_github_deliveries/);
  assert.doesNotMatch(migration, /insert into public\.task_activity|Kommentar hinzugefügt/);
});
