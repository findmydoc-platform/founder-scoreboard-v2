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
const sprintId = `verify-sprint-lock-${suffix}`;
const nextSprintId = `${sprintId}-next`;
const taskId = `${sprintId}-task`;
const carryoverId = `${taskId}-carryover-${nextSprintId}`;
const failedSprintId = `${sprintId}-failed`;
const failedTaskId = `${failedSprintId}-task`;

await client.connect();
await client.query("begin");

try {
  const sprintInsert = await client.query(
    `insert into public.sprints (id, project_id, name, status, start_date, end_date)
     values
       ($1, 'findmydoc-founder-execution', 'Sprint lock verification', 'review', '2097-01-01', '2097-01-14'),
       ($2, 'findmydoc-founder-execution', 'Next sprint verification', 'planning', '2097-01-15', '2097-01-28')
     returning id, updated_at::text as updated_at`,
    [sprintId, nextSprintId],
  );
  const expectedUpdatedAt = sprintInsert.rows.find((sprint) => sprint.id === sprintId)?.updated_at;
  if (!expectedUpdatedAt) throw new Error("Could not create sprint finalization verification state.");

  await client.query(
    `insert into public.tasks (id, project_id, title, status, priority, sprint_id, score_final, score_points)
     values ($1, 'findmydoc-founder-execution', 'Sprint lock task verification', 'Review', 'P2', $2, false, 4)`,
    [taskId, sprintId],
  );

  const resultData = {
    carryover: { nextSprintId, created: 1, evaluated: 1 },
    scoring: { scores: 0, strikeEvents: 0, governanceReviews: 0 },
  };
  const carryoverInsert = {
    id: carryoverId,
    creation_request_id: null,
    project_id: "findmydoc-founder-execution",
    title: "Sprint carryover verification",
    status: "Offen",
    priority: "P2",
    sort_order: 999999,
    sprint_id: nextSprintId,
    task_type: "deliverable",
    score_relevant: true,
    carried_from_task_id: taskId,
    carried_from_sprint_id: sprintId,
  };
  const params = [
    sprintId,
    expectedUpdatedAt,
    JSON.stringify([{
      id: taskId,
      score_points: 4,
      score_final: true,
      sprint_outcome: "partial",
      carryover_reason: "Verification carryover",
      github_issue_sync_status: "not_synced",
      github_issue_sync_error: null,
    }]),
    JSON.stringify([carryoverInsert]),
    JSON.stringify(resultData),
  ];

  const finalized = await client.query(
    `select public.lock_sprint_transaction(
      $1, $2, $3::jsonb, '{}'::text[], $4::jsonb,
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      $5::jsonb, null, null, 'transaction verifier'
    ) as result`,
    params,
  );
  if (finalized.rows[0]?.result?.sprint?.scoreLocked !== true || finalized.rows[0]?.result?.replayed !== false) {
    throw new Error("Sprint finalization did not return the committed result.");
  }

  const persisted = await client.query(
    `select
      (select score_final from public.tasks where id = $1) as task_score_final,
      (select sprint_outcome from public.tasks where id = $1) as task_outcome,
      (select count(*)::integer from public.tasks where id = $2) as carryover_count,
      (select score_locked from public.sprints where id = $3) as sprint_locked,
      (select count(*)::integer from public.audit_log where action = 'sprint.lock_score' and entity_id = $3 and user_agent = 'transaction verifier') as audit_count`,
    [taskId, carryoverId, sprintId],
  );
  if (
    persisted.rows[0]?.task_score_final !== true ||
    persisted.rows[0]?.task_outcome !== "partial" ||
    persisted.rows[0]?.carryover_count !== 1 ||
    persisted.rows[0]?.sprint_locked !== true ||
    persisted.rows[0]?.audit_count !== 1
  ) {
    throw new Error("Sprint finalization side effects were not committed together.");
  }

  const replayed = await client.query(
    `select public.lock_sprint_transaction(
      $1, $2, '[]'::jsonb, '{}'::text[], '[]'::jsonb,
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      '{}'::jsonb, null, null, 'transaction verifier'
    ) as result`,
    [sprintId, expectedUpdatedAt],
  );
  if (replayed.rows[0]?.result?.replayed !== true || replayed.rows[0]?.result?.carryover?.created !== 1) {
    throw new Error("Completed sprint finalization was not replayed idempotently.");
  }

  const failedInsert = await client.query(
    `insert into public.sprints (id, project_id, name, status, start_date, end_date)
     values ($1, 'findmydoc-founder-execution', 'Failed sprint lock verification', 'review', '2097-02-01', '2097-02-14')
     returning updated_at::text as updated_at`,
    [failedSprintId],
  );
  await client.query(
    `insert into public.tasks (id, project_id, title, status, priority, sprint_id, score_final)
     values ($1, 'findmydoc-founder-execution', 'Failed sprint lock task', 'Review', 'P2', $2, false)`,
    [failedTaskId, failedSprintId],
  );

  await client.query("savepoint invalid_notification");
  try {
    await client.query(
      `select public.lock_sprint_transaction(
        $1, $2, $3::jsonb, '{}'::text[], '[]'::jsonb,
        $4::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
        '{}'::jsonb, null, null, 'transaction verifier failure'
      )`,
      [
        failedSprintId,
        failedInsert.rows[0]?.updated_at,
        JSON.stringify([{ id: failedTaskId, score_points: 0, score_final: true, sprint_outcome: "missed_uncommunicated", carryover_reason: "", github_issue_sync_status: "not_synced", github_issue_sync_error: null }]),
        JSON.stringify([{ type: "sprint.task_carried_over", actor_profile_id: null, recipient_profile_id: `missing-profile-${suffix}`, entity_type: "task", entity_id: failedTaskId, title: "Must roll back", body: "Must roll back" }]),
      ],
    );
    throw new Error("Sprint finalization with an invalid notification unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "23503") throw error;
    await client.query("rollback to savepoint invalid_notification");
  }

  const rolledBack = await client.query(
    `select
      (select score_final from public.tasks where id = $1) as task_score_final,
      (select score_locked from public.sprints where id = $2) as sprint_locked,
      (select count(*)::integer from public.audit_log where entity_id = $2 and action = 'sprint.lock_score') as audit_count`,
    [failedTaskId, failedSprintId],
  );
  if (rolledBack.rows[0]?.task_score_final !== false || rolledBack.rows[0]?.sprint_locked !== false || rolledBack.rows[0]?.audit_count !== 0) {
    throw new Error("Failed sprint finalization left partial database state.");
  }

  console.log("Transactional sprint finalization verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
