import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

const previousVersion = "20260923071803";
const migrationFile = resolve(process.cwd(), "supabase/migrations/20260924135045_github_mention_team_and_review_delivery.sql");
const users = {
  administrator: "20000000-0000-0000-0000-000000000001",
  founder: "20000000-0000-0000-0000-000000000002",
  inactiveViewer: "20000000-0000-0000-0000-000000000003",
};

async function asAuthenticated(client, authUserId, callback) {
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [authUserId]);
  await client.query("select set_config('request.jwt.claim.role', 'authenticated', false)");
  await client.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: authUserId, role: "authenticated" })]);
  await client.query("set role authenticated");
  try {
    return await callback();
  } finally {
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', '', false)");
    await client.query("select set_config('request.jwt.claim.role', '', false)");
    await client.query("select set_config('request.jwt.claims', '', false)");
  }
}

it("adds validated mentions, atomic notification commands, and a protected review delivery outbox", { timeout: 120_000 }, async () => {
  await resetLocalDatabaseTo(previousVersion);
  await withLocalDatabase(async (client) => {
    await client.query(`
      insert into auth.users (id) values
        ('${users.administrator}'),
        ('${users.founder}'),
        ('${users.inactiveViewer}');
      insert into public.projects (
        id, name, github_project_owner, github_project_number
      ) values (
        'mention-test-project', 'Mention test', 'findmydoc-platform', 21
      );
      insert into public.profiles (id, auth_user_id, name, platform_role, github_login)
      values
        ('mention-admin', '${users.administrator}', 'Mention Admin', 'viewer', 'mention-admin'),
        ('mention-reviewer', '${users.founder}', 'Reviewer', 'founder', 'mention-reviewer'),
        ('mention-inactive-viewer', '${users.inactiveViewer}', 'Inactive Viewer', 'viewer', 'inactive-viewer');
      insert into public.profiles (id, name, platform_role, github_login)
      values
        ('mention-other', 'Other Founder', 'founder', 'mention-other'),
        ('mention-ceo', 'Mention CEO', 'ceo', 'mention-ceo');
      insert into public.administrator_access_grants (profile_id, eligible, active_until)
      values
        ('mention-admin', true, clock_timestamp() + interval '1 hour'),
        ('mention-inactive-viewer', true, null);
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee, task_type, approval_status
      ) values (
        'mention-initiative', 'mention-test-project', 'Mention initiative', 'Offen', 'P2',
        'mention-reviewer', 'mention-reviewer', 'initiative', 'approved'
      );
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee,
        task_type, approval_status, score_relevant, github_repo, parent_task_id
      ) values (
        'mention-task', 'mention-test-project', 'Mention task', 'Review', 'P2',
        'mention-reviewer', 'mention-reviewer', 'deliverable', 'approved', false,
        'findmydoc-platform/management', 'mention-initiative'
      );
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee,
        task_type, approval_status, score_relevant, parent_task_id
      ) values (
        'mention-related-task', 'mention-test-project', 'Related task', 'Offen', 'P2',
        'mention-reviewer', 'mention-reviewer', 'deliverable', 'approved', false,
        'mention-initiative'
      );
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee,
        task_type, approval_status, score_relevant, parent_task_id
      ) values (
        'mention-foreign-task', 'mention-test-project', 'Foreign task', 'Offen', 'P2',
        null, null, 'deliverable', 'approved', false, 'mention-initiative'
      );
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee,
        task_type, approval_status, score_relevant, parent_task_id
      ) values (
        'mention-sub-issue', 'mention-test-project', 'Mention sub-issue', 'Offen', 'P2',
        'mention-reviewer', 'mention-reviewer', 'sub_issue', 'approved', false,
        'mention-task'
      );
    `);

    await applyMigration(client, migrationFile);

    await client.query(`
      update public.projects
      set github_mention_team_slug = 'founderops'
      where id = 'mention-test-project';
    `);
    await expect(client.query(`
      update public.projects
      set github_mention_team_slug = 'Invalid Team'
      where id = 'mention-test-project';
    `)).rejects.toMatchObject({ code: "23514" });

    const savedProject = await asAuthenticated(client, users.administrator, () => client.query(`
      select public.update_administration_github_project_transaction_v2(
        'mention-test-project',
        'findmydoc-platform',
        21,
        'founderops',
        'findmydoc-platform',
        22,
        null,
        null,
        'migration test'
      ) as result
    `));
    expect(savedProject.rows[0].result.project).toMatchObject({
      id: "mention-test-project",
      githubProjectOwner: "findmydoc-platform",
      githubProjectNumber: 22,
      githubMentionTeamSlug: null,
    });

    await expect(asAuthenticated(client, users.inactiveViewer, () => client.query(`
      select public.update_administration_github_project_transaction_v2(
        'mention-test-project', 'findmydoc-platform', 22, null,
        'findmydoc-platform', 23, null, null, 'migration test'
      )
    `))).rejects.toMatchObject({ code: "42501" });
    await expect(asAuthenticated(client, users.founder, () => client.query(`
      select public.report_task_blocker_transaction_v2(
        'mention-related-task', 'mention-reviewer', 'Blocked task', '', '',
        '[]'::jsonb, '{}'::text[], null, 'migration test'
      )
    `))).rejects.toMatchObject({ code: "42501" });

    await client.query(`
      select public.create_browser_planning_item_transaction_v2(
        '{"id":"mention-epic","project_id":"mention-test-project","task_type":"epic","title":"Mention epic","description":"Hello @mention-reviewer","status":"Offen","owner":"mention-reviewer","assignee":"mention-reviewer","sort_order":0}'::jsonb,
        null,
        '[]'::jsonb,
        '[{"type":"task.mention","actor_profile_id":"mention-ceo","recipient_profile_id":"mention-reviewer","entity_type":"task","entity_id":"mention-epic","title":"In einem Aufgabenfeld erwähnt: Mention epic","body":"Hello @mention-reviewer","dedupe_key":"task.mention:field:mention-epic:description:created:mention-reviewer","target_path":"/tasks/mention-epic?focus=field:description"}]'::jsonb,
        'mention-ceo',
        null,
        'migration test'
      )
    `);
    const createMention = await client.query(`
      select target_path
      from public.notification_events
      where dedupe_key = 'task.mention:field:mention-epic:description:created:mention-reviewer'
    `);
    expect(createMention.rows[0].target_path).toBe("/tasks/mention-epic?focus=field:description");

    await asAuthenticated(client, users.administrator, () => client.query(`
      select public.update_administrator_planning_item_transaction_v2(
        'mention-initiative',
        (select updated_at from public.tasks where id = 'mention-initiative'),
        '{"description":"Hello @mention-reviewer"}'::jsonb,
        '{}'::jsonb,
        '[]'::jsonb,
        jsonb_build_array(jsonb_build_object(
          'type', 'task.mention',
          'actor_profile_id', 'mention-admin',
          'recipient_profile_id', 'mention-reviewer',
          'entity_type', 'task',
          'entity_id', 'mention-initiative',
          'title', 'In einem Aufgabenfeld erwähnt: Mention initiative',
          'body', 'Hello @mention-reviewer',
          'dedupe_key', 'task.mention:field:mention-initiative:description:migration:mention-reviewer',
          'target_path', '/tasks/mention-initiative?focus=field:description'
        )),
        null,
        'migration test'
      )
    `));

    await expect(asAuthenticated(client, users.administrator, () => client.query(`
      select public.update_administrator_planning_item_transaction_v2(
        'mention-initiative',
        (select updated_at from public.tasks where id = 'mention-initiative'),
        '{"description":"Forged notification"}'::jsonb,
        '{}'::jsonb,
        '[]'::jsonb,
        '[{"type":"task.mention","actor_profile_id":"mention-reviewer","recipient_profile_id":"mention-reviewer","entity_type":"task","entity_id":"mention-initiative","title":"Forged","body":"Forged","dedupe_key":"forged","target_path":"/tasks/another-task"}]'::jsonb,
        null,
        'migration test'
      )
    `))).rejects.toMatchObject({ code: "22023" });
    const rolledBackStrategicUpdate = await client.query(`
      select description from public.tasks where id = 'mention-initiative'
    `);
    expect(rolledBackStrategicUpdate.rows[0].description).toBe("Hello @mention-reviewer");

    const relationship = await asAuthenticated(client, users.administrator, () => client.query(`
      select public.mutate_administrator_planning_relationship_transaction_v2(
        'add',
        'mention-task',
        'mention-related-task',
        'relates_to',
        null,
        'Please check @mention-reviewer',
        (select updated_at from public.tasks where id = 'mention-task'),
        'mention-admin',
        array['mention-reviewer'],
        null,
        'migration test'
      ) as result
    `));
    const relationshipId = relationship.rows[0].result.relation.id;

    const atomicNotifications = await client.query(`
      select dedupe_key, target_path
      from public.notification_events
      where dedupe_key in (
        'task.mention:field:mention-initiative:description:migration:mention-reviewer',
        'task.mention:relation:' || $1 || ':mention-reviewer'
      )
      order by dedupe_key
    `, [relationshipId]);
    expect(atomicNotifications.rows).toEqual([
      {
        dedupe_key: "task.mention:field:mention-initiative:description:migration:mention-reviewer",
        target_path: "/tasks/mention-initiative?focus=field:description",
      },
      {
        dedupe_key: `task.mention:relation:${relationshipId}:mention-reviewer`,
        target_path: `/tasks/mention-task?focus=relation:${relationshipId}`,
      },
    ]);

    await expect(client.query(`
      select public.report_task_blocker_transaction_v2(
        'mention-related-task',
        'mention-reviewer',
        'Blocked by @mention-admin',
        'Release is delayed',
        'mention-admin',
        '[{"type":"task.mention","actor_profile_id":"mention-reviewer","recipient_profile_id":"missing-profile","entity_type":"task","entity_id":"mention-related-task","title":"Blocked","body":"Blocked","dedupe_key":"rollback-check","target_path":"/tasks/mention-related-task"}]'::jsonb,
        array['mention-admin'],
        null,
        'migration test'
      )
    `)).rejects.toMatchObject({ code: "23503" });

    const rolledBackBlocker = await client.query(`
      select
        (select count(*)::integer from public.task_blockers where task_id = 'mention-related-task') as blocker_count,
        (select status from public.tasks where id = 'mention-related-task') as task_status
    `);
    expect(rolledBackBlocker.rows[0]).toEqual({ blocker_count: 0, task_status: "Offen" });

    await expect(client.query(`
      select public.report_task_blocker_transaction_v2(
        'mention-foreign-task', 'mention-reviewer', 'Blocked foreign task', '', '',
        '[]'::jsonb, '{}'::text[], null, 'migration test'
      )
    `)).rejects.toMatchObject({ code: "42501" });

    const blocker = await client.query(`
      select public.report_task_blocker_transaction_v2(
        'mention-related-task',
        'mention-reviewer',
        'Blocked by @mention-admin',
        'Release is delayed',
        'mention-admin',
        '[]'::jsonb,
        array['mention-admin'],
        null,
        'migration test'
      ) as result
    `);
    const blockerId = blocker.rows[0].result.blocker.id;
    const blockerNotification = await client.query(`
      select target_path
      from public.notification_events
      where dedupe_key = $1
    `, [`task.mention:blocker:${blockerId}:mention-admin`]);
    expect(blockerNotification.rows[0].target_path).toBe(`/tasks/mention-related-task?focus=blocker:${blockerId}`);

    await client.query(`
      update public.tasks
      set review_status = 'requested',
          review_owner_profile_id = 'mention-reviewer',
          review_requested_at = clock_timestamp(),
          review_evidence_exception_note = 'Migration regression setup',
          review_evidence_exception_confirmed_at = clock_timestamp(),
          score_final = false,
          updated_at = clock_timestamp()
      where id = 'mention-task'
    `);
    await expect(client.query(`
      select public.report_task_blocker_transaction_v2(
        'mention-sub-issue', 'mention-reviewer', 'Blocked child task', '', '',
        '[]'::jsonb, '{}'::text[], null, 'migration test'
      )
    `)).rejects.toMatchObject({ code: "P0010" });
    const lockedChild = await client.query(`
      select
        (select count(*)::integer from public.task_blockers where task_id = 'mention-sub-issue') as blocker_count,
        (select status from public.tasks where id = 'mention-sub-issue') as task_status
    `);
    expect(lockedChild.rows[0]).toEqual({ blocker_count: 0, task_status: "Offen" });

    await client.query(`
      select public.mutate_planning_review_command_transaction_v3(
        'withdraw',
        'mention-task',
        (select updated_at from public.tasks where id = 'mention-task'),
        'mention-reviewer',
        null,
        null,
        null,
        '{}'::jsonb,
        null,
        'Need input from @mention-admin',
        '[]'::jsonb,
        null,
        array['Review zurückgezogen'],
        '[]'::jsonb,
        array['mention-admin'],
        '{}'::jsonb,
        null,
        'migration test'
      )
    `);
    const withdrawalAudit = await client.query(`
      select id
      from public.audit_log
      where entity_type = 'task'
        and entity_id = 'mention-task'
        and action = 'task.review.withdraw'
      order by id desc
      limit 1
    `);
    const withdrawalActivityId = withdrawalAudit.rows[0].id;
    const withdrawalNotification = await client.query(`
      select target_path
      from public.notification_events
      where dedupe_key = $1
    `, [`task.mention:review-withdraw:${withdrawalActivityId}:mention-admin`]);
    expect(withdrawalNotification.rows[0].target_path).toBe(`/tasks/mention-task?focus=activity:${withdrawalActivityId}`);

    const review = await client.query(`
      insert into public.task_reviews (
        task_id, reviewer_profile_id, decision, points, comment, checklist
      ) values (
        'mention-task', 'mention-reviewer', 'accepted', 10, 'Danke @all', '{}'::jsonb
      ) returning id
    `);
    const delivery = await client.query(`
      select task_review_id, task_id, author_profile_id, status
      from public.task_review_github_deliveries
      where task_review_id = $1
    `, [review.rows[0].id]);
    expect(delivery.rows).toEqual([{
      task_review_id: review.rows[0].id,
      task_id: "mention-task",
      author_profile_id: "mention-reviewer",
      status: "pending",
    }]);

    await client.query("set role authenticated");
    await expect(client.query("select * from public.task_review_github_deliveries")).rejects.toMatchObject({ code: "42501" });
    await client.query("reset role");

    const executePrivileges = await client.query(`
      select routine_name, grantee
      from information_schema.routine_privileges
      where routine_schema = 'public'
        and routine_name in (
          'mutate_planning_review_command_transaction_v3',
          'update_browser_planning_task_transaction_v2',
          'update_administration_github_project_transaction_v2',
          'update_browser_planning_item_transaction_v2',
          'update_administrator_planning_item_transaction_v2',
          'mutate_planning_relationship_transaction_v2',
          'mutate_administrator_planning_relationship_transaction_v2',
          'report_task_blocker_transaction_v2',
          'update_administrator_planning_task_transaction_v2',
          'create_browser_planning_item_transaction_v2'
        )
        and privilege_type = 'EXECUTE'
      order by routine_name, grantee
    `);
    expect(executePrivileges.rows.some((row) => ["PUBLIC", "anon"].includes(row.grantee))).toBe(false);
    expect(executePrivileges.rows.filter((row) => row.grantee === "authenticated")).toHaveLength(4);
    expect(new Set(executePrivileges.rows.map((row) => row.routine_name)).size).toBe(10);

    const internalPrivileges = await client.query(`
      select routine_name, grantee
      from information_schema.routine_privileges
      where routine_schema = 'public'
        and routine_name in (
          'claim_task_review_github_deliveries',
          'finalize_task_review_github_delivery',
          'insert_task_mention_notifications',
          'canonicalize_administrator_task_mention_notifications'
        )
        and privilege_type = 'EXECUTE'
      order by routine_name, grantee
    `);
    expect(internalPrivileges.rows.some((row) => ["PUBLIC", "anon", "authenticated"].includes(row.grantee))).toBe(false);
  });
});
