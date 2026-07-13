import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("planning trash migration is additive, constrained, indexed, and hidden behind security-invoker views", async () => {
  const migration = await read("supabase/0063_planning_trash_persistence.sql");

  for (const table of ["packages", "tasks"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} add column if not exists trashed_at timestamptz`));
    assert.match(migration, new RegExp(`alter table public\\.${table} add column if not exists trash_revision integer not null default 0`));
  }
  assert.match(migration, /trash_cause in \('withdrawn', 'rejected'\)/);
  assert.match(migration, /purge_after = trashed_at \+ interval '90 days'/);
  assert.match(migration, /create index if not exists packages_purge_after_idx/);
  assert.match(migration, /create index if not exists tasks_purge_after_idx/);
  assert.match(migration, /create or replace view public\.active_packages[^]*with \(security_invoker = true\)[^]*where trashed_at is null/);
  assert.match(migration, /create or replace view public\.active_tasks[^]*with \(security_invoker = true\)[^]*where trashed_at is null/);
  assert.match(migration, /revoke all on public\.active_packages from public, anon/);
  assert.match(migration, /grant select on public\.active_tasks to authenticated, service_role/);
  assert.doesNotMatch(migration, /drop table|drop column|truncate|delete from/i);
});

test("normal planning and intake reads use the centralized active read models", async () => {
  const [readModel, loader, teamContext, ceoContext, v2Context, taskDetail] = await Promise.all([
    read("src/lib/planning-read-model.ts"),
    read("src/lib/planning-data-loader.ts"),
    read("src/features/intake/model/team-task-context.ts"),
    read("src/features/intake/model/task-intake-context.ts"),
    read("src/features/intake/model/team-task-intake-v2.ts"),
    read("src/lib/task-detail-data.ts"),
  ]);

  assert.match(readModel, /ACTIVE_PACKAGES_TABLE = "active_packages"/);
  assert.match(readModel, /ACTIVE_TASKS_TABLE = "active_tasks"/);
  for (const source of [loader, teamContext, ceoContext, v2Context]) {
    assert.match(source, /ACTIVE_PACKAGES_TABLE/);
  }
  for (const source of [loader, teamContext, ceoContext, v2Context, taskDetail]) {
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
