import { resolve } from "node:path";
import { expect, it } from "vitest";
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

async function expectDatabaseError(operation, code, message) {
  await expect(operation()).rejects.toMatchObject({
    code,
    message: expect.stringMatching(message),
  });
}

it("classifies legacy schedule values and enforces fixed-date persistence", {
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
    expect(byId.get("valid-date").fixed_date).toBe("2026-09-03");
    expect(byId.get("trashed-valid-date").fixed_date).toBe("2026-09-04");
    expect(byId.get("boundary-date").fixed_date).toBeNull();
    expect(byId.get("sprint-reference").fixed_date).toBeNull();
    expect(byId.get("relative-value").fixed_date).toBeNull();
    expect(byId.get("legacy-period").fixed_date).toBeNull();
    expect(byId.get("sub-issue-date").fixed_date).toBeNull();
    expect(byId.get("unaffected-initiative").target_date).toBe("2026-12-01");
    expect(tasks.rows.every((row) => row.start_date === null && row.end_date === null && row.deadline === null)).toBe(true);

    const audit = await client.query(`
      select entity_id, before_data, after_data
      from public.audit_log
      where action = 'task.schedule_legacy_normalized'
      order by entity_id
    `);
    expect(audit.rowCount).toBe(7);
    const auditById = new Map(audit.rows.map((row) => [row.entity_id, row]));
    expect(auditById.get("valid-date").after_data.classification).toBe("fixed_date_migrated");
    expect(auditById.get("boundary-date").after_data.classification).toBe("sprint_boundary_date");
    expect(auditById.get("boundary-date").after_data.suggestedFixedDate).toBe("2026-09-06");
    expect(auditById.get("sprint-reference").after_data.classification).toBe("sprint_reference");
    expect(auditById.get("relative-value").after_data.classification).toBe("relative_value");
    expect(auditById.get("legacy-period").after_data.classification).toBe("legacy_period_removed");
    expect(auditById.get("sub-issue-date").after_data.classification).toBe("non_deliverable_legacy_value");
    expect(auditById.get("trashed-valid-date").before_data.deadline).toBe("2026-09-04");

    await expectDatabaseError(
      () => client.query("update public.tasks set deadline = 'Sprint 9' where id = 'valid-date'"),
      "23514",
      /tasks_legacy_schedule_empty_check/,
    );
    await expectDatabaseError(
      () => client.query("update public.tasks set fixed_date = '2026-09-05' where id = 'sub-issue-date'"),
      "23514",
      /tasks_fixed_date_deliverable_check/,
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
    expect(created.rows[0].result.task.fixed_date).toBe("2026-09-05");

    await expectDatabaseError(
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
      "22023",
      /unsupported columns/,
    );

    const updatedAt = await client.query(
      "select updated_at::text as updated_at from public.tasks where id = 'rpc-fixed-date'",
    );
    const updated = await client.query(
      "select public.update_task_transaction($1, $2, $3::jsonb) as result",
      ["rpc-fixed-date", updatedAt.rows[0].updated_at, JSON.stringify({ fixed_date: "2026-09-06" })],
    );
    expect(updated.rows[0].result.task.fixed_date).toBe("2026-09-06");

    await client.query(`
      insert into public.team_task_intake_tokens (
        id, profile_id, label, token_hash, token_hint, expires_at
      ) values (
        '40000000-0000-0000-0000-000000000001',
        'migration-founder',
        'Migration token',
        repeat('a', 64),
        'token123',
        clock_timestamp() + interval '1 day'
      )
    `);
    const replayContracts = await client.query(`
      with intake as (
        insert into public.team_task_intake_batches (
          token_id, profile_id, idempotency_key, request_hash, task_ids
        ) values (
          '40000000-0000-0000-0000-000000000001',
          'migration-founder',
          '40000000-0000-0000-0000-000000000002',
          repeat('b', 64),
          array['valid-date']
        ) returning contract_version
      ), updated as (
        insert into public.team_planning_item_update_requests (
          token_id, profile_id, item_type, item_id, expected_updated_at,
          idempotency_key, request_hash, response
        ) values (
          '40000000-0000-0000-0000-000000000001',
          'migration-founder',
          'deliverable',
          'valid-date',
          clock_timestamp(),
          '40000000-0000-0000-0000-000000000003',
          repeat('c', 64),
          '{}'::jsonb
        ) returning contract_version
      ), deleted as (
        insert into public.team_planning_item_delete_requests (
          token_id, profile_id, item_id, expected_updated_at,
          idempotency_key, request_hash, response
        ) values (
          '40000000-0000-0000-0000-000000000001',
          'migration-founder',
          'valid-date',
          clock_timestamp(),
          '40000000-0000-0000-0000-000000000004',
          repeat('d', 64),
          '{}'::jsonb
        ) returning contract_version
      )
      select
        (select contract_version from intake) as intake,
        (select contract_version from updated) as updated,
        (select contract_version from deleted) as deleted
    `);
    expect(replayContracts.rows[0]).toEqual({ intake: 3, updated: 3, deleted: 3 });
    await expect(client.query(`
      insert into public.team_task_intake_batches (
        token_id, profile_id, idempotency_key, request_hash, task_ids, contract_version
      ) values (
        '40000000-0000-0000-0000-000000000001',
        'migration-founder',
        '40000000-0000-0000-0000-000000000005',
        repeat('e', 64),
        array['valid-date'],
        4
      )
    `)).rejects.toMatchObject({ code: "23514" });

    const activeProjection = await client.query(
      "select fixed_date::text as fixed_date from public.active_tasks where id = 'valid-date'",
    );
    expect(activeProjection.rows).toEqual([{ fixed_date: "2026-09-03" }]);

    await applyMigration(client, migrationFile);
    const auditAfterReplay = await client.query(`
      select count(*)::integer as count
      from public.audit_log
      where action = 'task.schedule_legacy_normalized'
    `);
    expect(auditAfterReplay.rows[0].count).toBe(7);
  });
});
