import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readSupabaseMigrationCorpus } from "../scripts/lib/supabase-migrations.mjs";
import {
  assertLocalDatabaseTarget,
  localMilestoneDatabaseConfig,
} from "../scripts/verify-milestone-crud.mjs";

const migrationPath = "supabase/migrations/20260714171850_milestone_crud_empty_delete.sql";

test("Milestone child foreign keys reject deletion instead of detaching children", async () => {
  const [migration, corpus] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readSupabaseMigrationCorpus(),
  ]);

  assert.match(corpus, /Migration: 20260714171850_milestone_crud_empty_delete\.sql/);
  assert.match(migration, /drop constraint if exists packages_milestone_id_fkey/i);
  assert.match(migration, /add constraint packages_milestone_id_fkey[\s\S]*references public\.milestones\(id\)[\s\S]*on delete restrict/i);
  assert.match(migration, /drop constraint if exists tasks_milestone_id_fkey/i);
  assert.match(migration, /add constraint tasks_milestone_id_fkey[\s\S]*references public\.milestones\(id\)[\s\S]*on delete restrict/i);
  assert.doesNotMatch(migration, /(?:packages|tasks)_milestone_id_fkey[\s\S]{0,180}on delete set null/i);
});

test("Milestone ordering and revisions are database-owned", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /create or replace function public\.touch_milestone_updated_at\(\)/i);
  assert.match(migration, /new\.updated_at := greatest\(clock_timestamp\(\), old\.updated_at \+ interval '1 microsecond'\)/i);
  assert.match(migration, /create trigger milestones_touch_updated_at[\s\S]*before update on public\.milestones/i);
  assert.match(migration, /create or replace function public\.allocate_milestone_sort_order\(\)/i);
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*'milestone-sort:' \|\| new\.project_id/i);
  assert.match(migration, /coalesce\(max\(milestone\.sort_order\) \+ 1, 1\)/i);
  assert.match(migration, /create trigger milestones_allocate_sort_order[\s\S]*before insert on public\.milestones/i);
});

test("Planning Items constraints and RPCs add Milestones without widening existing tokens", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /drop constraint if exists team_task_intake_tokens_scopes_check/i);
  assert.match(migration, /add constraint team_task_intake_tokens_scopes_check[\s\S]*write:planning-items:delete-empty/i);
  assert.match(migration, /drop constraint if exists team_planning_item_update_requests_item_type_check/i);
  assert.match(migration, /add constraint team_planning_item_update_requests_item_type_check[\s\S]*'milestone'/i);
  assert.match(migration, /create or replace function public\.create_team_planning_items_token_v2\([\s\S]*p_allow_empty_milestone_deletes boolean default false/i);
  assert.match(migration, /milestone delete token requires ceo or deputy/i);
  assert.match(migration, /v_token := public\.create_team_planning_items_token\(/i);
  assert.doesNotMatch(migration, /create or replace function public\.create_team_planning_items_token\(/i);

  const authenticateDefinition = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.authenticate_team_planning_items_token"),
    migration.indexOf("CREATE OR REPLACE FUNCTION public.create_team_planning_items_token_v2"),
  );
  assert.match(authenticateDefinition, /p_scope = 'write:planning-items:delete-empty'[\s\S]*platform_role not in \('ceo', 'deputy'\)/i);
  assert.match(authenticateDefinition, /p_scope is null[\s\S]*p_scope not in/i);
  assert.ok(
    authenticateDefinition.indexOf("milestone deletion requires ceo or deputy")
      < authenticateDefinition.indexOf("return jsonb_build_object("),
    "Delete-scope authentication must recheck the current role before returning token metadata.",
  );

  const createDefinition = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.create_team_planning_items_transaction"));
  assert.match(createDefinition, /if v_item_type = 'milestone'/i);
  assert.match(createDefinition, /p_items is null or jsonb_typeof\(p_items\) <> 'array'/i);
  assert.match(createDefinition, /insert into public\.milestones[\s\S]*'findmydoc-founder-execution'/i);
  assert.match(createDefinition, /team\.planning_items\.milestone_create/i);
  assert.ok(
    createDefinition.indexOf("milestone creation requires ceo or deputy")
      < createDefinition.indexOf("return jsonb_build_object('batchId', v_batch.id, 'replayed', true"),
    "Current Milestone create authorization must run before an idempotent replay.",
  );

  const updateDefinition = migration.slice(migration.indexOf("CREATE OR REPLACE FUNCTION public.update_team_planning_item_transaction"));
  assert.match(updateDefinition, /p_item_type not in \('milestone', 'initiative', 'deliverable', 'sub_issue'\)/i);
  assert.match(updateDefinition, /p_item_type is null[\s\S]*p_item_type not in/i);
  assert.match(updateDefinition, /where id = p_item_id[\s\S]*project_id = 'findmydoc-founder-execution'[\s\S]*for update/i);
  assert.match(updateDefinition, /milestone\.updated_at = \$3/i);
  assert.match(updateDefinition, /team\.planning_items\.milestone_update/i);
  assert.match(updateDefinition, /if not exists \(select 1 from jsonb_object_keys\(v_patch\)\) then[\s\S]*v_item := v_before/i);
  assert.ok(
    updateDefinition.indexOf("milestone update requires ceo or deputy")
      < updateDefinition.indexOf("return jsonb_set(v_request.response, '{replayed}'"),
    "Current Milestone update authorization must run before an idempotent replay.",
  );
});

