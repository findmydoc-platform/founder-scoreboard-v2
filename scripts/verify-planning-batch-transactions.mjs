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
const taskIds = [`verify-backlog-${suffix}-a`, `verify-backlog-${suffix}-b`];
const sprintId = `verify-sprint-plan-${suffix}`;
const failedSprintId = `${sprintId}-failed`;

await client.connect();
await client.query("begin");

try {
  const insertedTasks = await client.query(
    `insert into public.tasks (id, project_id, title, status, priority, sort_order)
     values
       ($1, 'findmydoc-founder-execution', 'Backlog transaction A', 'Offen', 'P2', 900001),
       ($2, 'findmydoc-founder-execution', 'Backlog transaction B', 'Offen', 'P2', 900002)
     returning id, updated_at::text as updated_at`,
    taskIds,
  );
  const expectedById = new Map(insertedTasks.rows.map((task) => [task.id, task.updated_at]));
  const backlogUpdates = taskIds.map((id, index) => ({
    id,
    sortOrder: 910000 + index,
    expectedUpdatedAt: expectedById.get(id),
  }));

  const reordered = await client.query(
    `select public.update_backlog_order_transaction($1::jsonb, null, null, 'transaction verifier') as result`,
    [JSON.stringify(backlogUpdates)],
  );
  if (reordered.rows[0]?.result?.length !== 2 || !reordered.rows[0].result.every((task) => task.updatedAt)) {
    throw new Error("Backlog reorder did not return all committed compare-and-set timestamps.");
  }

  const persistedBacklog = await client.query(
    `select
      (select count(*)::integer from public.tasks where id = any($1::text[]) and sort_order >= 910000) as reordered_count,
      (select count(*)::integer from public.audit_log where action = 'task.backlog_reorder' and entity_id = 'backlog' and user_agent = 'transaction verifier') as audit_count`,
    [taskIds],
  );
  if (persistedBacklog.rows[0]?.reordered_count !== 2 || persistedBacklog.rows[0]?.audit_count !== 1) {
    throw new Error("Backlog reorder and audit were not committed together.");
  }

  await client.query("savepoint stale_backlog");
  try {
    await client.query(
      `select public.update_backlog_order_transaction($1::jsonb, null, null, 'transaction verifier')`,
      [JSON.stringify(backlogUpdates)],
    );
    throw new Error("Stale backlog reorder unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "P0001") throw error;
    await client.query("rollback to savepoint stale_backlog");
  }

  const sprintRows = [{
    id: sprintId,
    project_id: "findmydoc-founder-execution",
    name: "Verification Sprint",
    status: "planning",
    start_date: "2098-01-01",
    end_date: "2098-01-14",
    review_due_at: "2098-01-12T12:00:00.000Z",
    score_locked: false,
    expected_updated_at: null,
  }];
  const meetingRows = [
    {
      sprint_id: sprintId,
      title: "Verification Sprint Weekly 1",
      meeting_at: "2098-01-07T18:00:00.000Z",
      duration_minutes: 60,
      status: "planned",
      agenda: "Verification",
    },
    {
      sprint_id: sprintId,
      title: "Verification Sprint Weekly 2",
      meeting_at: "2098-01-14T18:00:00.000Z",
      duration_minutes: 60,
      status: "planned",
      agenda: "Verification",
    },
  ];
  const planned = await client.query(
    `select public.create_sprint_plan_transaction($1::jsonb, $2::jsonb, $3::jsonb, null, null, 'transaction verifier') as result`,
    [JSON.stringify(sprintRows), JSON.stringify(meetingRows), JSON.stringify({ verification: true })],
  );
  const createdSprint = planned.rows[0]?.result?.[0];
  if (createdSprint?.id !== sprintId || !createdSprint.updated_at) {
    throw new Error("Sprint plan was not created transactionally.");
  }

  const persistedSprint = await client.query(
    `select
      (select count(*)::integer from public.sprints where id = $1) as sprint_count,
      (select count(*)::integer from public.meetings where sprint_id = $1) as meeting_count,
      (select count(*)::integer from public.audit_log where action = 'sprint.plan_create' and user_agent = 'transaction verifier') as audit_count`,
    [sprintId],
  );
  if (persistedSprint.rows[0]?.sprint_count !== 1 || persistedSprint.rows[0]?.meeting_count !== 2 || persistedSprint.rows[0]?.audit_count !== 1) {
    throw new Error("Sprint, meetings, and audit were not committed together.");
  }

  const changedRows = [{ ...sprintRows[0], name: "Verification Sprint Updated", expected_updated_at: createdSprint.updated_at }];
  const changed = await client.query(
    `select public.create_sprint_plan_transaction($1::jsonb, '[]'::jsonb, '{}'::jsonb, null, null, 'transaction verifier update') as result`,
    [JSON.stringify(changedRows)],
  );
  if (changed.rows[0]?.result?.[0]?.name !== "Verification Sprint Updated") {
    throw new Error("Existing sprint was not updated with compare-and-set.");
  }

  await client.query("savepoint stale_sprint");
  try {
    await client.query(
      `select public.create_sprint_plan_transaction($1::jsonb, '[]'::jsonb, '{}'::jsonb, null, null, 'transaction verifier')`,
      [JSON.stringify(changedRows)],
    );
    throw new Error("Stale sprint plan unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "P0001") throw error;
    await client.query("rollback to savepoint stale_sprint");
  }

  await client.query("savepoint invalid_meeting");
  try {
    await client.query(
      `select public.create_sprint_plan_transaction($1::jsonb, $2::jsonb, '{}'::jsonb, null, null, 'transaction verifier')`,
      [
        JSON.stringify([{ ...sprintRows[0], id: failedSprintId, name: "Must roll back", expected_updated_at: null }]),
        JSON.stringify([{ ...meetingRows[0], sprint_id: `${failedSprintId}-missing` }]),
      ],
    );
    throw new Error("Sprint plan with an invalid meeting unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "23503") throw error;
    await client.query("rollback to savepoint invalid_meeting");
  }

  const rolledBack = await client.query(`select count(*)::integer as count from public.sprints where id = $1`, [failedSprintId]);
  if (rolledBack.rows[0]?.count !== 0) throw new Error("Failed sprint plan left a partial sprint.");

  console.log("Transactional backlog and sprint planning verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
