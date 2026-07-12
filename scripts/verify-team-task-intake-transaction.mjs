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

const client = new pg.Client({ host, port: 5432, user, password, database, ssl: { rejectUnauthorized: false } });

function deliverableItem(index, packageId, milestoneId, ownerId) {
  return {
    itemType: "deliverable",
    title: `Team Intake v2 transaction verification ${index}`,
    problemStatement: "A transactional verification is required.",
    intendedOutcome: "The complete batch is committed once.",
    scopeConstraints: "Verification only.",
    acceptanceCriteria: "The batch is replayable.",
    evidenceRequired: "Database assertions.",
    definitionOfDone: "All assertions pass.",
    packageId,
    milestoneId,
    ownerId,
    priority: "P2",
  };
}

function requestHash(items) {
  return createHash("sha256").update(JSON.stringify(items)).digest("hex");
}

async function commitBatch({ idempotencyKey, items, profileId, tokenId }) {
  return client.query(
    "select public.create_team_task_intake_v2_transaction($1, $2, $3, $4, $5::jsonb, null, 'transaction verifier') as result",
    [tokenId, profileId, idempotencyKey, requestHash(items), JSON.stringify(items)],
  );
}

await client.connect();
await client.query("begin");

try {
  const profileResult = await client.query("select id from public.profiles where platform_role = 'founder' order by id limit 1");
  const profileId = profileResult.rows[0]?.id;
  if (!profileId) throw new Error("No Founder profile is available for Team Task Intake verification.");

  const initiativeResult = await client.query(
    "select id, milestone_id from public.packages where approval_status <> 'rejected' order by id limit 1",
  );
  const initiative = initiativeResult.rows[0];
  if (!initiative?.id || !initiative.milestone_id) throw new Error("No usable Initiative is available for Team Task Intake verification.");

  const tokenHash = createHash("sha256").update(`verification-${randomUUID()}`).digest("hex");
  const tokenResult = await client.query(
    "select public.create_team_task_intake_token($1, $2, $3, $4) as result",
    [profileId, "Transactional verification", tokenHash, "…verify"],
  );
  const token = tokenResult.rows[0]?.result;
  if (!token?.id || token.token_hash) throw new Error("Token RPC did not return safe one-time token metadata.");

  const items = [deliverableItem(1, initiative.id, initiative.milestone_id, profileId)];
  const idempotencyKey = randomUUID();
  const committed = await commitBatch({ idempotencyKey, items, profileId, tokenId: token.id });
  const committedResult = committed.rows[0]?.result;
  if (committedResult?.replayed !== false || committedResult?.items?.[0]?.itemType !== "deliverable") {
    throw new Error("Team Task Intake v2 was not committed atomically.");
  }

  const taskId = committedResult.items[0]?.item?.id;
  if (!taskId) throw new Error("Team Task Intake v2 returned no deliverable id.");
  const persisted = await client.query(
    "select task_type, approval_status, sprint_id, score_relevant from public.tasks where id = $1",
    [taskId],
  );
  const task = persisted.rows[0];
  if (task?.task_type !== "deliverable" || task.approval_status !== "proposed" || task.sprint_id !== null || task.score_relevant !== false) {
    throw new Error("Team Task Intake v2 did not preserve the approval gate.");
  }

  const replayed = await commitBatch({ idempotencyKey, items, profileId, tokenId: token.id });
  if (replayed.rows[0]?.result?.replayed !== true || replayed.rows[0]?.result?.items?.[0]?.item?.id !== taskId) {
    throw new Error("Team Task Intake v2 did not return the immutable idempotent replay.");
  }

  console.log("Team Task Intake v2 transaction verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
