import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("production baseline keeps planning trash constrained, indexed, and hidden behind security-invoker views", async () => {
  const [migration, schema] = await Promise.all([
    readSupabaseSchemaContract(),
    readSupabaseSchemaContract(),
  ]);

  for (const table of ["packages", "tasks"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}[^]*trashed_at timestamptz`));
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}[^]*trash_revision integer default 0 not null`));
  }
  assert.match(migration, /packages_trash_metadata_check[^]*'withdrawn'[^]*'rejected'[^]*90 days/);
  assert.match(migration, /tasks_trash_metadata_check[^]*'withdrawn'[^]*'rejected'[^]*90 days/);
  assert.match(migration, /create index packages_purge_after_idx/);
  assert.match(migration, /create index tasks_purge_after_idx/);
  assert.match(migration, /create or replace view public\.active_packages[^]*with \(security_invoker='true'\)[^]*where \(trashed_at is null\)/);
  assert.match(migration, /create or replace view public\.active_tasks[^]*with \(security_invoker='true'\)[^]*where \(trashed_at is null\)/);
  assert.match(migration, /grant select,[^;]* on table public\.active_packages to authenticated/);
  assert.match(migration, /grant select,[^;]* on table public\.active_tasks to authenticated/);

  for (const sql of [migration, schema]) {
    for (const constraint of [
      "packages_trash_revision_check",
      "packages_trash_metadata_check",
      "tasks_trash_revision_check",
      "tasks_trash_metadata_check",
    ]) {
      assert.match(sql, new RegExp(`constraint ${constraint} check`));
    }
  }
});

test("normal planning reads use the centralized active read models", async () => {
  const [readModel, loader, planningContext, planningItemsCreate, taskDetail] = await Promise.all([
    read("src/lib/planning-read-model.ts"),
    read("src/lib/planning-data-loader.ts"),
    read("src/features/planning-items/model/planning-items-context.ts"),
    read("src/features/planning-items/model/planning-items-create.ts"),
    read("src/lib/task-detail-data.ts"),
  ]);

  assert.match(readModel, /ACTIVE_PACKAGES_TABLE = "active_packages"/);
  assert.match(readModel, /ACTIVE_TASKS_TABLE = "active_tasks"/);
  for (const source of [loader, planningContext, planningItemsCreate]) {
    assert.match(source, /ACTIVE_PACKAGES_TABLE/);
  }
  for (const source of [loader, planningContext, planningItemsCreate, taskDetail]) {
    assert.match(source, /ACTIVE_TASKS_TABLE/);
  }
});

test("schema verification covers trash metadata and both active views", async () => {
  const checks = JSON.parse(await read("src/lib/planning-schema-checks.json"));
  const names = new Set(checks.map((entry) => entry.name));

  assert.ok(names.has("packages.trash"));
  assert.ok(names.has("tasks.trash"));
  assert.ok(names.has("active_packages"));
  assert.ok(names.has("active_tasks"));
});
