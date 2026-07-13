import pg from "pg";
import { loadLocalEnv } from "./lib/env.mjs";

await loadLocalEnv();

const password = process.env.SUPABASE_DB_PASSWORD;
const host = process.env.SUPABASE_DB_HOST || "db.wmccchyodlljkkytebwg.supabase.co";
const user = process.env.SUPABASE_DB_USER || "postgres";
const database = process.env.SUPABASE_DB_NAME || "postgres";

if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD.");
  process.exit(1);
}

const client = new pg.Client({
  host,
  port: 5432,
  user,
  password,
  database,
  ssl: { rejectUnauthorized: false },
});

const suffix = Date.now();
const profileId = `verify-trash-purge-profile-${suffix}`;
const projectId = `verify-trash-purge-project-${suffix}`;
const eligibleRootId = `verify-trash-purge-eligible-${suffix}`;
const eligibleChildId = `${eligibleRootId}-child`;
const blockedRootId = `verify-trash-purge-blocked-${suffix}`;
const blockedChildId = `${blockedRootId}-child`;
const trashedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
const purgeAfter = new Date(trashedAt.getTime() + 90 * 24 * 60 * 60 * 1000);

await client.connect();
await client.query("begin");

try {
  await client.query(
    `insert into public.profiles (id, name, role, platform_role)
     values ($1, 'Planning trash purge verifier', 'admin', 'ceo')`,
    [profileId],
  );
  await client.query(
    `insert into public.projects (id, name, range_label)
     values ($1, 'Planning trash purge verifier', 'Verification')`,
    [projectId],
  );

  await client.query("select set_config('founderops.trash_lifecycle_write', 'on', true)");
  await client.query(
    `insert into public.tasks (
       id, project_id, title, status, priority, task_type, approval_status,
       approval_revision, proposed_by, score_relevant, github_repo,
       trashed_at, trashed_by, trash_reason, trash_cause, purge_after,
       trash_root_type, trash_root_id, trash_revision
     ) values
       ($1, $3, 'Eligible purge root', 'Offen', 'P2', 'deliverable', 'draft',
        1, $4, false, 'findmydoc-platform/management', $5, $4,
        'Transactional purge verification', 'withdrawn', $6, 'deliverable', $1, 1),
       ($2, $3, 'Blocked purge root', 'Offen', 'P2', 'deliverable', 'draft',
        1, $4, false, 'findmydoc-platform/management', $5, $4,
        'Transactional purge verification', 'withdrawn', $6, 'deliverable', $2, 1)`,
    [
      eligibleRootId,
      blockedRootId,
      projectId,
      profileId,
      trashedAt.toISOString(),
      purgeAfter.toISOString(),
    ],
  );
  await client.query(
    `insert into public.tasks (
       id, project_id, parent_task_id, title, status, priority, task_type,
       approval_status, approval_revision, proposed_by, score_relevant, github_repo,
       trashed_at, trashed_by, trash_reason, trash_cause, purge_after,
       trash_root_type, trash_root_id, trash_revision
     ) values
       ($1, $5, $2, 'Eligible purge child', 'Offen', 'P2', 'sub_issue', null,
        1, $6, false, 'findmydoc-platform/management', $7, $6,
        'Transactional purge verification', 'withdrawn', $8, 'deliverable', $2, 1),
       ($3, $5, $4, 'Blocked purge child', 'Offen', 'P2', 'sub_issue', null,
        1, $6, false, 'findmydoc-platform/management', $7, $6,
        'Transactional purge verification', 'withdrawn', $8, 'deliverable', $4, 1)`,
    [
      eligibleChildId,
      eligibleRootId,
      blockedChildId,
      blockedRootId,
      projectId,
      profileId,
      trashedAt.toISOString(),
      purgeAfter.toISOString(),
    ],
  );
  await client.query("select set_config('founderops.trash_lifecycle_write', 'off', true)");

  await client.query(
    `insert into public.planning_github_lifecycle_outbox (
       root_type, root_id, root_trash_revision, task_id, action, source_type,
       source_revision, status, status_reason, completed_at
     ) values
       ('deliverable', $1, 1, $1, 'close_not_planned', 'withdrawn', 1, 'completed', 'issue_missing', now()),
       ('deliverable', $1, 1, $2, 'close_not_planned', 'withdrawn', 1, 'completed', 'issue_missing', now()),
       ('deliverable', $3, 1, $3, 'close_not_planned', 'withdrawn', 1, 'completed', 'issue_missing', now())`,
    [eligibleRootId, eligibleChildId, blockedRootId],
  );

  const notification = await client.query(
    `insert into public.notification_events (
       type, recipient_profile_id, entity_type, entity_id, title, body
     ) values (
       'planning_item.rejected', $1, 'task', $2,
       'Transactional purge notification', 'Verification'
     ) returning id`,
    [profileId, eligibleRootId],
  );
  const notificationId = notification.rows[0]?.id;
  if (!notificationId) throw new Error("Could not create the purge verification notification.");

  const dryRun = await client.query(
    "select public.purge_expired_planning_trash_batch(25, true) as result",
  );
  if (dryRun.rows[0]?.result?.dryRun !== true || dryRun.rows[0]?.result?.eligibleRoots < 1) {
    throw new Error("Planning trash purge dry-run did not report the eligible root.");
  }
  const afterDryRun = await client.query(
    "select count(*)::integer as count from public.tasks where id = any($1::text[])",
    [[eligibleRootId, eligibleChildId]],
  );
  if (afterDryRun.rows[0]?.count !== 2) {
    throw new Error("Planning trash purge dry-run changed source rows.");
  }

  const purged = await client.query(
    "select public.purge_expired_planning_trash_batch(25, false) as result",
  );
  if (purged.rows[0]?.result?.purgedRoots !== 1 || purged.rows[0]?.result?.purgedTasks !== 2) {
    throw new Error("Planning trash purge did not remove exactly the eligible tree.");
  }

  const persisted = await client.query(
    `select
       (select count(*)::integer from public.tasks where id = any($1::text[])) as eligible_task_count,
       (select count(*)::integer from public.tasks where id = any($2::text[])) as blocked_task_count,
       (select count(*)::integer from public.planning_github_lifecycle_outbox
         where root_type = 'deliverable' and root_id = $3 and root_trash_revision = 1) as eligible_outbox_count,
       (select count(*)::integer from public.audit_log
         where action = 'planning_trash.purge' and entity_type = 'deliverable' and entity_id = $3) as audit_count,
       (select status from public.notification_events where id = $4) as notification_status`,
    [
      [eligibleRootId, eligibleChildId],
      [blockedRootId, blockedChildId],
      eligibleRootId,
      notificationId,
    ],
  );
  const result = persisted.rows[0];
  if (result?.eligible_task_count !== 0 || result?.eligible_outbox_count !== 0) {
    throw new Error("Eligible planning trash rows were not deleted atomically.");
  }
  if (result?.blocked_task_count !== 2) {
    throw new Error("Incomplete GitHub lifecycle coverage did not block physical deletion.");
  }
  if (result?.audit_count !== 1 || result?.notification_status !== "resolved") {
    throw new Error("Purge audit or notification resolution was not committed atomically.");
  }

  console.log("Planning trash purge transaction verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
