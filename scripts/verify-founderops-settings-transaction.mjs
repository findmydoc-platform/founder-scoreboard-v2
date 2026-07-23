import pg from "pg";
import { loadLocalEnv } from "./lib/env.mjs";

await loadLocalEnv();

const password = process.env.SUPABASE_DB_PASSWORD;
const host = process.env.SUPABASE_DB_HOST || "db.wmccchyodlljkkytebwg.supabase.co";
const port = Number(process.env.SUPABASE_DB_PORT || "5432");
const user = process.env.SUPABASE_DB_USER || "postgres";
const database = process.env.SUPABASE_DB_NAME || "postgres";

if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD.");
  process.exit(1);
}

const client = new pg.Client({
  host,
  port,
  user,
  password,
  database,
  ssl: host === "127.0.0.1" || host === "localhost" ? false : { rejectUnauthorized: false },
});
const suffix = Date.now();
const projectId = `verify-founderops-settings-${suffix}`;
const ceoId = `${projectId}-ceo`;
const founderId = `${projectId}-founder`;
const activeDeputyId = `${projectId}-active-deputy`;
const inactiveDeputyId = `${projectId}-inactive-deputy`;
const unlockedSprintId = `${projectId}-unlocked`;
const lockedSprintId = `${projectId}-locked`;
const plannedSprintId = `${projectId}-planned`;
const lockedReviewDueAt = "2098-03-20T12:00:00.000Z";

await client.connect();
await client.query("begin");

