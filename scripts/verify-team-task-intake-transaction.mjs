import { createHash, randomUUID } from "node:crypto";
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

function taskInsert({ actorId, creationRequestId, id, title }) {
  return {
    id,
    creation_request_id: creationRequestId,
    project_id: "findmydoc-founder-execution",
    title,
    status: "Vorschlag",
    priority: "P2",
    owner: null,
    assignee: null,
    created_by: actorId,
    sort_order: 0,
    sprint_id: null,
    score_points: 0,
    score_final: false,
    task_type: "proposal",
    parent_task_id: null,
    score_relevant: false,
  };
}

await client.connect();
await client.query("begin");

try {
  const profileResult = await client.query(
    `select id
     from public.profiles
     where platform_role in ('ceo', 'deputy', 'founder')
     order by case platform_role when 'founder' then 0 when 'deputy' then 1 else 2 end, id
     limit 1`,
  );
  const profileId = profileResult.rows[0]?.id;
  if (!profileId) throw new Error("No operational profile is available for Team Task Intake verification.");

  const tokenHash = createHash("sha256").update(`verification-${randomUUID()}`).digest("hex");
  const tokenResult = await client.query(
    `select public.create_team_task_intake_token($1, $2, $3, $4, now() + interval '90 days') as result`,
    [profileId, "Transactional verification", tokenHash, "…verify"],
  );
  const token = tokenResult.rows[0]?.result;
  if (!token?.id || token.token_hash) throw new Error("Token RPC did not return safe one-time token metadata.");

  const idempotencyKey = randomUUID();
  const suffix = Date.now();
  const taskIds = [`verify-team-intake-${suffix}-1`, `verify-team-intake-${suffix}-2`];
  const items = taskIds.map((id, index) => ({
    taskInsert: taskInsert({
      actorId: profileId,
      creationRequestId: `team:${token.id}:${idempotencyKey}:${index + 1}`,
      id,
      title: `Team Intake transaction verification ${index + 1}`,
    }),
    activityMessage: "Aufgabenvorschlag über Team Intake erstellt",
    notifications: [],
  }));

  const requestHash = createHash("sha256").update(JSON.stringify(items)).digest("hex");
  const committed = await client.query(
    `select public.create_team_task_intake_batch_transaction($1, $2, $3, $4, $5::jsonb, null, 'transaction verifier') as result`,
    [token.id, profileId, idempotencyKey, requestHash, JSON.stringify(items)],
  );
  const committedResult = committed.rows[0]?.result;
  if (committedResult?.replayed !== false || committedResult?.tasks?.length !== 2) {
    throw new Error("Team Task Intake batch was not committed atomically.");
  }

  const persisted = await client.query(
    `select
      (select count(*)::integer from public.tasks where id = any($1::text[])) as task_count,
      (select count(*)::integer from public.task_activity where task_id = any($1::text[])) as activity_count,
      (select count(*)::integer from public.team_task_intake_batches where token_id = $2 and idempotency_key = $3) as batch_count,
      (select count(*)::integer from public.audit_log where entity_type = 'team_task_intake_batch' and entity_id = $4) as batch_audit_count`,
    [taskIds, token.id, idempotencyKey, committedResult.batchId],
  );
  if (
    persisted.rows[0]?.task_count !== 2
    || persisted.rows[0]?.activity_count !== 2
    || persisted.rows[0]?.batch_count !== 1
    || persisted.rows[0]?.batch_audit_count !== 1
  ) {
    throw new Error("Team Task Intake side effects were not committed together.");
  }

  const replayed = await client.query(
    `select public.create_team_task_intake_batch_transaction($1, $2, $3, $4, $5::jsonb, null, 'transaction verifier') as result`,
    [token.id, profileId, idempotencyKey, requestHash, JSON.stringify(items)],
  );
  if (replayed.rows[0]?.result?.replayed !== true || replayed.rows[0]?.result?.tasks?.length !== 2) {
    throw new Error("Repeated Team Task Intake did not return the existing batch.");
  }

  await client.query("savepoint changed_replay");
  try {
    await client.query(
      `select public.create_team_task_intake_batch_transaction($1, $2, $3, $4, $5::jsonb, null, 'transaction verifier')`,
      [token.id, profileId, idempotencyKey, "c".repeat(64), JSON.stringify(items)],
    );
    throw new Error("Changed Team Task Intake replay unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "P0003") throw error;
    await client.query("rollback to savepoint changed_replay");
  }

  const failedKey = randomUUID();
  const failedTaskIds = [`verify-team-intake-failed-${suffix}-1`, `verify-team-intake-failed-${suffix}-2`];
  const failedItems = failedTaskIds.map((id, index) => ({
    taskInsert: taskInsert({
      actorId: profileId,
      creationRequestId: `team:${token.id}:${failedKey}:${index + 1}`,
      id,
      title: `Failed Team Intake transaction verification ${index + 1}`,
    }),
    activityMessage: "Must roll back",
    notifications: index === 1 ? [{
      type: "task.proposed",
      actor_profile_id: profileId,
      recipient_profile_id: `missing-profile-${suffix}`,
      entity_type: "task",
      entity_id: id,
      title: "Must roll back",
      body: "Must roll back",
    }] : [],
  }));

  await client.query("savepoint failed_batch");
  try {
    await client.query(
      `select public.create_team_task_intake_batch_transaction($1, $2, $3, $4, $5::jsonb, null, 'transaction verifier')`,
      [
        token.id,
        profileId,
        failedKey,
        createHash("sha256").update(JSON.stringify(failedItems)).digest("hex"),
        JSON.stringify(failedItems),
      ],
    );
    throw new Error("Invalid Team Task Intake batch unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "23503") throw error;
    await client.query("rollback to savepoint failed_batch");
  }

  const rolledBack = await client.query(
    `select
      (select count(*)::integer from public.tasks where id = any($1::text[])) as task_count,
      (select count(*)::integer from public.task_activity where task_id = any($1::text[])) as activity_count,
      (select count(*)::integer from public.team_task_intake_batches where token_id = $2 and idempotency_key = $3) as batch_count`,
    [failedTaskIds, token.id, failedKey],
  );
  if (rolledBack.rows[0]?.task_count || rolledBack.rows[0]?.activity_count || rolledBack.rows[0]?.batch_count) {
    throw new Error("Failed Team Task Intake left partial database state.");
  }

  console.log("Team Task Intake transaction verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
