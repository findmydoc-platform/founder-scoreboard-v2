import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { loadLocalEnv } from "./lib/env.mjs";

await loadLocalEnv();

const password = process.env.SUPABASE_DB_PASSWORD;
const host = process.env.SUPABASE_DB_HOST || "db.wmccchyodlljkkytebwg.supabase.co";
const port = Number(process.env.SUPABASE_DB_PORT || 5432);
const user = process.env.SUPABASE_DB_USER || "postgres";
const database = process.env.SUPABASE_DB_NAME || "postgres";
const ssl = process.env.SUPABASE_DB_SSL === "false" ? false : { rejectUnauthorized: false };

if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD.");
  process.exit(1);
}

const client = new pg.Client({ host, port, user, password, database, ssl });

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deliverableItem(packageId, milestoneId, ownerId) {
  return [{
    itemType: "deliverable",
    title: "Planning Items transaction verification",
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
  }];
}

await client.connect();
await client.query("begin");

try {
  const profileResult = await client.query("select id from public.profiles where platform_role in ('ceo', 'deputy') order by id limit 1");
  const profileId = profileResult.rows[0]?.id;
  if (!profileId) throw new Error("No CEO or Deputy profile is available for Planning Items verification.");

  const initiativeResult = await client.query(
    "select id, milestone_id from public.packages where approval_status <> 'rejected' and trashed_at is null order by id limit 1",
  );
  const initiative = initiativeResult.rows[0];
  if (!initiative?.id || !initiative.milestone_id) throw new Error("No usable Initiative is available for Planning Items verification.");

  const tokenHash = createHash("sha256").update(`verification-${randomUUID()}`).digest("hex");
  const tokenResult = await client.query(
    "select public.create_team_planning_items_token($1, $2, $3, $4, true) as result",
    [profileId, "Planning Items verification", tokenHash, "…verify"],
  );
  const token = tokenResult.rows[0]?.result;
  if (!token?.id || token.token_hash || !token.scopes?.includes("write:planning-items:update")) {
    throw new Error("Planning Items token RPC did not return update-scoped safe metadata.");
  }

  const items = deliverableItem(initiative.id, initiative.milestone_id, profileId);
  const createKey = randomUUID();
  const createResult = await client.query(
    "select public.create_team_planning_items_transaction($1, $2, $3, $4, $5::jsonb, null, 'transaction verifier') as result",
    [token.id, profileId, createKey, hash(items), JSON.stringify(items)],
  );
  const created = createResult.rows[0]?.result;
  const taskId = created?.items?.[0]?.item?.id;
  if (created?.replayed !== false || !taskId) throw new Error("Planning Items create was not committed atomically.");

  const persisted = await client.query(
    "select title, updated_at::text as updated_at, task_type, approval_status, sprint_id, score_relevant from public.tasks where id = $1",
    [taskId],
  );
  const task = persisted.rows[0];
  if (task?.task_type !== "deliverable" || task.approval_status !== "proposed" || task.sprint_id !== null || task.score_relevant !== false) {
    throw new Error("Planning Items create did not preserve the approval gate.");
  }

  const patch = { priority: "P1" };
  const updateKey = randomUUID();
  const updateArgs = [
    token.id, profileId, "deliverable", taskId, task.updated_at, updateKey,
    hash({ itemId: taskId, itemType: "deliverable", expectedUpdatedAt: task.updated_at, normalizedPatch: patch }),
    JSON.stringify({ priority: "P1" }), JSON.stringify(["priority"]), JSON.stringify([]),
  ];
  const updatedResult = await client.query(
    "select public.update_team_planning_item_transaction($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, null, 'transaction verifier') as result",
    updateArgs,
  );
  const updated = updatedResult.rows[0]?.result;
  if (updated?.replayed !== false || updated?.item?.priority !== "P1") throw new Error("Planning Items PATCH did not update the requested property.");

  const replayedResult = await client.query(
    "select public.update_team_planning_item_transaction($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, null, 'transaction verifier') as result",
    updateArgs,
  );
  if (replayedResult.rows[0]?.result?.replayed !== true) throw new Error("Planning Items PATCH did not return its immutable idempotent replay.");

  console.log("Planning Items transaction verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
