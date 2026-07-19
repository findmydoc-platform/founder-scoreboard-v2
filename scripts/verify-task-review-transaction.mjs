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
const sprintId = `verify-task-review-${suffix}`;
const taskId = `${sprintId}-task`;
const minorReworkTaskId = `${sprintId}-minor-rework-task`;
const failedTaskId = `${sprintId}-failed-task`;
const reviewerId = `${sprintId}-reviewer`;

await client.connect();
await client.query("begin");

try {
  await client.query(
    `insert into public.profiles (id, name, role, platform_role)
     values ($1, 'Task review verifier', 'member', 'founder')`,
    [reviewerId],
  );
  await client.query(
    `insert into public.sprints (id, project_id, name, status, start_date, end_date)
     values ($1, 'findmydoc-founder-execution', 'Task review verification', 'review', '2098-01-01', '2098-01-14')`,
    [sprintId],
  );
  const taskInsert = await client.query(
    `insert into public.tasks (id, project_id, title, status, priority, sprint_id, review_status, score_final)
     values
       ($1, 'findmydoc-founder-execution', 'Atomic review verification', 'Review', 'P2', $3, 'requested', false),
       ($2, 'findmydoc-founder-execution', 'Failed review verification', 'Review', 'P2', $3, 'requested', false),
       ($4, 'findmydoc-founder-execution', 'Minor rework verification', 'Review', 'P2', $3, 'requested', false)
     returning id, updated_at::text as updated_at`,
    [taskId, failedTaskId, sprintId, minorReworkTaskId],
  );
  const expectedUpdatedAt = taskInsert.rows.find((task) => task.id === taskId)?.updated_at;
  const failedExpectedUpdatedAt = taskInsert.rows.find((task) => task.id === failedTaskId)?.updated_at;
  const minorReworkExpectedUpdatedAt = taskInsert.rows.find((task) => task.id === minorReworkTaskId)?.updated_at;
  if (!expectedUpdatedAt || !failedExpectedUpdatedAt || !minorReworkExpectedUpdatedAt) {
    throw new Error("Could not create task review verification state.");
  }

  const reviewResult = await client.query(
    `select public.review_task_transaction(
      $1, $2, $3, $4::jsonb, $7, 'accepted', 10, 'Verified atomically',
      $5::jsonb, 'Review finalisiert: accepted, 10 Punkte', '[]'::jsonb,
      $6::jsonb, null, 'task review transaction verifier'
    ) as result`,
    [
      taskId,
      sprintId,
      expectedUpdatedAt,
      JSON.stringify({
        review_status: "accepted",
        score_points: 10,
        score_final: true,
        status: "Erledigt",
        review_requested_at: null,
        github_issue_sync_status: "not_synced",
        github_issue_sync_error: null,
      }),
      JSON.stringify({
        acceptanceCriteriaMet: true,
        evidenceProvided: true,
        communicationClear: true,
        blockerHandled: true,
      }),
      JSON.stringify({
        decision: "accepted",
        points: 10,
        status: "Erledigt",
        scoreFinal: true,
      }),
      reviewerId,
    ],
  );
  if (reviewResult.rows[0]?.result?.review?.decision !== "accepted") {
    throw new Error("Task review transaction did not return review history.");
  }

  const persisted = await client.query(
    `select
      (select review_status from public.tasks where id = $1) as review_status,
      (select score_final from public.tasks where id = $1) as score_final,
      (select count(*)::integer from public.task_reviews where task_id = $1 and decision = 'accepted') as review_count,
      (select count(*)::integer from public.task_activity where task_id = $1 and message like 'Review finalisiert:%') as activity_count,
      (select count(*)::integer from public.audit_log where entity_id = $1 and action = 'task.review' and user_agent = 'task review transaction verifier') as audit_count`,
    [taskId],
  );
  if (
    persisted.rows[0]?.review_status !== "accepted" ||
    persisted.rows[0]?.score_final !== true ||
    persisted.rows[0]?.review_count !== 1 ||
    persisted.rows[0]?.activity_count !== 1 ||
    persisted.rows[0]?.audit_count !== 1
  ) {
    throw new Error("Task review side effects were not committed together.");
  }

  const minorReworkResult = await client.query(
    `select public.review_task_transaction(
      $1, $2, $3, '{}'::jsonb, $6, 'partial', 8, 'Small corrections required',
      $4::jsonb, 'Kleine Nacharbeit angefordert', '[]'::jsonb,
      $5::jsonb, null, 'task review minor rework verifier'
    ) as result`,
    [
      minorReworkTaskId,
      sprintId,
      minorReworkExpectedUpdatedAt,
      JSON.stringify({
        acceptanceCriteriaMet: true,
        evidenceProvided: true,
        communicationClear: true,
        blockerHandled: false,
      }),
      JSON.stringify({
        decision: "partial",
        points: 8,
        status: "Nacharbeit",
        scoreFinal: false,
      }),
      reviewerId,
    ],
  );
  const minorReworkTask = minorReworkResult.rows[0]?.result?.task;
  if (
    minorReworkTask?.status !== "Nacharbeit"
    || minorReworkTask?.review_status !== "partial"
    || minorReworkTask?.score_final !== false
    || minorReworkTask?.score_points !== 8
  ) {
    throw new Error("Minor rework was incorrectly finalized or lost its derived score.");
  }

  await client.query("savepoint reopen_minor_rework");
  try {
    await client.query(
      `select public.transition_task_review_transaction(
        $1, $2, 'reopen', $3, null, 'Must not reopen', '[]'::jsonb,
        '{}'::jsonb, null, 'task review minor reopen verifier'
      )`,
      [minorReworkTaskId, minorReworkTask.updated_at, reviewerId],
    );
    throw new Error("Minor rework unexpectedly used the final-review reopen transition.");
  } catch (error) {
    if (error?.code !== "P0004") throw error;
    await client.query("rollback to savepoint reopen_minor_rework");
  }

  await client.query("savepoint invalid_notification");
  try {
    await client.query(
      `select public.review_task_transaction(
        $1, $2, $3, $4::jsonb, $6, 'accepted', 10, 'Must roll back',
        '{"acceptanceCriteriaMet":true,"evidenceProvided":true,"communicationClear":true,"blockerHandled":true}'::jsonb, 'Must roll back', $5::jsonb,
        '{}'::jsonb, null, 'task review rollback verifier'
      )`,
      [
        failedTaskId,
        sprintId,
        failedExpectedUpdatedAt,
        JSON.stringify({
          review_status: "accepted",
          score_points: 10,
          score_final: true,
          status: "Erledigt",
          review_requested_at: null,
          github_issue_sync_status: "not_synced",
          github_issue_sync_error: null,
        }),
        JSON.stringify([{
          type: "task.review_completed",
          actor_profile_id: null,
          recipient_profile_id: `missing-profile-${suffix}`,
          entity_type: "task",
          entity_id: failedTaskId,
          title: "Must roll back",
          body: "Must roll back",
        }]),
        reviewerId,
      ],
    );
    throw new Error("Task review with an invalid notification unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "23503") throw error;
    await client.query("rollback to savepoint invalid_notification");
  }

  const rolledBack = await client.query(
    `select
      (select review_status from public.tasks where id = $1) as review_status,
      (select score_final from public.tasks where id = $1) as score_final,
      (select count(*)::integer from public.task_reviews where task_id = $1) as review_count,
      (select count(*)::integer from public.task_activity where task_id = $1) as activity_count,
      (select count(*)::integer from public.audit_log where entity_id = $1 and action = 'task.review') as audit_count`,
    [failedTaskId],
  );
  if (
    rolledBack.rows[0]?.review_status !== "requested" ||
    rolledBack.rows[0]?.score_final !== false ||
    rolledBack.rows[0]?.review_count !== 0 ||
    rolledBack.rows[0]?.activity_count !== 0 ||
    rolledBack.rows[0]?.audit_count !== 0
  ) {
    throw new Error("Failed task review left partial database state.");
  }

  const reopened = await client.query(
    `select public.transition_task_review_transaction(
      $1, $2, 'reopen', $3, null, 'Review wieder geöffnet', '[]'::jsonb,
      '{"status":"Review","reviewStatus":"requested","scoreFinal":false}'::jsonb,
      null, 'task review transition verifier'
    ) as result`,
    [taskId, reviewResult.rows[0]?.result?.task?.updated_at, reviewerId],
  );
  const reopenedUpdatedAt = reopened.rows[0]?.result?.task?.updated_at;
  if (reopened.rows[0]?.result?.task?.review_status !== "requested" || !reopenedUpdatedAt) {
    throw new Error("Final review was not reopened atomically.");
  }

  const withdrawn = await client.query(
    `select public.transition_task_review_transaction(
      $1, $2, 'withdraw', $3, 'Verification withdrawal', 'Review zurückgezogen', '[]'::jsonb,
      '{"status":"In Arbeit","reviewStatus":"not_requested","scoreFinal":false}'::jsonb,
      null, 'task review transition verifier'
    ) as result`,
    [taskId, reopenedUpdatedAt, reviewerId],
  );
  if (withdrawn.rows[0]?.result?.task?.review_status !== "not_requested") {
    throw new Error("Active review was not withdrawn atomically.");
  }

  console.log("Transactional task review verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
