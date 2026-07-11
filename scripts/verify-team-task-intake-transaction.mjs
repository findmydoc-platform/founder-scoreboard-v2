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

function proposalItem(index) {
  return {
    title: `Team Intake transaction verification ${index}`,
    description: `Proposal ${index}`,
    problemStatement: "A transactional verification is required.",
    intendedOutcome: "The complete batch is committed once.",
    scopeConstraints: "Verification only.",
    acceptanceCriteria: "The batch is replayable.",
    evidenceRequired: "Database assertions.",
    definitionOfDone: "All assertions pass.",
    taskType: "proposal",
    parentTaskId: "",
    packageId: "",
    milestoneId: "",
    ownerId: "",
    priority: "P2",
    status: "Vorschlag",
    workstream: "Verification",
    startDate: "",
    endDate: "",
    deadline: "",
    hours: 0,
  };
}

function requestHash(items) {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}

async function commitBatch({ idempotencyKey, items, profileId, tokenId, hash = requestHash(items) }) {
  return client.query(
    `select public.create_team_task_intake_batch_transaction($1, $2, $3, $4, $5::jsonb, null, 'transaction verifier') as result`,
    [tokenId, profileId, idempotencyKey, hash, JSON.stringify(items)],
  );
}

await client.connect();
await client.query("begin");

