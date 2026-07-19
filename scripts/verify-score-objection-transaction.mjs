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
const suffix = Date.now();
const projectId = `verify-score-objection-project-${suffix}`;
const sprintId = `verify-score-objection-${suffix}`;
const ceoId = `${sprintId}-ceo`;
const claimantId = `${sprintId}-claimant`;
const secondReviewerId = `${sprintId}-second-reviewer`;

await client.connect();
await client.query("begin");

try {
  await client.query(
    `insert into public.profiles (id, name, role, platform_role)
     values
       ($1, 'Score objection CEO', 'admin', 'ceo'),
       ($2, 'Score objection claimant', 'member', 'founder'),
       ($3, 'Score objection second reviewer', 'member', 'founder')`,
    [ceoId, claimantId, secondReviewerId],
  );
  await client.query(
    `insert into public.projects (id, name, range_label, review_objection_window_hours)
     values ($1, 'Score objection verification', 'Verification', 48)`,
    [projectId],
  );
  await client.query(
    `insert into public.sprints (id, project_id, name, status, start_date, end_date)
     values (
       $1, $2, 'Score objection verification', 'review',
       (clock_timestamp() at time zone 'Europe/Berlin')::date - 14,
       (clock_timestamp() at time zone 'Europe/Berlin')::date - 1
     )`,
    [sprintId, projectId],
  );
  const directObjection = await client.query(
    `select public.create_score_objection_transaction(
      $1, $2, 'Accepted score correction verification', null, 'score objection create verifier'
    ) as result`,
    [sprintId, claimantId],
  );
  const ownObjection = await client.query(
    `select public.create_score_objection_transaction(
      $1, $2, 'CEO own objection verification', null, 'score objection create verifier'
    ) as result`,
    [sprintId, ceoId],
  );
  const directObjectionId = directObjection.rows[0]?.result?.id;
  const ownObjectionId = ownObjection.rows[0]?.result?.id;
  if (!directObjectionId || !ownObjectionId) throw new Error("Could not create score objection verification state.");

  const expiredSprint = await client.query(
    `update public.sprints
     set review_due_at = clock_timestamp() - interval '1 minute', updated_at = clock_timestamp()
     where id = $1
     returning updated_at::text as updated_at`,
    [sprintId],
  );
  const sprintRevision = expiredSprint.rows[0]?.updated_at;
  await client.query("savepoint lock_with_open_objection");
  try {
    await client.query(
      `select public.lock_sprint_with_review_window_transaction(
        $1, $2, '[]'::jsonb, '{}'::text[], '[]'::jsonb, '[]'::jsonb,
        '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
        $3, null, 'score objection lock verifier'
      )`,
      [sprintId, sprintRevision, ceoId],
    );
    throw new Error("Sprint unexpectedly locked with an unresolved score objection.");
  } catch (error) {
    if (error?.code !== "P0004") throw error;
    await client.query("rollback to savepoint lock_with_open_objection");
  }

  const resolved = await client.query(
    `select public.process_score_objection_transaction(
      $1, $2, $3, 'resolve', 'accepted', 'Correction verified',
      8, 3, 2, null, null, null, 'score objection transaction verifier'
    ) as result`,
    [sprintId, directObjectionId, ceoId],
  );
  if (resolved.rows[0]?.result?.objection?.status !== "accepted" || resolved.rows[0]?.result?.score?.total_points !== 13) {
    throw new Error("Accepted score objection did not return its corrected score.");
  }

  await client.query("savepoint own_without_second_review");
  try {
    await client.query(
      `select public.process_score_objection_transaction(
        $1, $2, $3, 'resolve', 'reviewed', 'Must be rejected',
        null, null, null, null, null, null, 'score objection verifier'
      )`,
      [sprintId, ownObjectionId, ceoId],
    );
    throw new Error("CEO unexpectedly resolved an own objection without independent review.");
  } catch (error) {
    if (error?.code !== "P0005") throw error;
    await client.query("rollback to savepoint own_without_second_review");
  }

  const assigned = await client.query(
    `select public.process_score_objection_transaction(
      $1, $2, $3, 'assign_second_review', null, null,
      null, null, null, $4, null, null, 'score objection assignment verifier'
    ) as result`,
    [sprintId, ownObjectionId, ceoId, secondReviewerId],
  );
  if (assigned.rows[0]?.result?.objection?.second_reviewer_profile_id !== secondReviewerId) {
    throw new Error("Independent second reviewer was not assigned.");
  }

  await client.query("savepoint resolve_while_pending");
  try {
    await client.query(
      `select public.process_score_objection_transaction(
        $1, $2, $3, 'resolve', 'reviewed', 'Must wait',
        null, null, null, null, null, null, 'score objection verifier'
      )`,
      [sprintId, ownObjectionId, ceoId],
    );
    throw new Error("CEO unexpectedly resolved an objection while second review was pending.");
  } catch (error) {
    if (error?.code !== "P0004") throw error;
    await client.query("rollback to savepoint resolve_while_pending");
  }

  await client.query("savepoint wrong_second_reviewer");
  try {
    await client.query(
      `select public.process_score_objection_transaction(
        $1, $2, $3, 'second_review', null, null,
        null, null, null, null, 'Wrong reviewer', null, 'score objection verifier'
      )`,
      [sprintId, ownObjectionId, claimantId],
    );
    throw new Error("An unassigned contributor unexpectedly submitted the second review.");
  } catch (error) {
    if (error?.code !== "P0005") throw error;
    await client.query("rollback to savepoint wrong_second_reviewer");
  }

  const secondReview = await client.query(
    `select public.process_score_objection_transaction(
      $1, $2, $3, 'second_review', null, null,
      null, null, null, null, 'Independent assessment complete', null, 'score objection second-review verifier'
    ) as result`,
    [sprintId, ownObjectionId, secondReviewerId],
  );
  if (!secondReview.rows[0]?.result?.objection?.second_reviewed_at) {
    throw new Error("Assigned second review was not stored.");
  }

  await client.query("savepoint duplicate_second_review");
  try {
    await client.query(
      `select public.process_score_objection_transaction(
        $1, $2, $3, 'second_review', null, null,
        null, null, null, null, 'Duplicate', null, 'score objection verifier'
      )`,
      [sprintId, ownObjectionId, secondReviewerId],
    );
    throw new Error("Duplicate second review unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "P0006") throw error;
    await client.query("rollback to savepoint duplicate_second_review");
  }

  const finalResolution = await client.query(
    `select public.process_score_objection_transaction(
      $1, $2, $3, 'resolve', 'reviewed', 'Final CEO decision after second review',
      null, null, null, null, null, null, 'score objection final verifier'
    ) as result`,
    [sprintId, ownObjectionId, ceoId],
  );
  if (finalResolution.rows[0]?.result?.objection?.status !== "reviewed") {
    throw new Error("CEO did not finalize the objection after second review.");
  }

  const persisted = await client.query(
    `select
      (select total_points from public.founder_sprint_scores where sprint_id = $1 and profile_id = $2) as total_points,
      (select count(*)::integer from public.audit_log where entity_id = $3::text and action like 'score_objection.%') as own_audit_count`,
    [sprintId, claimantId, ownObjectionId],
  );
  if (persisted.rows[0]?.total_points !== 13 || persisted.rows[0]?.own_audit_count !== 4) {
    throw new Error("Score objection process was not persisted atomically.");
  }

  const locked = await client.query(
    `select public.lock_sprint_with_review_window_transaction(
      $1, $2, '[]'::jsonb, '{}'::text[], '[]'::jsonb, '[]'::jsonb,
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
      $3, null, 'score objection finalized lock verifier'
    ) as result`,
    [sprintId, sprintRevision, ceoId],
  );
  if (locked.rows[0]?.result?.sprint?.scoreLocked !== true) {
    throw new Error("Sprint did not lock after every score objection was resolved.");
  }

  console.log("Transactional score objection verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
