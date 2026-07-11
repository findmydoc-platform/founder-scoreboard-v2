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

const rootTaskId = `verify-task-deletion-${Date.now()}`;
const childTaskId = `${rootTaskId}-child`;
const cancelledTaskId = `${rootTaskId}-cancelled`;

await client.connect();
await client.query("begin");

try {
  const inserted = await client.query(
    `insert into public.tasks (id, project_id, title, status, priority)
     select $1, project.id, 'Transactional task deletion verification', 'Offen', 'P2'
     from public.projects as project
     order by project.id
     limit 1
     returning updated_at::text as updated_at`,
    [rootTaskId],
  );
  const expectedUpdatedAt = inserted.rows[0]?.updated_at;
  if (!expectedUpdatedAt) throw new Error("Could not create the transactional deletion task.");

  await client.query(
    `insert into public.tasks (id, project_id, parent_task_id, title, status, priority)
     select $1, project_id, $2, 'Transactional child deletion verification', 'Offen', 'P2'
     from public.tasks
     where id = $2`,
    [childTaskId, rootTaskId],
  );

  const prepared = await client.query(
    `select public.prepare_task_deletion_transaction($1, $2, null, null, 'transaction verifier') as result`,
    [rootTaskId, expectedUpdatedAt],
  );
  const operationId = prepared.rows[0]?.result?.operationId;
  if (!operationId || prepared.rows[0]?.result?.status !== "prepared") {
    throw new Error("Task deletion was not prepared durably.");
  }
  if (!prepared.rows[0].result.deletedTaskIds.includes(childTaskId)) {
    throw new Error("Prepared deletion did not include the child task.");
  }
  if (!prepared.rows[0].result.tasks?.some((task) => task.id === childTaskId)) {
    throw new Error("Prepared deletion did not snapshot the child task for external cleanup.");
  }

  const finalized = await client.query(
    `select public.finalize_task_deletion_transaction($1, false) as result`,
    [operationId],
  );
  if (finalized.rows[0]?.result?.status !== "completed") {
    throw new Error("Task deletion was not finalized.");
  }

  const persisted = await client.query(
    `select
      (select count(*)::integer from public.tasks where id = any($1::text[])) as task_count,
      (select count(*)::integer from public.audit_log where action = 'task.delete' and entity_id = $2) as audit_count,
      (select status from public.task_deletion_operations where id = $3) as operation_status`,
    [[rootTaskId, childTaskId], rootTaskId, operationId],
  );
  if (persisted.rows[0]?.task_count !== 0) throw new Error("Task tree was not deleted atomically.");
  if (persisted.rows[0]?.audit_count !== 1) throw new Error("Task deletion audit was not committed atomically.");
  if (persisted.rows[0]?.operation_status !== "completed") throw new Error("Task deletion operation was not completed.");

  const repeated = await client.query(
    `select public.prepare_task_deletion_transaction($1, $2, null, null, 'transaction verifier') as result`,
    [rootTaskId, expectedUpdatedAt],
  );
  if (repeated.rows[0]?.result?.status !== "completed") {
    throw new Error("Completed task deletion was not idempotent.");
  }

  const recreated = await client.query(
    `insert into public.tasks (id, project_id, title, status, priority)
     select $1, project.id, 'Recreated task deletion verification', 'Offen', 'P2'
     from public.projects as project
     order by project.id
     limit 1
     returning updated_at::text as updated_at`,
    [rootTaskId],
  );
  const recreatedPreparation = await client.query(
    `select public.prepare_task_deletion_transaction($1, $2, null, null, 'transaction verifier') as result`,
    [rootTaskId, recreated.rows[0]?.updated_at],
  );
  const recreatedOperationId = recreatedPreparation.rows[0]?.result?.operationId;
  if (!recreatedOperationId || recreatedOperationId === operationId || recreatedPreparation.rows[0]?.result?.status !== "prepared") {
    throw new Error("A recreated task id reused a completed deletion operation.");
  }
  await client.query(`select public.cancel_task_deletion_transaction($1)`, [recreatedOperationId]);
  await client.query(`delete from public.tasks where id = $1`, [rootTaskId]);

  const cancelled = await client.query(
    `with inserted as (
      insert into public.tasks (id, project_id, title, status, priority)
      select $1, project.id, 'Cancelled task deletion verification', 'Offen', 'P2'
      from public.projects as project
      order by project.id
      limit 1
      returning updated_at
    )
    select public.prepare_task_deletion_transaction($1, inserted.updated_at, null, null, 'transaction verifier') as result
    from inserted`,
    [cancelledTaskId],
  );
  const cancelledOperationId = cancelled.rows[0]?.result?.operationId;
  if (!cancelledOperationId) throw new Error("Could not prepare the cancellation verification task.");

  const cancellation = await client.query(
    `select public.cancel_task_deletion_transaction($1) as result`,
    [cancelledOperationId],
  );
  if (cancellation.rows[0]?.result?.cancelled !== true) throw new Error("Task deletion operation was not cancelled.");

  const afterCancellation = await client.query(
    `select
      (select count(*)::integer from public.tasks where id = $1) as task_count,
      (select count(*)::integer from public.task_deletion_operations where id = $2) as operation_count`,
    [cancelledTaskId, cancelledOperationId],
  );
  if (afterCancellation.rows[0]?.task_count !== 1 || afterCancellation.rows[0]?.operation_count !== 0) {
    throw new Error("Cancelled deletion did not preserve the task and remove the operation.");
  }

  console.log("Transactional task deletion verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
