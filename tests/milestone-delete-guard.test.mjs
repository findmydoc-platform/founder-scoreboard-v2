import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";
import {
  assertLocalDatabaseTarget,
  localMilestoneDatabaseConfig,
} from "../scripts/verify-milestone-crud.mjs";

const migrationPath = "supabase/migrations/20260730210934_unified_planning_hierarchy.sql";

test("unified hierarchy migrates retained Milestone records losslessly into canonical Epics", async () => {
  const [migration, corpus] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readSupabaseSchemaContract(),
  ]);

  assert.match(corpus, /Migration: 20260730210934_unified_planning_hierarchy\.sql/);
  assert.match(migration, /create table if not exists public\.planning_item_legacy_ids/i);
  assert.match(migration, /source_kind text not null,[\s\S]*check \(source_kind in \('milestone', 'package'\)\)/i);
  assert.match(migration, /insert into public\.planning_item_legacy_ids[\s\S]*select 'milestone'/i);
  assert.match(migration, /insert into public\.tasks \([\s\S]*task_type, parent_task_id/i);
  assert.match(migration, /from public\.milestones milestone/i);
  assert.match(migration, /'epic'/i);
  assert.doesNotMatch(migration, /drop table public\.milestones/i);
});

test("Epic deletion is empty-only, task-rooted, and service-role callable", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const start = migration.indexOf("create or replace function public.delete_empty_epic_transaction");
  const definition = migration.slice(start);

  assert.ok(start > 0);
  assert.match(definition, /p_task_id text/i);
  assert.match(definition, /v_role not in \('ceo', 'deputy'\)/i);
  assert.match(definition, /task_type = 'epic'/i);
  assert.match(definition, /parent_task_id = p_task_id/i);
  assert.match(definition, /planning_item_legacy_ids/i);
  assert.match(definition, /delete from public\.tasks/i);
  assert.match(migration, /revoke all on function public\.delete_empty_epic_transaction[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.delete_empty_epic_transaction[\s\S]*to service_role/i);
});

test("legacy Milestone endpoint stays an adapter over the canonical PlanningItems command", async () => {
  const [server, route, command] = await Promise.all([
    readFile("src/features/projects/model/milestone-server.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-browser-milestone-update.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-empty-epic-delete.ts", "utf8"),
  ]);

  assert.match(server, /task_type", "epic"/);
  assert.match(server, /resolveCanonicalStrategicItemId/);
  assert.doesNotMatch(server, /delete_empty_epic_transaction/);
  assert.match(route, /createEmptyEpicDeletePlanningItems/);
  assert.match(route, /\.run\(/);
  assert.doesNotMatch(route, /deleteProjectMilestone|\.rpc\(/);
  assert.match(command, /delete_empty_epic_with_audit_transaction/);
  assert.doesNotMatch(server, /\.from\("milestones"\)\.insert/);
});

test("Epic database verifier remains local-only and rolls back its fixtures", async () => {
  const verifier = await readFile("scripts/verify-milestone-crud.mjs", "utf8");

  assert.match(verifier, /await client\.query\("begin"\)/);
  assert.match(verifier, /await client\.query\("rollback"\)/);
  assert.match(verifier, /delete_empty_epic_transaction/);
  assert.match(verifier, /delete_empty_epic_with_audit_transaction/);
  assert.match(verifier, /auditCountAfter/);
  assert.match(verifier, /founderId/);
  assert.match(verifier, /legacyCountAfter/);
});

test("Epic database verifier refuses non-local targets", () => {
  const local = localMilestoneDatabaseConfig({});
  assert.doesNotThrow(() => assertLocalDatabaseTarget(local));
  assert.throws(
    () => assertLocalDatabaseTarget({ ...local, host: "db.example.invalid", port: 5432, ssl: true }),
    /local-only/,
  );
});
