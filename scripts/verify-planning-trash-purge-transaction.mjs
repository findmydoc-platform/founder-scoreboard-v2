import pg from "pg";
import { loadLocalEnv } from "./lib/env.mjs";

await loadLocalEnv();

const password = process.env.SUPABASE_DB_PASSWORD;
const host = process.env.SUPABASE_DB_HOST?.trim();
const port = Number(process.env.SUPABASE_DB_PORT || 5432);
const user = process.env.SUPABASE_DB_USER?.trim();
const database = process.env.SUPABASE_DB_NAME || "postgres";
const ssl = process.env.SUPABASE_DB_SSL === "false" ? false : { rejectUnauthorized: false };

if (!host || !user || !password) {
  console.error("Missing SUPABASE_DB_HOST, SUPABASE_DB_USER, or SUPABASE_DB_PASSWORD.");
  process.exit(1);
}

const client = new pg.Client({
  host,
  port,
  user,
  password,
  database,
  ssl,
});

const suffix = Date.now();
const profileId = `verify-trash-purge-profile-${suffix}`;
const projectId = `verify-trash-purge-project-${suffix}`;
const packageId = `verify-trash-purge-package-${suffix}`;
const eligibleRootId = `verify-trash-purge-eligible-${suffix}`;
const eligibleChildId = `${eligibleRootId}-child`;
const blockedRootId = `verify-trash-purge-blocked-${suffix}`;
const blockedChildId = `${blockedRootId}-child`;
const substitutedRootId = `verify-trash-purge-substituted-${suffix}`;
const substitutedChildId = `${substitutedRootId}-child`;
const wrongReasonRootId = `verify-trash-purge-wrong-reason-${suffix}`;
const corruptRootId = `verify-trash-purge-corrupt-${suffix}`;
const initiativeRootId = `verify-trash-purge-initiative-${suffix}`;
const initiativeMemberId = `${initiativeRootId}-member`;
const externalCascadeId = `${initiativeRootId}-external`;
const lateRootId = `verify-trash-purge-late-${suffix}`;
const lateChildId = `${lateRootId}-child`;
const scanBlockedRootIds = Array.from(
  { length: 30 },
  (_, index) => `verify-trash-purge-000-scan-blocked-${index}-${suffix}`,
);
const trashedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
const purgeAfter = new Date(trashedAt.getTime() + 90 * 24 * 60 * 60 * 1000);
const lateTrashedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
const latePurgeAfter = new Date(lateTrashedAt.getTime() + 90 * 24 * 60 * 60 * 1000);

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
  await client.query(
    `insert into public.packages (id, project_id, title, proposed_by)
     values
       ($1, $3, 'Planning trash purge verifier', $4),
       ($2, $3, 'Notification ID collision verifier', $4)`,
    [packageId, eligibleRootId, projectId, profileId],
  );

  await client.query("select set_config('founderops.trash_lifecycle_write', 'on', true)");
  await client.query(
    `insert into public.packages (
       id, project_id, title, proposed_by, trashed_at, trashed_by, trash_reason,
       trash_cause, purge_after, trash_root_type, trash_root_id, trash_revision
     ) values (
       $1, $2, 'Initiative cascade verifier', $3, $4, $3,
       'Transactional purge verification', 'withdrawn', $5, 'initiative', $1, 1
     )`,
    [initiativeRootId, projectId, profileId, trashedAt.toISOString(), purgeAfter.toISOString()],
  );
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, title, status, priority, task_type, approval_status,
       approval_revision, proposed_by, score_relevant, github_repo,
       trashed_at, trashed_by, trash_reason, trash_cause, purge_after,
       trash_root_type, trash_root_id, trash_revision
     ) values
       ($1, $3, $4, 'Eligible purge root', 'Offen', 'P2', 'deliverable', 'draft',
        1, $5, false, 'findmydoc-platform/management', $6, $5,
        'Transactional purge verification', 'withdrawn', $7, 'deliverable', $1, 1),
       ($2, $3, $4, 'Blocked purge root', 'Offen', 'P2', 'deliverable', 'draft',
        1, $5, false, 'findmydoc-platform/management', $6, $5,
        'Transactional purge verification', 'withdrawn', $7, 'deliverable', $2, 1)`,
    [
      eligibleRootId,
      blockedRootId,
      projectId,
      packageId,
      profileId,
      trashedAt.toISOString(),
      purgeAfter.toISOString(),
    ],
  );
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, parent_task_id, title, status, priority, task_type,
       approval_status, approval_revision, proposed_by, score_relevant, github_repo,
       trashed_at, trashed_by, trash_reason, trash_cause, purge_after,
       trash_root_type, trash_root_id, trash_revision
     ) values
       ($1, $5, $6, $2, 'Eligible purge child', 'Offen', 'P2', 'sub_issue', null,
        1, $7, false, 'findmydoc-platform/management', $8, $7,
        'Transactional purge verification', 'withdrawn', $9, 'deliverable', $2, 1),
       ($3, $5, $6, $4, 'Blocked purge child', 'Offen', 'P2', 'sub_issue', null,
        1, $7, false, 'findmydoc-platform/management', $8, $7,
        'Transactional purge verification', 'withdrawn', $9, 'deliverable', $4, 1)`,
    [
      eligibleChildId,
      eligibleRootId,
      blockedChildId,
      blockedRootId,
      projectId,
      packageId,
      profileId,
      trashedAt.toISOString(),
      purgeAfter.toISOString(),
    ],
  );
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, parent_task_id, title, status, priority, task_type,
       approval_status, approval_revision, proposed_by, score_relevant, github_repo,
       trashed_at, trashed_by, trash_reason, trash_cause, purge_after,
       trash_root_type, trash_root_id, trash_revision
     ) values
       ($1, $5, $6, null, 'Substituted purge root', 'Offen', 'P2', 'deliverable', 'draft',
        1, $7, false, 'findmydoc-platform/management', $8, $7,
        'Transactional purge verification', 'withdrawn', $9, 'deliverable', $1, 1),
       ($2, $5, $6, $1, 'Substituted purge child', 'Offen', 'P2', 'sub_issue', null,
        1, $7, false, 'findmydoc-platform/management', $8, $7,
        'Transactional purge verification', 'withdrawn', $9, 'deliverable', $1, 1),
       ($3, $5, $6, null, 'Wrong lifecycle reason root', 'Offen', 'P2', 'deliverable', 'draft',
        1, $7, false, 'findmydoc-platform/management', $8, $7,
        'Transactional purge verification', 'withdrawn', $9, 'deliverable', $3, 1),
       ($4, $5, $6, $10, 'Corrupted hierarchy root', 'Offen', 'P2', 'deliverable', 'draft',
        1, $7, false, 'findmydoc-platform/management', $8, $7,
        'Transactional purge verification', 'withdrawn', $9, 'deliverable', $4, 1)`,
    [
      substitutedRootId,
      substitutedChildId,
      wrongReasonRootId,
      corruptRootId,
      projectId,
      packageId,
      profileId,
      trashedAt.toISOString(),
      purgeAfter.toISOString(),
      blockedRootId,
    ],
  );
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, title, status, priority, task_type, approval_status,
       approval_revision, proposed_by, score_relevant, github_repo,
       trashed_at, trashed_by, trash_reason, trash_cause, purge_after,
       trash_root_type, trash_root_id, trash_revision
     )
     select blocked_id, $2, $3, 'Bounded blocked root', 'Offen', 'P2', 'deliverable', 'draft',
       1, $4, false, 'findmydoc-platform/management', $5, $4,
       'Transactional purge verification', 'withdrawn', $6,
       'deliverable', blocked_id, 1
     from unnest($1::text[]) as blocked_id`,
    [
      scanBlockedRootIds,
      projectId,
      packageId,
      profileId,
      trashedAt.toISOString(),
      purgeAfter.toISOString(),
    ],
  );
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, parent_task_id, title, status, priority, task_type,
       approval_status, approval_revision, proposed_by, score_relevant, github_repo,
       trashed_at, trashed_by, trash_reason, trash_cause, purge_after,
       trash_root_type, trash_root_id, trash_revision
     ) values
       ($1, $6, $5, null, 'Initiative member verifier', 'Offen', 'P2', 'deliverable', 'draft',
        1, $7, false, 'findmydoc-platform/management', $8, $7,
        'Transactional purge verification', 'withdrawn', $9, 'initiative', $5, 1),
       ($2, $6, $4, $1, 'External cascade verifier', 'Offen', 'P2', 'deliverable', 'draft',
        1, $7, false, 'findmydoc-platform/management', null, null,
        null, null, null, null, null, 0),
       ($3, $6, $4, null, 'Late retention root', 'Offen', 'P2', 'deliverable', 'draft',
        1, $7, false, 'findmydoc-platform/management', $8, $7,
        'Transactional purge verification', 'withdrawn', $9, 'deliverable', $3, 1)`,
    [
      initiativeMemberId,
      externalCascadeId,
      lateRootId,
      packageId,
      initiativeRootId,
      projectId,
      profileId,
      trashedAt.toISOString(),
      purgeAfter.toISOString(),
    ],
  );
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, parent_task_id, title, status, priority, task_type,
       approval_status, approval_revision, proposed_by, score_relevant, github_repo,
       trashed_at, trashed_by, trash_reason, trash_cause, purge_after,
       trash_root_type, trash_root_id, trash_revision
     ) values (
       $1, $3, $4, $2, 'Late retention child', 'Offen', 'P2', 'sub_issue', null,
       1, $5, false, 'findmydoc-platform/management', $6, $5,
       'Transactional purge verification', 'withdrawn', $7, 'deliverable', $2, 1
     )`,
    [
      lateChildId,
      lateRootId,
      projectId,
      packageId,
      profileId,
      lateTrashedAt.toISOString(),
      latePurgeAfter.toISOString(),
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
       ('deliverable', $3, 1, $3, 'close_not_planned', 'withdrawn', 1, 'completed', 'issue_missing', now()),
       ('deliverable', $4, 1, $4, 'close_not_planned', 'withdrawn', 1, 'completed', 'issue_missing', now()),
       ('deliverable', $4, 1, $5, 'close_not_planned', 'withdrawn', 1, 'completed', 'issue_missing', now()),
       ('deliverable', $6, 1, $6, 'close_not_planned', 'withdrawn', 1, 'completed', 'issue_missing', now())`,
    [
      eligibleRootId,
      eligibleChildId,
      blockedRootId,
      substitutedRootId,
      blockedChildId,
      corruptRootId,
    ],
  );
  await client.query(
    `insert into public.planning_github_lifecycle_outbox (
       root_type, root_id, root_trash_revision, task_id, github_repo,
       github_issue_number, action, source_type, source_revision, status,
       status_reason, completed_at
     ) values (
       'deliverable', $1, 1, $1, 'findmydoc-platform/management', 42,
       'close_not_planned', 'withdrawn', 1, 'completed', 'issue_missing', now()
     )`,
    [wrongReasonRootId],
  );
  await client.query(
    `insert into public.planning_github_lifecycle_outbox (
       root_type, root_id, root_trash_revision, task_id, action, source_type,
       source_revision, status, status_reason, completed_at
     ) values
       ('initiative', $1, 1, $2, 'close_not_planned', 'withdrawn', 1, 'completed', 'issue_missing', now()),
       ('deliverable', $3, 1, $3, 'close_not_planned', 'withdrawn', 1, 'completed', 'issue_missing', now()),
       ('deliverable', $3, 1, $4, 'close_not_planned', 'withdrawn', 1, 'completed', 'issue_missing', now())`,
    [initiativeRootId, initiativeMemberId, lateRootId, lateChildId],
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
  const collisionNotification = await client.query(
    `insert into public.notification_events (
       type, recipient_profile_id, entity_type, entity_id, title, body
     ) values (
       'planning_item.rejected', $1, 'initiative', $2,
       'Notification collision verifier', 'Verification'
     ) returning id`,
    [profileId, eligibleRootId],
  );
  const collisionNotificationId = collisionNotification.rows[0]?.id;
  if (!collisionNotificationId) {
    throw new Error("Could not create the notification ID collision verifier.");
  }

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
  const afterDryRunSetting = await client.query(
    "select current_setting('founderops.trash_lifecycle_write', true) as value",
  );
  if (afterDryRunSetting.rows[0]?.value !== "off") {
    throw new Error("Planning trash purge dry-run left the lifecycle bypass enabled.");
  }

  const purged = await client.query(
    "select public.purge_expired_planning_trash_batch(25, false) as result",
  );
  if (purged.rows[0]?.result?.purgedRoots !== 1 || purged.rows[0]?.result?.purgedTasks !== 2) {
    throw new Error("Planning trash purge did not remove exactly the eligible tree.");
  }
  const afterPurgeSetting = await client.query(
    "select current_setting('founderops.trash_lifecycle_write', true) as value",
  );
  if (afterPurgeSetting.rows[0]?.value !== "off") {
    throw new Error("Planning trash purge left the lifecycle bypass enabled.");
  }

  const persisted = await client.query(
    `select
       (select count(*)::integer from public.tasks where id = any($1::text[])) as eligible_task_count,
       (select count(*)::integer from public.tasks where id = any($2::text[])) as blocked_task_count,
       (select count(*)::integer from public.tasks where id = any($5::text[])) as substituted_task_count,
       (select count(*)::integer from public.tasks where id = $6) as wrong_reason_task_count,
       (select count(*)::integer from public.tasks where id = any($7::text[])) as scan_blocked_task_count,
       (select count(*)::integer from public.tasks where id = $8) as corrupt_task_count,
       (select count(*)::integer from public.packages where id = $10) as initiative_package_count,
       (select count(*)::integer from public.tasks where id = any($11::text[])) as initiative_task_count,
       (select count(*)::integer from public.tasks where id = any($12::text[])) as late_task_count,
       (select count(*)::integer from public.planning_github_lifecycle_outbox
         where root_type = 'deliverable' and root_id = $3 and root_trash_revision = 1) as eligible_outbox_count,
       (select count(*)::integer from public.audit_log
         where action = 'planning_trash.purge' and entity_type = 'deliverable' and entity_id = $3) as audit_count,
       (select status from public.notification_events where id = $4) as notification_status,
       (select status from public.notification_events where id = $9) as collision_notification_status`,
    [
      [eligibleRootId, eligibleChildId],
      [blockedRootId, blockedChildId],
      eligibleRootId,
      notificationId,
      [substitutedRootId, substitutedChildId],
      wrongReasonRootId,
      scanBlockedRootIds,
      corruptRootId,
      collisionNotificationId,
      initiativeRootId,
      [initiativeMemberId, externalCascadeId],
      [lateRootId, lateChildId],
    ],
  );
  const result = persisted.rows[0];
  if (result?.eligible_task_count !== 0 || result?.eligible_outbox_count !== 0) {
    throw new Error("Eligible planning trash rows were not deleted atomically.");
  }
  if (result?.blocked_task_count !== 2) {
    throw new Error("Incomplete GitHub lifecycle coverage did not block physical deletion.");
  }
  if (result?.substituted_task_count !== 2) {
    throw new Error("Count-equal but task-mismatched GitHub lifecycle coverage allowed deletion.");
  }
  if (result?.wrong_reason_task_count !== 1) {
    throw new Error("A linked issue without delivered lifecycle completion allowed deletion.");
  }
  if (result?.scan_blocked_task_count !== scanBlockedRootIds.length) {
    throw new Error("Blocked roots were unexpectedly deleted by the bounded eligible-root batch.");
  }
  if (result?.corrupt_task_count !== 1) {
    throw new Error("A structurally invalid deliverable root was physically deleted.");
  }
  if (result?.initiative_package_count !== 1 || result?.initiative_task_count !== 2) {
    throw new Error("An external child reference allowed an Initiative cascade purge.");
  }
  if (result?.late_task_count !== 2) {
    throw new Error("A child with an active retention period was physically deleted.");
  }
  if (result?.audit_count !== 1 || result?.notification_status !== "resolved") {
    throw new Error("Purge audit or notification resolution was not committed atomically.");
  }
  if (result?.collision_notification_status !== "pending") {
    throw new Error("A deliverable purge resolved a colliding initiative notification.");
  }

  console.log("Planning trash purge transaction verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