test("Milestone delete is fixed-project, atomic, idempotent, and empty-only", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const start = migration.indexOf("CREATE OR REPLACE FUNCTION public.delete_team_planning_milestone_transaction");
  const end = migration.indexOf("REVOKE ALL ON FUNCTION public.authenticate_team_planning_items_token", start);
  const definition = migration.slice(start, end);

  assert.ok(start > 0 && end > start);
  assert.match(definition, /security definer[\s\S]*set search_path to public/i);
  assert.match(definition, /write:planning-items:delete-empty/i);
  assert.match(definition, /v_role not in \('ceo', 'deputy'\)/i);
  assert.match(definition, /project_id = 'findmydoc-founder-execution'[\s\S]*for update/i);
  assert.match(definition, /from public\.packages[\s\S]*where milestone_id = p_milestone_id/i);
  assert.match(definition, /from public\.tasks[\s\S]*where milestone_id = p_milestone_id/i);
  assert.doesNotMatch(definition, /trashed_at is null/i);
  assert.match(definition, /errcode = 'P0008'[\s\S]*message = 'milestone is not empty'/i);
  assert.match(definition, /delete from public\.milestones[\s\S]*updated_at = p_expected_updated_at/i);
  assert.match(definition, /jsonb_set\(v_request\.response, '\{replayed\}', 'true'::jsonb/i);
  assert.match(definition, /team\.planning_items\.milestone_delete/i);
  assert.ok(
    definition.indexOf("milestone deletion requires ceo or deputy")
      < definition.indexOf("return jsonb_set(v_request.response, '{replayed}'"),
    "Current Milestone delete authorization must run before an idempotent replay.",
  );

  const conflictIndex = definition.indexOf("errcode = 'P0008'");
  const deleteIndex = definition.indexOf("delete from public.milestones");
  const auditIndex = definition.indexOf("'team.planning_items.milestone_delete'");
  const ledgerIndex = definition.indexOf("insert into public.team_planning_milestone_delete_requests");
  assert.ok(conflictIndex < deleteIndex && deleteIndex < auditIndex && auditIndex < ledgerIndex);

  assert.match(migration, /revoke all on function public\.delete_team_planning_milestone_transaction[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.delete_team_planning_milestone_transaction[\s\S]*to service_role/i);
  assert.match(migration, /alter table public\.team_planning_milestone_delete_requests enable row level security/i);
});

test("Milestone database verifier refuses non-local targets", () => {
  const local = localMilestoneDatabaseConfig({});
  assert.doesNotThrow(() => assertLocalDatabaseTarget(local));
  assert.throws(
    () => assertLocalDatabaseTarget({ ...local, host: "db.example.invalid", port: 5432, ssl: true }),
    /local-only/,
  );
});

test("Milestone database verifier exercises two-connection races and rollback fixtures", async () => {
  const verifier = await readFile("scripts/verify-milestone-crud.mjs", "utf8");

  assert.match(verifier, /await client\.query\("begin"\)/);
  assert.match(verifier, /await client\.query\("rollback"\)/);
  assert.match(verifier, /verifyParallelSortAllocation/);
  assert.match(verifier, /const clients = \[new pg\.Client\(config\), new pg\.Client\(config\)\]/);
  assert.match(verifier, /Promise\.allSettled\(\[[\s\S]*delete from public\.milestones[\s\S]*insert into public\.packages/i);
  assert.match(verifier, /retainedWithChild[\s\S]*deletedWithoutChild/);
  assert.match(verifier, /rejected\[0\]\.reason\?\.code, "23503"/);
});
