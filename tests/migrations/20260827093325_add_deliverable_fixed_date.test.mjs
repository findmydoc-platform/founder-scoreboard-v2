import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import {
  applyMigration,
  resetLocalDatabaseTo,
  withLocalDatabase,
} from "./helpers/migration-test-harness.mjs";

const previousVersion = "20260827093324";
const migrationFile = resolve(
  process.cwd(),
  "supabase/migrations/20260827093325_add_deliverable_fixed_date.sql",
);

function expectDatabaseError(code, message) {
  return (error) => {
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  };
}

test("classifies legacy schedule values and enforces fixed-date persistence", {
  timeout: 120_000,
}, async () => {
  await resetLocalDatabaseTo(previousVersion);

  await withLocalDatabase(async (client) => {
    await client.query(`
      insert into public.projects (id, name)
      values ('findmydoc-founder-execution', 'FounderOps')
    `);
    await client.query(`
      insert into public.profiles (id, name, role, platform_role)
      values ('migration-founder', 'Migration Founder', 'member', 'founder')
    `);
    await client.query(`
      insert into public.sprints (id, project_id, name, status, start_date, end_date)
      values (
        'sprint-8', 'findmydoc-founder-execution', 'Sprint 8', 'active',
        '2026-08-24', '2026-09-06'
      )
    `);
    await client.query(`
      insert into public.tasks (
        id, project_id, title, status, priority, task_type, approval_status,
        score_relevant, github_issue_sync_status
      ) values (
        'fixture-initiative', 'findmydoc-founder-execution', 'Fixture Initiative',
        'Offen', 'P2', 'initiative', 'approved', false, 'not_applicable'
      )
    `);

    await client.query("select set_config('founderops.trash_lifecycle_write', 'on', false)");
    await client.query(`
      insert into public.tasks (
        id, project_id, title, status, priority, task_type, approval_status,
        score_relevant, github_repo, parent_task_id, start_date, end_date, deadline,
        trashed_at, trashed_by, trash_reason, trash_cause, purge_after,
        trash_root_type, trash_root_id, trash_revision
      ) values
        ('valid-date', 'findmydoc-founder-execution', 'Valid date', 'Offen', 'P2', 'deliverable', 'approved', false, 'findmydoc-platform/management', 'fixture-initiative', null, null, '2026-09-03', null, null, null, null, null, null, null, 0),
        ('boundary-date', 'findmydoc-founder-execution', 'Boundary date', 'Offen', 'P2', 'deliverable', 'proposed', false, 'findmydoc-platform/management', 'fixture-initiative', null, null, '2026-09-06', null, null, null, null, null, null, null, 0),
        ('sprint-reference', 'findmydoc-founder-execution', 'Sprint reference', 'Offen', 'P2', 'deliverable', 'proposed', false, 'findmydoc-platform/management', 'fixture-initiative', null, null, 'Sprint 8', null, null, null, null, null, null, null, 0),
        ('relative-value', 'findmydoc-founder-execution', 'Relative value', 'Offen', 'P2', 'deliverable', 'proposed', false, 'findmydoc-platform/management', 'fixture-initiative', null, null, 'Sprint -3', null, null, null, null, null, null, null, 0),
        ('legacy-period', 'findmydoc-founder-execution', 'Legacy period', 'Offen', 'P2', 'deliverable', 'proposed', false, 'findmydoc-platform/management', 'fixture-initiative', '2026-08-25', '2026-08-29', null, null, null, null, null, null, null, null, 0),
        ('trashed-valid-date', 'findmydoc-founder-execution', 'Trashed valid date', 'Offen', 'P2', 'deliverable', 'proposed', false, 'findmydoc-platform/management', 'fixture-initiative', null, null, '2026-09-04', '2026-08-20 12:00:00+00', 'migration-founder', 'No longer needed', 'withdrawn', '2026-11-18 12:00:00+00', 'deliverable', 'trashed-valid-date', 1),
        ('sub-issue-date', 'findmydoc-founder-execution', 'Sub-issue date', 'Offen', 'P2', 'sub_issue', null, false, 'findmydoc-platform/management', 'valid-date', null, null, '2026-09-05', null, null, null, null, null, null, null, 0)
    `);
    await client.query("select set_config('founderops.trash_lifecycle_write', 'off', false)");
    await client.query(`
      insert into public.tasks (
        id, project_id, title, status, priority, task_type, approval_status,
        score_relevant, github_repo, github_issue_sync_status, target_date
      ) values (
        'unaffected-initiative', 'findmydoc-founder-execution', 'Unaffected', 'Offen', 'P2',
        'initiative', 'approved', false, null, 'not_applicable', '2026-12-01'
      )
    `);

    await applyMigration(client, migrationFile);

    const tasks = await client.query(`
      select id, fixed_date::text as fixed_date, start_date, end_date, deadline, target_date::text as target_date
      from public.tasks
      order by id
    `);
    const byId = new Map(tasks.rows.map((row) => [row.id, row]));
    assert.equal(byId.get("valid-date").fixed_date, "2026-09-03");
    assert.equal(byId.get("trashed-valid-date").fixed_date, "2026-09-04");
    assert.equal(byId.get("boundary-date").fixed_date, null);
    assert.equal(byId.get("sprint-reference").fixed_date, null);
    assert.equal(byId.get("relative-value").fixed_date, null);
    assert.equal(byId.get("legacy-period").fixed_date, null);
    assert.equal(byId.get("sub-issue-date").fixed_date, null);
    assert.equal(byId.get("unaffected-initiative").target_date, "2026-12-01");
    assert.ok(tasks.rows.every((row) => row.start_date === null && row.end_date === null && row.deadline === null));

    const audit = await client.query(`
      select entity_id, before_data, after_data
      from public.audit_log
      where action = 'task.schedule_legacy_normalized'
      order by entity_id
    `);
    assert.equal(audit.rowCount, 7);
    const auditById = new Map(audit.rows.map((row) => [row.entity_id, row]));
    assert.equal(auditById.get("valid-date").after_data.classification, "fixed_date_migrated");
    assert.equal(auditById.get("boundary-date").after_data.classification, "sprint_boundary_date");
    assert.equal(auditById.get("boundary-date").after_data.suggestedFixedDate, "2026-09-06");
    assert.equal(auditById.get("sprint-reference").after_data.classification, "sprint_reference");
    assert.equal(auditById.get("relative-value").after_data.classification, "relative_value");
    assert.equal(auditById.get("legacy-period").after_data.classification, "legacy_period_removed");
    assert.equal(auditById.get("sub-issue-date").after_data.classification, "non_deliverable_legacy_value");
    assert.equal(auditById.get("trashed-valid-date").before_data.deadline, "2026-09-04");

    await assert.rejects(
      () => client.query("update public.tasks set deadline = 'Sprint 9' where id = 'valid-date'"),
      expectDatabaseError("23514", /tasks_legacy_schedule_empty_check/),
    );
    await assert.rejects(
      () => client.query("update public.tasks set fixed_date = '2026-09-05' where id = 'sub-issue-date'"),
      expectDatabaseError("23514", /tasks_fixed_date_deliverable_check/),
    );

    const created = await client.query(`
      select public.create_planning_task_transaction(
        jsonb_build_object(
          'id', 'rpc-fixed-date',
          'creation_request_id', 'migration-rpc-fixed-date',
          'project_id', 'findmydoc-founder-execution',
          'title', 'RPC fixed date',
          'status', 'Offen',
          'priority', 'P2',
          'task_type', 'deliverable',
          'github_repo', 'findmydoc-platform/management',
          'score_relevant', false,
          'fixed_date', '2026-09-05'
        )
      ) as result
    `);
    assert.equal(created.rows[0].result.task.fixed_date, "2026-09-05");

    await assert.rejects(
      () => client.query(`
        select public.create_task_transaction(
          jsonb_build_object(
            'id', 'rpc-legacy-date',
            'creation_request_id', 'migration-rpc-legacy-date',
            'project_id', 'findmydoc-founder-execution',
            'title', 'RPC legacy date',
            'status', 'Offen',
            'priority', 'P2',
            'task_type', 'sub_issue',
            'github_repo', 'findmydoc-platform/management',
            'score_relevant', false,
            'deadline', 'Sprint 9'
          )
        )
      `),
      expectDatabaseError("22023", /unsupported columns/),
    );

    const updatedAt = await client.query(
      "select updated_at::text as updated_at from public.tasks where id = 'rpc-fixed-date'",
    );
    const updated = await client.query(
      "select public.update_task_transaction($1, $2, $3::jsonb) as result",
      ["rpc-fixed-date", updatedAt.rows[0].updated_at, JSON.stringify({ fixed_date: "2026-09-06" })],
    );
    assert.equal(updated.rows[0].result.task.fixed_date, "2026-09-06");

    const adapters = await client.query(`
      select proname, pg_get_functiondef(oid) as definition
      from pg_proc
      where pronamespace = 'public'::regnamespace
        and proname in (
          'create_task_transaction',
          'create_team_planning_items_transaction',
          'lock_sprint_transaction',
          'update_task_transaction',
          'update_team_planning_item_transaction_without_completed_guard'
        )
      order by proname
    `);
    assert.equal(adapters.rowCount, 5);
    for (const adapter of adapters.rows) {
      assert.match(adapter.definition, /fixed_date/);
      assert.doesNotMatch(adapter.definition, /\b(start_date|end_date|deadline)\b/);
    }

    const replayContracts = await client.query(`
      select table_name, column_default
      from information_schema.columns
      where table_schema = 'public'
        and column_name = 'contract_version'
        and table_name in (
          'team_task_intake_batches',
          'team_planning_item_update_requests',
          'team_planning_item_delete_requests'
        )
      order by table_name
    `);
    assert.equal(replayContracts.rowCount, 3);
    assert.ok(replayContracts.rows.every((row) => row.column_default.includes("3")));
    const replayChecks = await client.query(`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname in (
        'team_task_intake_batches_contract_version_check',
        'team_planning_item_update_requests_contract_version_check',
        'team_planning_item_delete_requests_contract_version_check'
      )
    `);
    assert.equal(replayChecks.rowCount, 3);
    assert.ok(replayChecks.rows.every((row) => /ARRAY\[1, 2, 3\]/.test(row.definition)));

    const activeProjection = await client.query(
      "select fixed_date::text as fixed_date from public.active_tasks where id = 'valid-date'",
    );
    assert.deepEqual(activeProjection.rows, [{ fixed_date: "2026-09-03" }]);

    await applyMigration(client, migrationFile);
    const auditAfterReplay = await client.query(`
      select count(*)::integer as count
      from public.audit_log
      where action = 'task.schedule_legacy_normalized'
    `);
    assert.equal(auditAfterReplay.rows[0].count, 7);
  });
});
