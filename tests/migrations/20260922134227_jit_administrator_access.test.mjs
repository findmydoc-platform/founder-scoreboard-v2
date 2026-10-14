import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  applyMigration,
  resetLocalDatabaseTo,
  withLocalDatabase,
} from "./helpers/migration-test-harness.mjs";

const previousVersion = "20260827093325";
const migrationFile = resolve(
  process.cwd(),
  "supabase/migrations/20260922134227_jit_administrator_access.sql",
);

const users = {
  ceo: "10000000-0000-0000-0000-000000000001",
  founder: "10000000-0000-0000-0000-000000000002",
  viewer: "10000000-0000-0000-0000-000000000003",
  deputy: "10000000-0000-0000-0000-000000000004",
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

async function asServiceRole(client, callback) {
  await client.query("select set_config('request.jwt.claim.role', 'service_role', false)");
  await client.query("select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false)");
  await client.query("set role service_role");
  try {
    return await callback();
  } finally {
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.role', '', false)");
    await client.query("select set_config('request.jwt.claims', '', false)");
  }
}

async function writeDirectTaskMetadata(client, suffix) {
  await client.query(
    "insert into public.task_dependencies (task_id, note) values ('admin-correction-task', $1)",
    [`dependency-${suffix}`],
  );
  await client.query(
    "insert into public.task_links (task_id, type, label, url) values ('admin-correction-task', 'evidence', $1, $2)",
    [`link-${suffix}`, `https://example.com/${suffix}`],
  );
  await client.query(
    "insert into public.task_notes (task_id, note) values ('admin-correction-task', $1)",
    [`note-${suffix}`],
  );
  await client.query("delete from public.task_dependencies where task_id = 'admin-correction-task' and note = $1", [`dependency-${suffix}`]);
  await client.query("delete from public.task_links where task_id = 'admin-correction-task' and label = $1", [`link-${suffix}`]);
  await client.query("delete from public.task_notes where task_id = 'admin-correction-task'");
}

async function expectDirectTaskMetadataDenied(client, suffix) {
  await expect(client.query(
    "insert into public.task_dependencies (task_id, note) values ('admin-correction-task', $1)",
    [`dependency-${suffix}`],
  )).rejects.toMatchObject({ code: "42501" });
  await expect(client.query(
    "insert into public.task_links (task_id, type, label, url) values ('admin-correction-task', 'evidence', $1, $2)",
    [`link-${suffix}`, `https://example.com/${suffix}`],
  )).rejects.toMatchObject({ code: "42501" });
  await expect(client.query(
    "insert into public.task_notes (task_id, note) values ('admin-correction-task', $1)",
    [`note-${suffix}`],
  )).rejects.toMatchObject({ code: "42501" });
}

it("adds atomic JIT administrator access and removes only the legacy role", {
  timeout: 120_000,
}, async () => {
  await resetLocalDatabaseTo(previousVersion);

  await withLocalDatabase(async (client) => {
    let originalExpiry = "";
    let administratorDeliveryClaim = null;
    await client.query(
      "insert into auth.users (id) select unnest($1::uuid[])",
      [Object.values(users)],
    );
    await client.query(`
      insert into public.profiles (id, auth_user_id, name, role, platform_role)
      values
        ('sebastian', '${users.ceo}', 'Sebastian', 'admin', 'ceo'),
        ('volkan', '${users.founder}', 'Volkan', 'member', 'founder'),
        ('migration-viewer', '${users.viewer}', 'Viewer', 'viewer', 'viewer'),
        ('migration-deputy', '${users.deputy}', 'Deputy', 'member', 'deputy')
    `);

    await applyMigration(client, migrationFile);

    await client.query(`
      update public.profiles
      set github_login = case id when 'sebastian' then 'sebastian' when 'volkan' then 'volkan' else github_login end,
          google_chat_user_id = case id when 'sebastian' then 'sebastian@example.com' when 'volkan' then 'volkan@example.com' else google_chat_user_id end,
          google_chat_dm_space = case id when 'sebastian' then 'spaces/sebastian' when 'volkan' then 'spaces/volkan' else google_chat_dm_space end
      where id in ('sebastian', 'volkan')
    `);

    await client.query(`
      insert into public.projects (id, name)
      values ('admin-correction-project', 'Admin correction')
      on conflict (id) do nothing;
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee,
        task_type, approval_status, score_relevant, github_repo
      ) values (
        'admin-correction-initiative', 'admin-correction-project', 'Correction initiative',
        'Offen', 'P2', 'sebastian', 'sebastian', 'initiative', 'approved', false,
        null
      );
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee,
        task_type, approval_status, score_relevant, github_repo, parent_task_id
      ) values (
        'admin-correction-task', 'admin-correction-project', 'Original title',
        'Offen', 'P2', 'sebastian', 'sebastian', 'deliverable', 'approved', false,
        'findmydoc-platform/management', 'admin-correction-initiative'
      );
      insert into public.sprints (id, project_id, name, status, score_locked)
      values
        ('admin-sprint-open', 'admin-correction-project', 'Open sprint', 'planning', false),
        ('admin-sprint-target-locked', 'admin-correction-project', 'Locked target', 'closed', true),
        ('admin-sprint-source-locked', 'admin-correction-project', 'Locked source', 'closed', true);
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee,
        task_type, approval_status, score_relevant, github_repo, parent_task_id, sprint_id
      ) values (
        'admin-source-locked-task', 'admin-correction-project', 'Locked source task',
        'Offen', 'P2', 'sebastian', 'sebastian', 'deliverable', 'approved', true,
        'findmydoc-platform/management', 'admin-correction-initiative', 'admin-sprint-source-locked'
      );
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee,
        task_type, approval_status, score_relevant, github_repo, parent_task_id,
        review_status, score_final
      ) values (
        'admin-final-parent', 'admin-correction-project', 'Final parent',
        'Review', 'P2', 'sebastian', 'sebastian', 'deliverable', 'approved', false,
        'findmydoc-platform/management', 'admin-correction-initiative', 'not_requested', false
      );
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee,
        task_type, approval_status, score_relevant, github_repo, parent_task_id
      ) values (
        'admin-final-child', 'admin-correction-project', 'Final child',
        'Offen', 'P2', 'sebastian', 'sebastian', 'sub_issue', null, false,
        'findmydoc-platform/management', 'admin-final-parent'
      );
      update public.tasks
      set review_status = 'accepted', score_final = true
      where id = 'admin-final-parent';
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee,
        task_type, approval_status, score_relevant, github_repo, parent_task_id
      ) values (
        'admin-unapproved-parent', 'admin-correction-project', 'Unapproved parent',
        'Offen', 'P2', 'sebastian', 'sebastian', 'deliverable', 'approved', false,
        'findmydoc-platform/management', 'admin-correction-initiative'
      );
      insert into public.tasks (
        id, project_id, title, status, priority, owner, assignee,
        task_type, approval_status, score_relevant, github_repo, parent_task_id
      ) values (
        'admin-unapproved-child', 'admin-correction-project', 'Unapproved child',
        'Offen', 'P2', 'sebastian', 'sebastian', 'sub_issue', null, false,
        'findmydoc-platform/management', 'admin-unapproved-parent'
      );
      update public.tasks
      set approval_status = 'draft'
      where id = 'admin-unapproved-parent';
    `);

    const profiles = await client.query(
      "select id, platform_role from public.profiles order by id",
    );
    expect(profiles.rows).toEqual([
      { id: "migration-deputy", platform_role: "deputy" },
      { id: "migration-viewer", platform_role: "viewer" },
      { id: "sebastian", platform_role: "ceo" },
      { id: "volkan", platform_role: "founder" },
    ]);
    const legacyColumn = await client.query(`
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'role'
    `);
    expect(legacyColumn.rowCount).toBe(0);

    const seeded = await client.query(`
      select profile_id, eligible, active_until
      from public.administrator_access_grants
      order by profile_id
    `);
    expect(seeded.rows).toEqual([
      { profile_id: "sebastian", eligible: true, active_until: null },
      { profile_id: "volkan", eligible: true, active_until: null },
    ]);

    await asAuthenticated(client, users.ceo, async () => {
      const governanceUpdate = await client.query(`
        select public.update_profile_governance_transaction(
          'volkan', '{"weekly_capacity":31}'::jsonb, null, null
        ) as result
      `);
      expect(governanceUpdate.rows[0].result.profile).toEqual({
        id: "volkan",
        name: "Volkan",
        platform_role: "founder",
        org_role: null,
        deputy_for: null,
        deputy_active_from: null,
        deputy_active_until: null,
        weekly_capacity: 31,
      });
      expect(governanceUpdate.rows[0].result.profile).not.toHaveProperty("auth_user_id");
      expect(governanceUpdate.rows[0].result.profile).not.toHaveProperty("github_login");
      const governanceAudit = await client.query(`
        select before_data, after_data
        from public.audit_log
        where action = 'profile.governance.update' and entity_id = 'volkan'
        order by id desc
        limit 1
      `);
      expect(governanceAudit.rows[0].before_data).not.toHaveProperty("auth_user_id");
      expect(governanceAudit.rows[0].before_data).not.toHaveProperty("github_login");
      expect(governanceAudit.rows[0].after_data).not.toHaveProperty("auth_user_id");
      expect(governanceAudit.rows[0].after_data).not.toHaveProperty("github_login");
    });

    const concurrentActivations = await Promise.all([
      withLocalDatabase((activationClient) => asAuthenticated(
        activationClient,
        users.founder,
        () => activationClient.query("select public.activate_administrator_access() as access"),
      )),
      withLocalDatabase((activationClient) => asAuthenticated(
        activationClient,
        users.founder,
        () => activationClient.query("select public.activate_administrator_access() as access"),
      )),
    ]);
    expect(concurrentActivations[0].rows[0].access.active).toBe(true);
    expect(concurrentActivations[1].rows[0].access.expiresAt)
      .toBe(concurrentActivations[0].rows[0].access.expiresAt);
    originalExpiry = concurrentActivations[0].rows[0].access.expiresAt;

    await asAuthenticated(client, users.founder, async () => {
      expect((await client.query("select public.current_profile_has_active_administrator_access() as active")).rows[0].active).toBe(true);
      const directory = await client.query("select public.administrator_directory_snapshot() as directory");
      expect(directory.rows[0].directory.people.find((person) => person.id === "volkan").githubLogin).toBe("volkan");
      expect(directory.rows[0].directory.project).not.toBeNull();
      await expect(client.query("select github_login from public.profiles"))
        .rejects.toMatchObject({ code: "42501" });
      await expect(client.query(`
        select public.update_profile_technical_identity_transaction(
          'sebastian', '{"notifications_enabled":false}'::jsonb, null, null
        )
      `)).rejects.toMatchObject({ code: "22023" });
      const technicalUpdate = await client.query(`
        select public.update_profile_technical_identity_transaction(
          'sebastian', '{"github_login":"sebastian-updated"}'::jsonb, null, null
        ) as result
      `);
      expect(technicalUpdate.rows[0].result.profile).toEqual({
        id: "sebastian",
        github_login: "sebastian-updated",
        google_chat_user_id: "sebastian@example.com",
        google_chat_dm_space: "spaces/sebastian",
      });
      const technicalAudit = await client.query(`
        select before_data, after_data
        from public.audit_log
        where action = 'profile.technical_identity.update' and entity_id = 'sebastian'
        order by id desc
        limit 1
      `);
      expect(technicalAudit.rows[0].before_data).not.toHaveProperty("auth_user_id");
      expect(technicalAudit.rows[0].after_data).not.toHaveProperty("auth_user_id");

      const task = await client.query("select updated_at::text from public.tasks where id = 'admin-correction-task'");
      const corrected = await client.query(`
        select public.update_administrator_planning_task_transaction(
          'admin-correction-task', $1, '{"title":"Corrected title"}'::jsonb,
          false, null, false, null, array[]::text[], '[]'::jsonb
        ) as result
      `, [task.rows[0].updated_at]);
      expect(corrected.rows[0].result.task.title).toBe("Corrected title");
      await expect(client.query(`
        select public.update_administrator_planning_task_transaction(
          'admin-correction-task', (select updated_at from public.tasks where id = 'admin-correction-task'),
          '{"review_owner_profile_id":"volkan"}'::jsonb,
          false, null, false, null, array[]::text[], '[]'::jsonb
        )
      `)).rejects.toMatchObject({ code: "42501" });
      await expect(client.query(`
        select public.update_administrator_planning_task_transaction(
          'admin-correction-task', (select updated_at from public.tasks where id = 'admin-correction-task'),
          '{"status":"Erledigt"}'::jsonb,
          false, null, false, null, array[]::text[], '[]'::jsonb
        )
      `)).rejects.toMatchObject({ code: "P0016" });
      await expect(client.query(`
        select public.update_administrator_planning_task_transaction(
          'admin-unapproved-child', (select updated_at from public.tasks where id = 'admin-unapproved-child'),
          '{"status":"In Arbeit"}'::jsonb,
          false, null, false, null, array[]::text[], '[]'::jsonb
        )
      `)).rejects.toMatchObject({ code: "P0015" });
      await expect(client.query(`
        select public.update_administrator_planning_task_transaction(
          'admin-correction-task', (select updated_at from public.tasks where id = 'admin-correction-task'),
          '{"sprint_id":"admin-sprint-target-locked"}'::jsonb,
          false, null, false, null, array[]::text[], '[]'::jsonb
        )
      `)).rejects.toMatchObject({ code: "P0015" });
      await expect(client.query(`
        select public.update_administrator_planning_task_transaction(
          'admin-source-locked-task', (select updated_at from public.tasks where id = 'admin-source-locked-task'),
          '{"sprint_id":"admin-sprint-open"}'::jsonb,
          false, null, false, null, array[]::text[], '[]'::jsonb
        )
      `)).rejects.toMatchObject({ code: "P0015" });
      await expect(client.query(`
        select public.update_administrator_planning_task_transaction(
          'admin-final-child', (select updated_at from public.tasks where id = 'admin-final-child'),
          '{"title":"Must remain locked"}'::jsonb,
          false, null, false, null, array[]::text[], '[]'::jsonb
        )
      `)).rejects.toMatchObject({ code: "P0010" });
    });

    await asAuthenticated(client, users.ceo, async () => {
      await writeDirectTaskMetadata(client, "ceo");
      const directory = await client.query("select public.administrator_directory_snapshot() as directory");
      expect(directory.rows[0].directory.people.find((person) => person.id === "volkan").githubLogin).toBe("");
      expect(directory.rows[0].directory.project).toBeNull();
      const revoked = await client.query(
        "select public.set_administrator_eligibility('volkan', false) as access",
      );
      expect(revoked.rows[0].access).toMatchObject({ eligible: false, active: false });
      const granted = await client.query(
        "select public.set_administrator_eligibility('volkan', true) as access",
      );
      expect(granted.rows[0].access).toMatchObject({ eligible: true, active: false });
      const viewerGrant = await client.query(
        "select public.set_administrator_eligibility('migration-viewer', true) as access",
      );
      expect(viewerGrant.rows[0].access).toMatchObject({ eligible: true, active: false });
    });

    await asAuthenticated(client, users.founder, async () => {
      await writeDirectTaskMetadata(client, "founder");
    });
    await asAuthenticated(client, users.deputy, async () => {
      await writeDirectTaskMetadata(client, "deputy");
    });
    await asAuthenticated(client, users.viewer, async () => {
      await expectDirectTaskMetadataDenied(client, "viewer-inactive");
      await client.query("select public.activate_administrator_access()");
      await expectDirectTaskMetadataDenied(client, "viewer-active-admin");
      const task = await client.query("select updated_at::text from public.tasks where id = 'admin-correction-task'");
      const correction = await client.query(`
        select public.update_administrator_planning_task_transaction(
          'admin-correction-task', $1, '{"title":"Viewer admin correction"}'::jsonb,
          false, null, false, null, array[]::text[], '[]'::jsonb
        ) as result
      `, [task.rows[0].updated_at]);
      expect(correction.rows[0].result.task.title).toBe("Viewer admin correction");
    });
    await client.query(`
      update public.administrator_access_grants
      set active_until = clock_timestamp()
      where profile_id = 'migration-viewer'
    `);
    await asAuthenticated(client, users.viewer, async () => {
      await expectDirectTaskMetadataDenied(client, "viewer-expired-admin");
    });
    await asAuthenticated(client, users.ceo, async () => {
      await client.query("select public.set_administrator_eligibility('migration-viewer', false)");
    });
    await asAuthenticated(client, users.viewer, async () => {
      await expectDirectTaskMetadataDenied(client, "viewer-revoked-admin");
      await expect(client.query("select public.activate_administrator_access()"))
        .rejects.toMatchObject({ code: "42501" });
    });

    await client.query(`
      update public.administrator_access_grants
      set active_until = clock_timestamp()
      where profile_id = 'volkan'
    `);

    await asAuthenticated(client, users.founder, async () => {
      const snapshot = await client.query("select public.administrator_access_snapshot() as access");
      expect(snapshot.rows[0].access).toEqual({ eligible: true, active: false, expiresAt: null });
      const reactivated = await client.query("select public.activate_administrator_access() as access");
      expect(reactivated.rows[0].access.active).toBe(true);
      expect(Date.parse(reactivated.rows[0].access.expiresAt)).toBeGreaterThan(Date.parse(originalExpiry));
      const claim = await client.query(`
        select public.claim_notification_delivery(
          null, 20, 'direct_dm', 'sebastian'
        ) as claim
      `);
      expect(claim.rows[0].claim.eventIds).toHaveLength(1);
      administratorDeliveryClaim = claim.rows[0].claim;
      const ended = await client.query("select public.end_administrator_access() as access");
      const endedAgain = await client.query("select public.end_administrator_access() as access");
      expect(ended.rows[0].access).toEqual({ eligible: true, active: false, expiresAt: null });
      expect(endedAgain.rows[0].access).toEqual(ended.rows[0].access);
      await expect(client.query(`
        select public.claim_notification_delivery(
          null, 20, 'direct_dm', 'sebastian'
        )
      `)).rejects.toMatchObject({ code: "42501" });
      await expect(client.query(
        "update public.administrator_access_grants set active_until = clock_timestamp() + interval '1 hour' where profile_id = 'volkan'",
      )).rejects.toMatchObject({ code: "42501" });
    });

    await asServiceRole(client, async () => {
      const eventId = administratorDeliveryClaim.eventIds[0];
      const wrongFence = await client.query(`
        select public.finalize_notification_delivery_claim(
          gen_random_uuid(), array[$1]::bigint[]
        ) as finalized
      `, [eventId]);
      expect(wrongFence.rows[0].finalized).toBe(0);

      const duplicateClaim = await client.query(`
        select public.claim_notification_delivery(array[$1]::bigint[], 1, null, null) as claim
      `, [eventId]);
      expect(duplicateClaim.rows[0].claim.eventIds).toEqual([]);

      const finalizedAfterExpiry = await client.query(`
        select public.finalize_notification_delivery_claim($1, array[$2]::bigint[]) as finalized
      `, [administratorDeliveryClaim.claimToken, eventId]);
      expect(finalizedAfterExpiry.rows[0].finalized).toBe(1);

      const retryClaim = await client.query(`
        select public.claim_notification_delivery(array[$1]::bigint[], 1, null, null) as claim
      `, [eventId]);
      expect(retryClaim.rows[0].claim.eventIds).toEqual([eventId]);
      const released = await client.query(
        "select public.release_notification_delivery_claim($1) as released",
        [retryClaim.rows[0].claim.claimToken],
      );
      expect(released.rows[0].released).toBe(1);

      const failedAttemptClaim = await client.query(`
        select public.claim_notification_delivery(array[$1]::bigint[], 1, null, null) as claim
      `, [eventId]);
      await client.query(`
        insert into public.notification_deliveries (
          event_id, channel, status, attempts, last_error, target, payload
        ) values ($1, 'google_chat', 'failed', 1, 'terminal provider failure', 'spaces/test', '{}'::jsonb)
      `, [eventId]);
      await client.query(
        "select public.finalize_notification_delivery_claim($1, array[$2]::bigint[])",
        [failedAttemptClaim.rows[0].claim.claimToken, eventId],
      );
      const immediateRetry = await client.query(`
        select public.claim_notification_delivery(array[$1]::bigint[], 1, null, null) as claim
      `, [eventId]);
      expect(immediateRetry.rows[0].claim.eventIds).toEqual([eventId]);
      await client.query(`
        insert into public.notification_deliveries (
          event_id, channel, status, attempts, delivered_at, target, payload
        ) values ($1, 'google_chat', 'sent', 1, clock_timestamp(), 'spaces/test', '{}'::jsonb)
      `, [eventId]);
      await client.query(
        "select public.finalize_notification_delivery_claim($1, array[$2]::bigint[])",
        [immediateRetry.rows[0].claim.claimToken, eventId],
      );
      const sentCannotBeReclaimed = await client.query(`
        select public.claim_notification_delivery(array[$1]::bigint[], 1, null, null) as claim
      `, [eventId]);
      expect(sentCannotBeReclaimed.rows[0].claim.eventIds).toEqual([]);

      const pipelineTest = await client.query(`
        select public.claim_notification_delivery(null, 1, 'webhook_digest', null) as claim
      `);
      expect(pipelineTest.rows[0].claim.eventIds).toHaveLength(1);
      expect(await client.query(
        "select public.finalize_notification_delivery_claim($1, $2::bigint[]) as finalized",
        [pipelineTest.rows[0].claim.claimToken, pipelineTest.rows[0].claim.eventIds],
      )).toMatchObject({ rows: [{ finalized: 1 }] });
    });

    const testEvents = await client.query(`
      select count(*)::integer as count
      from public.notification_events
      where entity_type = 'google_chat_test'
    `);
    expect(testEvents.rows[0].count).toBe(2);

    await asAuthenticated(client, users.viewer, async () => {
      await expect(client.query(
        "select public.activate_administrator_access()",
      )).rejects.toMatchObject({ code: "42501" });
    });
  });
});