try {
  const profileResult = await client.query(
    `select id
     from public.profiles
     where platform_role = 'founder'
     order by id
     limit 1`,
  );
  const profileId = profileResult.rows[0]?.id;
  if (!profileId) throw new Error("No Founder profile is available for Team Task Intake verification.");

  const otherProfileResult = await client.query(
    `select id from public.profiles where id <> $1 order by id limit 1`,
    [profileId],
  );
  const otherProfileId = otherProfileResult.rows[0]?.id;
  if (!otherProfileId) throw new Error("No second profile is available for ownership verification.");

  const tokenHash = createHash("sha256").update(`verification-${randomUUID()}`).digest("hex");
  const tokenResult = await client.query(
    `select public.create_team_task_intake_token($1, $2, $3, $4) as result`,
    [profileId, "Transactional verification", tokenHash, "…verify"],
  );
  const token = tokenResult.rows[0]?.result;
  if (!token?.id || token.token_hash) throw new Error("Token RPC did not return safe one-time token metadata.");
  const tokenLifetimeDays = (Date.parse(token.expires_at) - Date.parse(token.created_at)) / 86_400_000;
  if (tokenLifetimeDays <= 89.99 || tokenLifetimeDays > 90) throw new Error("Token RPC did not enforce the 90-day lifetime.");

  const authenticated = await client.query(
    `select public.authenticate_team_task_intake_token($1, 'write:task-intake') as result`,
    [tokenHash],
  );
  if (authenticated.rows[0]?.result?.profile?.id !== profileId) throw new Error("Token authentication did not return the current Founder profile.");

  const idempotencyKey = randomUUID();
  const items = [proposalItem(1), proposalItem(2)];
  const hash = requestHash(items);
  const committed = await commitBatch({ idempotencyKey, items, profileId, tokenId: token.id, hash });
  const committedResult = committed.rows[0]?.result;
  if (committedResult?.replayed !== false || committedResult?.tasks?.length !== 2) {
    throw new Error("Team Task Intake batch was not committed atomically.");
  }
  const taskIds = committedResult.tasks.map((task) => task.id);
  const originalFirstTitle = committedResult.tasks[0].title;

  const persisted = await client.query(
    `select
      (select count(*)::integer from public.tasks where id = any($1::text[])) as task_count,
      (select count(*)::integer from public.task_activity where task_id = any($1::text[])) as activity_count,
      (select count(*)::integer from public.team_task_intake_batches where token_id = $2 and idempotency_key = $3 and jsonb_array_length(response_tasks) = 2) as batch_count,
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

  await client.query(`update public.tasks set title = 'Changed after commit' where id = $1`, [taskIds[0]]);
  const replayed = await commitBatch({ idempotencyKey, items, profileId, tokenId: token.id, hash });
  if (
    replayed.rows[0]?.result?.replayed !== true
    || replayed.rows[0]?.result?.tasks?.length !== 2
    || replayed.rows[0]?.result?.tasks?.[0]?.title !== originalFirstTitle
  ) {
    throw new Error("Repeated Team Task Intake did not return the immutable original response.");
  }

  await client.query("savepoint changed_replay");
  try {
    await commitBatch({ idempotencyKey, items, profileId, tokenId: token.id, hash: "c".repeat(64) });
    throw new Error("Changed Team Task Intake replay unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "P0003") throw error;
    await client.query("rollback to savepoint changed_replay");
  }

  const parentId = `verify-team-intake-parent-${Date.now()}`;
  await client.query(
    `select public.create_task_transaction($1::jsonb)`,
    [JSON.stringify({
      id: parentId,
      creation_request_id: `verify-parent-${randomUUID()}`,
      project_id: "findmydoc-founder-execution",
      title: "Other Founder Deliverable",
      status: "Offen",
      priority: "P2",
      owner: otherProfileId,
      assignee: otherProfileId,
      created_by: otherProfileId,
      sort_order: 0,
      sprint_id: null,
      score_points: 0,
      score_final: false,
      task_type: "deliverable",
      parent_task_id: null,
      score_relevant: true,
    })],
  );

  await client.query("savepoint foreign_parent");
  try {
    const foreignParentItem = {
      ...proposalItem(3),
      taskType: "sub_issue",
      parentTaskId: parentId,
      ownerId: profileId,
      status: "Offen",
    };
    await commitBatch({ idempotencyKey: randomUUID(), items: [foreignParentItem], profileId, tokenId: token.id });
    throw new Error("Founder unexpectedly created a Sub-Issue below another profile's Deliverable.");
  } catch (error) {
    if (error?.code !== "P0006") throw error;
    await client.query("rollback to savepoint foreign_parent");
  }

  await client.query("savepoint role_downgrade");
  try {
    await client.query(`update public.profiles set platform_role = 'viewer' where id = $1`, [profileId]);
    await commitBatch({ idempotencyKey: randomUUID(), items: [proposalItem(4)], profileId, tokenId: token.id });
    throw new Error("Downgraded Founder unexpectedly committed Team Task Intake.");
  } catch (error) {
    if (error?.code !== "P0006") throw error;
    await client.query("rollback to savepoint role_downgrade");
  }

  const failedKey = randomUUID();
  const invalidItems = [proposalItem(5), { ...proposalItem(6), unsupportedField: true }];
  await client.query("savepoint failed_batch");
  try {
    await commitBatch({ idempotencyKey: failedKey, items: invalidItems, profileId, tokenId: token.id });
    throw new Error("Invalid Team Task Intake batch unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "22023") throw error;
    await client.query("rollback to savepoint failed_batch");
  }
  const failedSuffix = replaceUuid(failedKey);
  const rolledBack = await client.query(
    `select
      (select count(*)::integer from public.tasks where id like $1) as task_count,
      (select count(*)::integer from public.team_task_intake_batches where token_id = $2 and idempotency_key = $3) as batch_count`,
    [`${profileId}-team-intake-${failedSuffix}-%`, token.id, failedKey],
  );
  if (rolledBack.rows[0]?.task_count || rolledBack.rows[0]?.batch_count) {
    throw new Error("Failed Team Task Intake left partial database state.");
  }

  const revoked = await client.query(
    `select public.revoke_team_task_intake_token($1, $2) as token_id`,
    [token.id, profileId],
  );
  if (revoked.rows[0]?.token_id !== token.id) throw new Error("Token revocation did not return the revoked token.");
  await client.query("savepoint revoked_token");
  try {
    await commitBatch({ idempotencyKey: randomUUID(), items: [proposalItem(7)], profileId, tokenId: token.id });
    throw new Error("Revoked Team Task Intake token unexpectedly committed a batch.");
  } catch (error) {
    if (error?.code !== "P0004") throw error;
    await client.query("rollback to savepoint revoked_token");
  }

  console.log("Team Task Intake hardening verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}

function replaceUuid(value) {
  return value.replaceAll("-", "");
}
