import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  applyMigration,
  resetLocalDatabaseTo,
  withLocalDatabase,
} from "./helpers/migration-test-harness.mjs";

const previousVersion = "20260912121704";
const migrationFile = resolve(
  process.cwd(),
  "supabase/migrations/20260917073842_add_review_evidence_gate.sql",
);

async function seedTasks(client) {
  await client.query(`
    insert into public.projects (id, name)
    values ('findmydoc-founder-execution', 'FounderOps')
    on conflict (id) do nothing
  `);
  await client.query(`
    insert into public.profiles (id, name, role, platform_role)
    values ('migration-ceo', 'Migration CEO', 'member', 'ceo')
  `);
  await client.query("set session_replication_role = replica");
  await client.query(`
    insert into public.tasks (
      id, project_id, title, status, priority, owner, assignee,
      task_type, approval_status, github_repo, score_relevant, created_by
    ) values
      ('review-deliverable', 'findmydoc-founder-execution', 'Review deliverable', 'Offen', 'P2',
       'migration-ceo', 'migration-ceo', 'deliverable', 'approved',
       'findmydoc-platform/management', false, 'migration-ceo'),
      ('review-sub-issue', 'findmydoc-founder-execution', 'Review sub-issue', 'Offen', 'P2',
       'migration-ceo', 'migration-ceo', 'sub_issue', null,
       'findmydoc-platform/management', false, 'migration-ceo')
  `);
  await client.query("set session_replication_role = origin");
}

it.sequential("enforces evidence for deliverables", {
  timeout: 120_000,
}, async () => {
  await resetLocalDatabaseTo(previousVersion);

  await withLocalDatabase(async (client) => {
    await seedTasks(client);
    await applyMigration(client, migrationFile);
    await client.query("select set_config('app.planning_hierarchy_backfill', 'true', false)");

    const gateState = await client.query(`
      select task.id,
             task.task_type,
             task.status,
             task.evidence_link,
             task.review_evidence_exception_note,
             task.review_evidence_exception_confirmed_at,
             public.has_valid_planning_review_evidence(task.id) as has_evidence,
             current_setting('session_replication_role') as replication_role,
             trigger.tgenabled as trigger_enabled
      from public.tasks task
      join pg_trigger trigger
        on trigger.tgrelid = 'public.tasks'::regclass
       and trigger.tgname = 'tasks_review_evidence_gate'
      where task.id = 'review-deliverable'
    `);
    expect(gateState.rows[0]).toEqual({
      id: "review-deliverable",
      task_type: "deliverable",
      status: "Offen",
      evidence_link: null,
      review_evidence_exception_note: null,
      review_evidence_exception_confirmed_at: null,
      has_evidence: false,
      replication_role: "origin",
      trigger_enabled: "O",
    });

    await expect(client.query(`
      update public.tasks
      set status = 'Review', review_status = 'requested'
      where id = 'review-deliverable'
    `)).rejects.toMatchObject({ code: "P0017" });

    await client.query(`
      update public.tasks
      set status = 'Review',
          review_status = 'requested',
          evidence_link = 'https://example.com/legacy-evidence'
      where id = 'review-deliverable'
    `);
    await client.query(`
      update public.tasks
      set status = 'Offen',
          review_status = 'not_requested',
          evidence_link = null
      where id = 'review-deliverable'
    `);

    await client.query(`
      insert into public.task_links (task_id, type, label, url)
      values ('review-deliverable', 'github_issue', 'Issue', 'https://github.com/findmydoc-platform/management/issues/1')
    `);
    await expect(client.query(`
      update public.tasks
      set status = 'Review', review_status = 'requested'
      where id = 'review-deliverable'
    `)).rejects.toMatchObject({ code: "P0017" });

    await client.query(`
      insert into public.task_links (task_id, type, label, url, metadata)
      values (
        'review-deliverable',
        'github_pull_request',
        'Pull request',
        'https://github.com/findmydoc-platform/website/pull/42',
        '{}'::jsonb
      )
    `);
    await expect(client.query(`
      update public.tasks
      set status = 'Review', review_status = 'requested'
      where id = 'review-deliverable'
    `)).rejects.toMatchObject({ code: "P0017" });

    await client.query(`
      update public.task_links
      set metadata = '{"repository":"findmydoc-platform/website","number":42,"status":"merged"}'::jsonb
      where task_id = 'review-deliverable'
        and type = 'github_pull_request'
    `);
    await client.query(`
      update public.tasks
      set status = 'Review', review_status = 'requested'
      where id = 'review-deliverable'
    `);

    const withEvidence = await client.query(`
      select status, review_evidence_exception_note, review_evidence_exception_confirmed_at
      from public.tasks
      where id = 'review-deliverable'
    `);
    expect(withEvidence.rows[0]).toEqual({
      status: "Review",
      review_evidence_exception_note: null,
      review_evidence_exception_confirmed_at: null,
    });

  });
});

it.sequential("stores one review exception, clears it after review, and keeps RPCs service-only", {
  timeout: 120_000,
}, async () => {
  await resetLocalDatabaseTo(previousVersion);

  await withLocalDatabase(async (client) => {
    await seedTasks(client);
    await applyMigration(client, migrationFile);
    await client.query("select set_config('app.planning_hierarchy_backfill', 'true', false)");

    await client.query(`
      update public.tasks
      set status = 'Review',
          review_status = 'requested',
          review_evidence_exception_note = 'Accepted in the founder meeting.',
          review_evidence_exception_confirmed_at = clock_timestamp()
      where id = 'review-deliverable'
    `);
    const inReview = await client.query(`
      select review_evidence_exception_note,
             review_evidence_exception_confirmed_at is not null as confirmed
      from public.active_tasks
      where id = 'review-deliverable'
    `);
    expect(inReview.rows[0]).toEqual({
      review_evidence_exception_note: "Accepted in the founder meeting.",
      confirmed: true,
    });

    await client.query(`
      update public.tasks
      set status = 'Offen', review_status = 'not_requested'
      where id = 'review-deliverable'
    `);
    const afterReview = await client.query(`
      select review_evidence_exception_note, review_evidence_exception_confirmed_at
      from public.tasks
      where id = 'review-deliverable'
    `);
    expect(afterReview.rows[0]).toEqual({
      review_evidence_exception_note: null,
      review_evidence_exception_confirmed_at: null,
    });

    const privileges = await client.query(`
      select
        has_function_privilege(
          'authenticated',
          'public.mutate_planning_review_command_transaction_v2(text,text,timestamptz,text,text,text,text,jsonb,integer,text,jsonb,text,text[],jsonb,jsonb,text,text)',
          'EXECUTE'
        ) as authenticated_review,
        has_function_privilege(
          'service_role',
          'public.mutate_planning_review_command_transaction_v2(text,text,timestamptz,text,text,text,text,jsonb,integer,text,jsonb,text,text[],jsonb,jsonb,text,text)',
          'EXECUTE'
        ) as service_review,
        has_function_privilege(
          'authenticated',
          'public.update_team_planning_item_with_review_evidence_transaction_v1(uuid,text,text,text,timestamptz,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text,text)',
          'EXECUTE'
        ) as authenticated_planning_item,
        has_function_privilege(
          'service_role',
          'public.update_team_planning_item_with_review_evidence_transaction_v1(uuid,text,text,text,timestamptz,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text,text)',
          'EXECUTE'
        ) as service_planning_item
    `);
    expect(privileges.rows[0]).toEqual({
      authenticated_review: false,
      service_review: true,
      authenticated_planning_item: false,
      service_planning_item: true,
    });

    await applyMigration(client, migrationFile);
  });
});
