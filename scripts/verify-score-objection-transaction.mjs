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
const sprintId = `verify-score-objection-${suffix}`;

await client.connect();
await client.query("begin");

try {
  const profiles = await client.query(
    `select id from public.profiles order by id limit 2`,
  );
  if (profiles.rows.length < 2) throw new Error("Score objection verification requires two profiles.");
  const firstReviewerId = profiles.rows[0].id;
  const secondReviewerId = profiles.rows[1].id;

  await client.query(
    `insert into public.sprints (id, project_id, name, status, start_date, end_date)
     values ($1, 'findmydoc-founder-execution', 'Score objection verification', 'review', '2098-02-01', '2098-02-14')`,
    [sprintId],
  );
  const objections = await client.query(
    `insert into public.score_objections (sprint_id, profile_id, status, comment)
     values
       ($1, $2, 'open', 'Accepted score correction verification'),
       ($1, $2, 'open', 'Rollback verification')
     returning id`,
    [sprintId, firstReviewerId],
  );
  const objectionId = objections.rows[0]?.id;
  const failedObjectionId = objections.rows[1]?.id;
  if (!objectionId || !failedObjectionId) throw new Error("Could not create score objection verification state.");

  const resolved = await client.query(
    `select public.resolve_score_objection_transaction(
      $1, $2, $3, 'resolve', 'accepted', 'Correction verified',
      8, 3, 2, null, null, 'score objection transaction verifier'
    ) as result`,
    [sprintId, objectionId, firstReviewerId],
  );
  if (
    resolved.rows[0]?.result?.objection?.status !== "accepted" ||
    resolved.rows[0]?.result?.score?.total_points !== 13
  ) {
    throw new Error("Accepted score objection did not return its corrected score.");
  }

  const persisted = await client.query(
    `select
      (select resolved_delivery_points from public.score_objections where id = $1) as delivery_points,
      (select total_points from public.founder_sprint_scores where sprint_id = $2 and profile_id = $3) as total_points,
      (select count(*)::integer from public.audit_log where entity_id = $1::text and action = 'score_objection.review') as audit_count`,
    [objectionId, sprintId, firstReviewerId],
  );
  if (
    persisted.rows[0]?.delivery_points !== 8 ||
    persisted.rows[0]?.total_points !== 13 ||
    persisted.rows[0]?.audit_count !== 1
  ) {
    throw new Error("Score objection correction was not committed atomically.");
  }

  await client.query("savepoint same_reviewer");
  try {
    await client.query(
      `select public.resolve_score_objection_transaction(
        $1, $2, $3, 'second_review', null, null,
        null, null, null, 'Must be rejected', null, 'score objection verifier'
      )`,
      [sprintId, objectionId, firstReviewerId],
    );
    throw new Error("First reviewer unexpectedly completed the second review.");
  } catch (error) {
    if (error?.code !== "P0005") throw error;
    await client.query("rollback to savepoint same_reviewer");
  }

  const secondReview = await client.query(
    `select public.resolve_score_objection_transaction(
      $1, $2, $3, 'second_review', null, null,
      null, null, null, 'Independent correction confirmed', null, 'score objection second-review verifier'
    ) as result`,
    [sprintId, objectionId, secondReviewerId],
  );
  if (
    secondReview.rows[0]?.result?.objection?.second_reviewer_profile_id !== secondReviewerId ||
    secondReview.rows[0]?.result?.objection?.second_review_decision !== "Independent correction confirmed"
  ) {
    throw new Error("Independent second review was not stored.");
  }

  await client.query("savepoint duplicate_second_review");
  try {
    await client.query(
      `select public.resolve_score_objection_transaction(
        $1, $2, $3, 'second_review', null, null,
        null, null, null, 'Duplicate', null, 'score objection verifier'
      )`,
      [sprintId, objectionId, firstReviewerId],
    );
    throw new Error("Duplicate second review unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "P0006") throw error;
    await client.query("rollback to savepoint duplicate_second_review");
  }

  await client.query("savepoint invalid_actor");
  try {
    await client.query(
      `select public.resolve_score_objection_transaction(
        $1, $2, $3, 'resolve', 'accepted', 'Must roll back',
        12, 4, 4, null, null, 'score objection rollback verifier'
      )`,
      [sprintId, failedObjectionId, `missing-profile-${suffix}`],
    );
    throw new Error("Score correction with invalid actor unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "23503") throw error;
    await client.query("rollback to savepoint invalid_actor");
  }

  const rolledBack = await client.query(
    `select
      (select status from public.score_objections where id = $1) as status,
      (select count(*)::integer from public.audit_log where entity_type = 'score_objection' and entity_id = $1::text and action like 'score_objection.%') as audit_count`,
    [failedObjectionId],
  );
  if (rolledBack.rows[0]?.status !== "open" || rolledBack.rows[0]?.audit_count !== 0) {
    throw new Error("Failed score objection resolution left partial state.");
  }

  console.log("Transactional score objection verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
