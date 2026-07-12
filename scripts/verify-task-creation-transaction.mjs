import pg from "pg";
import { randomUUID } from "node:crypto";
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
const relatedTaskId = `verify-task-create-related-${suffix}`;
const createdTaskId = `verify-task-create-${suffix}`;
const failedTaskId = `verify-task-create-failed-${suffix}`;
const creationRequestId = randomUUID();
const failedCreationRequestId = randomUUID();

function taskInsert(id, title, requestId) {
  return {
    id,
    creation_request_id: requestId,
    project_id: "findmydoc-founder-execution",
    title,
    status: "Offen",
    priority: "P2",
    sort_order: 0,
    task_type: "deliverable",
    score_relevant: true,
  };
}

await client.connect();
await client.query("begin");

try {
  await client.query(
    `insert into public.tasks (id, project_id, title, status, priority)
     values ($1, 'findmydoc-founder-execution', 'Related task creation verification', 'Offen', 'P2')`,
    [relatedTaskId],
  );

  const created = await client.query(
    `select public.create_task_transaction(
      $1::jsonb,
      'blocked_by',
      $2,
      'Transactional relation',
      'Transactional task created',
      'Transactional relation created',
      '[]'::jsonb,
      null,
      null,
      'transaction verifier'
    ) as result`,
    [JSON.stringify(taskInsert(createdTaskId, "Transactional task creation verification", creationRequestId)), relatedTaskId],
  );
  const result = created.rows[0]?.result;
  if (result?.task?.id !== createdTaskId) throw new Error("Task was not created transactionally.");
  if (result?.relation?.related_task_id !== relatedTaskId) throw new Error("Initial relationship was not created transactionally.");
  if (result?.relatedTask?.id !== relatedTaskId || !result.relatedTask.updatedAt) {
    throw new Error("Related task compare-and-set state was not returned.");
  }
  if (typeof result?.task?.creation_request_payload !== "string" || result.task.creation_request_payload.length !== 32) {
    throw new Error("Create request idempotency stored raw request data instead of a fingerprint.");
  }
  if (!Number.isInteger(result?.task?.sort_order) || result.task.sort_order <= 0) {
    throw new Error("Task sort order was not assigned transactionally.");
  }

  const persisted = await client.query(
    `select
      (select count(*)::integer from public.tasks where id = $1) as task_count,
      (select count(*)::integer from public.task_relationship_edges where task_id = $1) as relation_count,
      (select count(*)::integer from public.task_activity where task_id = $1) as activity_count,
      (select count(*)::integer from public.audit_log where entity_id = $1 and action in ('task.create', 'task.relationship_created')) as audit_count`,
    [createdTaskId],
  );
  if (
    persisted.rows[0]?.task_count !== 1 ||
    persisted.rows[0]?.relation_count !== 1 ||
    persisted.rows[0]?.activity_count !== 2 ||
    persisted.rows[0]?.audit_count !== 2
  ) {
    throw new Error("Task creation side effects were not committed together.");
  }

  const replayed = await client.query(
    `select public.create_task_transaction(
      $1::jsonb,
      'blocked_by',
      $2,
      'Transactional relation',
      'Must not be inserted again',
      'Must not be inserted again',
      '[]'::jsonb,
      null,
      null,
      'transaction verifier'
    ) as result`,
    [JSON.stringify(taskInsert(createdTaskId, "Transactional task creation verification", creationRequestId)), relatedTaskId],
  );
  if (replayed.rows[0]?.result?.replayed !== true || replayed.rows[0]?.result?.task?.id !== createdTaskId) {
    throw new Error("Repeated task creation did not return the committed result.");
  }

  const afterReplay = await client.query(
    `select
      (select count(*)::integer from public.tasks where creation_request_id = $1) as task_count,
      (select count(*)::integer from public.task_activity where task_id = $2) as activity_count,
      (select count(*)::integer from public.audit_log where entity_id = $2 and action in ('task.create', 'task.relationship_created')) as audit_count`,
    [creationRequestId, createdTaskId],
  );
  if (afterReplay.rows[0]?.task_count !== 1 || afterReplay.rows[0]?.activity_count !== 2 || afterReplay.rows[0]?.audit_count !== 2) {
    throw new Error("Repeated task creation duplicated committed side effects.");
  }

  await client.query("savepoint changed_replay");
  try {
    await client.query(
      `select public.create_task_transaction(
        $1::jsonb,
        'blocked_by',
        $2,
        'Transactional relation',
        'Must not be inserted again',
        'Must not be inserted again',
        '[]'::jsonb,
        null,
        null,
        'transaction verifier'
      )`,
      [JSON.stringify(taskInsert(createdTaskId, "Changed replay payload", creationRequestId)), relatedTaskId],
    );
    throw new Error("Changed task creation replay unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "P0003") throw error;
    await client.query("rollback to savepoint changed_replay");
  }

  await client.query(`select public.begin_github_issue_sync_transaction($1)`, [createdTaskId]);
  const finalized = await client.query(
    `select public.finalize_github_issue_sync_transaction(
      $1,
      'findmydoc-platform/management',
      999999,
      'https://github.com/findmydoc-platform/management/issues/999999',
      now(),
      'Transactional GitHub sync finalized'
    ) as result`,
    [createdTaskId],
  );
  if (finalized.rows[0]?.result?.github_issue_sync_status !== "synced") {
    throw new Error("GitHub sync was not finalized transactionally.");
  }

  const replayedAfterSync = await client.query(
    `select public.create_task_transaction(
      $1::jsonb,
      'blocked_by',
      $2,
      'Transactional relation',
      'Must not be inserted after sync',
      'Must not be inserted after sync',
      '[]'::jsonb,
      null,
      null,
      'transaction verifier'
    ) as result`,
    [JSON.stringify(taskInsert(createdTaskId, "Transactional task creation verification", creationRequestId)), relatedTaskId],
  );
  if (replayedAfterSync.rows[0]?.result?.replayed !== true) {
    throw new Error("Task mutation after creation broke idempotent create replay.");
  }

  await client.query(`select public.begin_github_issue_sync_transaction($1)`, [createdTaskId]);
  const failed = await client.query(
    `select public.fail_github_issue_sync_transaction($1, 'Expected verification failure', 'Transactional GitHub sync failed') as result`,
    [createdTaskId],
  );
  if (failed.rows[0]?.result?.github_issue_sync_status !== "failed") {
    throw new Error("GitHub sync failure was not recorded transactionally.");
  }

  await client.query("savepoint invalid_notification");
  try {
    await client.query(
      `select public.create_task_transaction(
        $1::jsonb,
        null,
        null,
        null,
        'This activity must roll back',
        null,
        $2::jsonb,
        null,
        null,
        'transaction verifier'
      )`,
      [
        JSON.stringify(taskInsert(failedTaskId, "Failed transactional task creation verification", failedCreationRequestId)),
        JSON.stringify([{
          type: "task.proposed",
          actor_profile_id: null,
          recipient_profile_id: `missing-profile-${suffix}`,
          entity_type: "task",
          entity_id: failedTaskId,
          title: "Must roll back",
          body: "Must roll back",
        }]),
      ],
    );
    throw new Error("Task creation with an invalid notification unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "23503") throw error;
    await client.query("rollback to savepoint invalid_notification");
  }

  const rolledBack = await client.query(
    `select
      (select count(*)::integer from public.tasks where id = $1) as task_count,
      (select count(*)::integer from public.task_activity where task_id = $1) as activity_count,
      (select count(*)::integer from public.audit_log where entity_id = $1) as audit_count`,
    [failedTaskId],
  );
  if (rolledBack.rows[0]?.task_count || rolledBack.rows[0]?.activity_count || rolledBack.rows[0]?.audit_count) {
    throw new Error("Failed task creation left partial database state.");
  }

  console.log("Transactional task creation and GitHub sync verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