try {
  const privileges = await client.query(
    `with protected_function(signature) as (
      values
        ('public.update_founderops_review_window_transaction(text,integer,integer,text,text,text)'),
        ('public.update_founderops_github_project_transaction(text,text,integer,text,integer,text,text,text)'),
        ('public.create_sprint_plan_with_review_window_transaction(text,jsonb,jsonb,jsonb,text,text,text)'),
        ('public.update_sprint_schedule_transaction(text,timestamptz,jsonb,text,text,text)'),
        ('public.create_score_objection_transaction(text,text,text,text,text)'),
        ('public.lock_sprint_with_review_window_transaction(text,timestamptz,jsonb,text[],jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,text,text)')
    )
    select signature,
      has_function_privilege('anon', signature::regprocedure, 'execute') as anon_execute,
      has_function_privilege('authenticated', signature::regprocedure, 'execute') as authenticated_execute,
      has_function_privilege('service_role', signature::regprocedure, 'execute') as service_execute
    from protected_function`,
  );
  if (privileges.rows.some((row) => row.anon_execute || row.authenticated_execute || !row.service_execute)) {
    throw new Error("FounderOps transaction EXECUTE grants are broader than service_role.");
  }

  const columnPrivileges = await client.query(
    `select
      has_column_privilege('authenticated', 'public.projects', 'review_objection_window_hours', 'update') as can_update_window,
      has_column_privilege('authenticated', 'public.projects', 'github_project_owner', 'update') as can_update_github_owner,
      has_column_privilege('authenticated', 'public.projects', 'github_project_number', 'update') as can_update_github_number,
      has_column_privilege('authenticated', 'public.projects', 'name', 'update') as can_update_existing_project_field,
      has_table_privilege('authenticated', 'public.sprints', 'insert') as can_insert_sprint,
      has_table_privilege('authenticated', 'public.sprints', 'update') as can_update_sprint,
      has_table_privilege('authenticated', 'public.score_objections', 'insert') as can_insert_objection,
      has_table_privilege('authenticated', 'public.score_objections', 'update') as can_update_objection,
      has_table_privilege('authenticated', 'public.task_reviews', 'insert') as can_insert_task_review`,
  );
  if (
    columnPrivileges.rows[0]?.can_update_window
    || columnPrivileges.rows[0]?.can_update_github_owner
    || columnPrivileges.rows[0]?.can_update_github_number
    || !columnPrivileges.rows[0]?.can_update_existing_project_field
    || columnPrivileges.rows[0]?.can_insert_sprint
    || columnPrivileges.rows[0]?.can_update_sprint
    || columnPrivileges.rows[0]?.can_insert_objection
    || columnPrivileges.rows[0]?.can_update_objection
    || columnPrivileges.rows[0]?.can_insert_task_review
  ) {
    throw new Error("FounderOps project column grants do not preserve the intended boundary.");
  }

  const daylightSaving = await client.query(
    `select
      (((date '2026-03-29' + time '23:59:59.999') at time zone 'Europe/Berlin') + interval '48 hours')::text as spring_due,
      (((date '2026-10-25' + time '23:59:59.999') at time zone 'Europe/Berlin') + interval '48 hours')::text as autumn_due`,
  );
  if (
    new Date(daylightSaving.rows[0]?.spring_due).toISOString() !== "2026-03-31T21:59:59.999Z"
    || new Date(daylightSaving.rows[0]?.autumn_due).toISOString() !== "2026-10-27T22:59:59.999Z"
  ) {
    throw new Error("FounderOps review deadlines do not preserve exact hours across DST boundaries.");
  }

  await client.query(
    `insert into public.profiles (id, name, role, platform_role, deputy_for, deputy_active_from, deputy_active_until)
     values
       ($1, 'FounderOps settings CEO', 'admin', 'ceo', null, null, null),
       ($2, 'FounderOps settings founder', 'member', 'founder', null, null, null),
       ($3, 'FounderOps settings active deputy', 'member', 'deputy', $1,
         ((clock_timestamp() at time zone 'Europe/Berlin')::date - 1),
         ((clock_timestamp() at time zone 'Europe/Berlin')::date + 1)),
       ($4, 'FounderOps settings inactive deputy', 'member', 'deputy', $1,
         ((clock_timestamp() at time zone 'Europe/Berlin')::date - 2),
         ((clock_timestamp() at time zone 'Europe/Berlin')::date - 1))`,
    [ceoId, founderId, activeDeputyId, inactiveDeputyId],
  );
  await client.query(
    `insert into public.projects (id, name, range_label, review_objection_window_hours)
     values ($1, 'FounderOps settings verification', 'Verification', 48)`,
    [projectId],
  );
  await client.query(
    `insert into public.sprints (id, project_id, name, status, start_date, end_date, review_due_at, score_locked)
     values
       ($1, $3, 'Unlocked verification sprint', 'review', '2098-03-01', '2098-03-14', null, false),
       ($2, $3, 'Locked verification sprint', 'closed', '2098-03-01', '2098-03-14', $4, true)`,
    [unlockedSprintId, lockedSprintId, projectId, lockedReviewDueAt],
  );

  const updated = await client.query(
    `select public.update_founderops_review_window_transaction(
      $1, 48, 72, $2, null, 'FounderOps settings transaction verifier'
    ) as result`,
    [projectId, ceoId],
  );
  if (updated.rows[0]?.result?.project?.reviewObjectionWindowHours !== 72) {
    throw new Error("FounderOps settings transaction did not return the saved duration.");
  }

  const persisted = await client.query(
    `select
      (select review_objection_window_hours from public.projects where id = $1) as window_hours,
      (select extract(epoch from (
        review_due_at - ((end_date::date + time '23:59:59.999') at time zone 'Europe/Berlin')
      ))::integer from public.sprints where id = $2) as unlocked_window_seconds,
      (select review_due_at::text from public.sprints where id = $3) as locked_review_due_at,
      (select count(*)::integer from public.audit_log
       where entity_id = $1 and action = 'founderops.review_window.update'
         and user_agent = 'FounderOps settings transaction verifier') as audit_count`,
    [projectId, unlockedSprintId, lockedSprintId],
  );
  if (
    persisted.rows[0]?.window_hours !== 72
    || persisted.rows[0]?.unlocked_window_seconds !== 72 * 60 * 60
    || new Date(persisted.rows[0]?.locked_review_due_at).toISOString() !== lockedReviewDueAt
    || persisted.rows[0]?.audit_count !== 1
  ) {
    throw new Error("FounderOps settings and sprint deadlines were not updated atomically.");
  }

  const deputyGithubProjectUpdate = await client.query(
    `select public.update_founderops_github_project_transaction(
      $1, 'findmydoc-platform', 21, 'findmydoc-platform', 22, $2, null,
      'FounderOps GitHub Project active deputy verifier'
    ) as result`,
    [projectId, activeDeputyId],
  );
  if (
    deputyGithubProjectUpdate.rows[0]?.result?.project?.githubProjectOwner !== "findmydoc-platform"
    || deputyGithubProjectUpdate.rows[0]?.result?.project?.githubProjectNumber !== 22
  ) {
    throw new Error("Active Deputy did not save the FounderOps GitHub Project atomically.");
  }

  await client.query("savepoint stale_github_project_settings");
  try {
    await client.query(
      `select public.update_founderops_github_project_transaction(
        $1, 'findmydoc-platform', 21, 'findmydoc-platform', 23, $2, null,
        'FounderOps GitHub Project stale verifier'
      )`,
      [projectId, ceoId],
    );
    throw new Error("Stale FounderOps GitHub Project update unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "P0001") throw error;
    await client.query("rollback to savepoint stale_github_project_settings");
  }

  for (const [actorId, label] of [[founderId, "Founder"], [inactiveDeputyId, "Inactive Deputy"]]) {
    await client.query(`savepoint github_project_role_guard`);
    try {
      await client.query(
        `select public.update_founderops_github_project_transaction(
          $1, 'findmydoc-platform', 22, 'findmydoc-platform', 23, $2, null,
          'FounderOps GitHub Project role verifier'
        )`,
        [projectId, actorId],
      );
      throw new Error(`${label} unexpectedly changed the FounderOps GitHub Project.`);
    } catch (error) {
      if (error?.code !== "P0005") throw error;
      await client.query(`rollback to savepoint github_project_role_guard`);
    }
  }

  await client.query(
    `select public.update_founderops_github_project_transaction(
      $1, 'findmydoc-platform', 22, 'findmydoc-platform', 21, $2, null,
      'FounderOps GitHub Project CEO verifier'
    )`,
    [projectId, ceoId],
  );
  const githubProjectPersisted = await client.query(
    `select github_project_owner, github_project_number,
      (select count(*)::integer from public.audit_log
       where entity_id = $1 and action = 'founderops.github_project.update') as audit_count
     from public.projects where id = $1`,
    [projectId],
  );
  if (
    githubProjectPersisted.rows[0]?.github_project_owner !== "findmydoc-platform"
    || githubProjectPersisted.rows[0]?.github_project_number !== 21
    || githubProjectPersisted.rows[0]?.audit_count !== 2
  ) {
    throw new Error("FounderOps GitHub Project settings or audit rows were not persisted atomically.");
  }

  await client.query(
    `select public.create_sprint_plan_with_review_window_transaction(
      $1, $2::jsonb, '[]'::jsonb, '{}'::jsonb, $3, null, 'FounderOps sprint plan verifier'
    )`,
    [
      projectId,
      JSON.stringify([{
        id: plannedSprintId,
        project_id: projectId,
        name: "Planned verification sprint",
        status: "planning",
        start_date: "2098-03-15",
        end_date: "2098-03-28",
        review_due_at: "2098-04-30T00:00:00.000Z",
        score_locked: false,
        expected_updated_at: null,
      }]),
      ceoId,
    ],
  );
  const plannedWindow = await client.query(
    `select extract(epoch from (
      review_due_at - ((end_date::date + time '23:59:59.999') at time zone 'Europe/Berlin')
    ))::integer as seconds
    from public.sprints where id = $1`,
    [plannedSprintId],
  );
  if (plannedWindow.rows[0]?.seconds !== 72 * 60 * 60) {
    throw new Error("Sprint plan transaction accepted a stale client-side review deadline.");
  }

  const sprintRevision = await client.query(
    `select updated_at::text as updated_at from public.sprints where id = $1`,
    [unlockedSprintId],
  );
  await client.query(
    `select public.update_sprint_schedule_transaction(
      $1, $2, '{"end_date":"2098-03-15"}'::jsonb, $3, null, 'FounderOps sprint schedule verifier'
    )`,
    [unlockedSprintId, sprintRevision.rows[0]?.updated_at, ceoId],
  );
  const scheduledWindow = await client.query(
    `select extract(epoch from (
      review_due_at - ((end_date::date + time '23:59:59.999') at time zone 'Europe/Berlin')
    ))::integer as seconds
    from public.sprints where id = $1`,
    [unlockedSprintId],
  );
  if (scheduledWindow.rows[0]?.seconds !== 72 * 60 * 60) {
    throw new Error("Sprint schedule transaction did not use the current FounderOps review window.");
  }

  await client.query("savepoint stale_settings");
  try {
    await client.query(
      `select public.update_founderops_review_window_transaction(
        $1, 48, 96, $2, null, 'FounderOps settings stale verifier'
      )`,
      [projectId, ceoId],
    );
    throw new Error("Stale FounderOps settings update unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "P0001") throw error;
    await client.query("rollback to savepoint stale_settings");
  }

  await client.query("savepoint founder_settings");
  try {
    await client.query(
      `select public.update_founderops_review_window_transaction(
        $1, 72, 96, $2, null, 'FounderOps settings role verifier'
      )`,
      [projectId, founderId],
    );
    throw new Error("Founder unexpectedly changed FounderOps settings.");
  } catch (error) {
    if (error?.code !== "P0005") throw error;
    await client.query("rollback to savepoint founder_settings");
  }

  console.log("Transactional FounderOps settings verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
