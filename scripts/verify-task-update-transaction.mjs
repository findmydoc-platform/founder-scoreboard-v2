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

const taskId = `verify-task-update-${Date.now()}`;
const note = "Transactional verification note";
const dependency = "Transactional verification dependency";

await client.connect();
await client.query("begin");

try {
  const inserted = await client.query(
    `insert into public.tasks (id, project_id, title, status, priority)
     select $1, project.id, 'Transactional task update verification', 'Offen', 'P2'
     from public.projects as project
     order by project.id
     limit 1
     returning updated_at::text as updated_at`,
    [taskId],
  );
  const expectedUpdatedAt = inserted.rows[0]?.updated_at;
  if (!expectedUpdatedAt) throw new Error("Could not create the transactional verification task.");

  const updated = await client.query(
    `select public.update_task_transaction(
      $1,
      $2,
      $3::jsonb,
      true,
      $4,
      true,
      $5,
      $6::text[],
      '[]'::jsonb
    ) as result`,
    [taskId, expectedUpdatedAt, JSON.stringify({ status: "In Arbeit" }), note, dependency, ["Transactional verification activity"]],
  );
  const result = updated.rows[0]?.result;
  if (result?.task?.status !== "In Arbeit") throw new Error("Task status was not updated transactionally.");
  if (!result?.task?.updated_at || result.task.updated_at === expectedUpdatedAt) {
    throw new Error("Task update timestamp did not advance.");
  }

  const relatedRows = await client.query(
    `select
      (select note from public.task_notes where task_id = $1) as note,
      (select note from public.task_dependencies where task_id = $1 limit 1) as dependency,
      (select count(*)::integer from public.task_activity where task_id = $1) as activity_count`,
    [taskId],
  );
  if (relatedRows.rows[0]?.note !== note) throw new Error("Task note was not committed with the task update.");
  if (relatedRows.rows[0]?.dependency !== dependency) throw new Error("Task dependency was not committed with the task update.");
  if (relatedRows.rows[0]?.activity_count !== 1) throw new Error("Task activity was not committed with the task update.");

  await client.query("savepoint stale_update");
  try {
    await client.query(
      `select public.update_task_transaction(
        $1,
        $2,
        $3::jsonb,
        false,
        null,
        false,
        null,
        '{}'::text[],
        '[]'::jsonb
      )`,
      [taskId, expectedUpdatedAt, JSON.stringify({ priority: "P1" })],
    );
    throw new Error("Stale task update unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "P0001") throw error;
    await client.query("rollback to savepoint stale_update");
  }

  const afterConflict = await client.query("select status, priority from public.tasks where id = $1", [taskId]);
  if (afterConflict.rows[0]?.status !== "In Arbeit" || afterConflict.rows[0]?.priority !== "P2") {
    throw new Error("Stale task update changed persisted task state.");
  }

  console.log("Transactional task update verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
