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

async function expectDatabaseCode(run, expectedCode, message) {
  const savepoint = `expected_error_${randomUUID().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await run();
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    if (error?.code === expectedCode) return;
    throw error;
  }
  await client.query(`release savepoint ${savepoint}`);
  throw new Error(message);
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
  const profileId = "planning-items-verifier-ceo";
  await client.query(
    `insert into public.profiles (id, name, role, platform_role) values
      ('planning-items-verifier-ceo', 'Planning Items Verifier CEO', 'admin', 'ceo'),
      ('planning-items-verifier-deputy', 'Planning Items Verifier Deputy', 'member', 'deputy'),
      ('planning-items-verifier-owner', 'Planning Items Verifier Owner', 'member', 'founder'),
      ('planning-items-verifier-other', 'Planning Items Verifier Other', 'member', 'founder')
     on conflict (id) do nothing`,
  );
  await client.query(
    "insert into public.projects (id, name) values ('findmydoc-founder-execution', 'Planning Items verification') on conflict (id) do nothing",
  );
  await client.query(
    "insert into public.milestones (id, project_id, title, status) values ('planning-items-verifier-milestone', 'findmydoc-founder-execution', 'Planning Items verification', 'active')",
  );
  await client.query(
    `insert into public.packages (
      id, project_id, title, milestone_id, owner_id, accountable_profile_id,
      responsible_profile_ids, approval_status, priority
    ) values (
      'planning-items-verifier-initiative', 'findmydoc-founder-execution', 'Planning Items verification',
      'planning-items-verifier-milestone', 'planning-items-verifier-owner', 'planning-items-verifier-ceo',
      array['planning-items-verifier-owner']::text[], 'approved', 'P2'
    )`,
  );
  const initiative = { id: "planning-items-verifier-initiative", milestone_id: "planning-items-verifier-milestone" };

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

  const statusKey = randomUUID();
  const statusPatch = { status: "In Arbeit" };
  const statusArgs = [
    token.id, profileId, "deliverable", taskId, updated.item.updated_at, statusKey,
    hash({ itemId: taskId, itemType: "deliverable", expectedUpdatedAt: updated.item.updated_at, normalizedPatch: statusPatch }),
    JSON.stringify(statusPatch), JSON.stringify(["status"]), JSON.stringify([
      { field: "githubIssueSyncStatus", before: "not_synced", after: "not_synced", reason: "projection" },
    ]),
  ];
  const statusResult = await client.query(
    "select public.update_team_planning_item_transaction($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, null, 'transaction verifier') as result",
    statusArgs,
  );
  const statusUpdated = statusResult.rows[0]?.result;
  if (statusUpdated?.item?.status !== "In Arbeit" || statusUpdated?.item?.github_issue_sync_status !== "not_synced") {
    throw new Error("Planning Items status PATCH did not persist the work status and GitHub projection reset.");
  }
  const statusEvidence = await client.query(
    `select
      exists(select 1 from public.audit_log where entity_id = $1 and action = 'task.status_changed') as activity,
      exists(select 1 from public.audit_log where entity_id = $1 and action = 'team.planning_items.update') as audit`,
    [taskId],
  );
  if (!statusEvidence.rows[0]?.activity || !statusEvidence.rows[0]?.audit) {
    throw new Error("Planning Items status PATCH did not atomically persist activity and audit evidence.");
  }
  const statusReplay = await client.query(
    "select public.update_team_planning_item_transaction($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, null, 'transaction verifier') as result",
    statusArgs,
  );
  if (statusReplay.rows[0]?.result?.replayed !== true) {
    throw new Error("Planning Items status PATCH did not replay idempotently.");
  }

  const reviewReady = await client.query(
    `update public.tasks
     set approval_status = 'approved',
         review_owner_profile_id = $2,
         updated_at = clock_timestamp()
     where id = $1
     returning updated_at::text as updated_at`,
    [taskId, profileId],
  );
  const reviewExpectedUpdatedAt = reviewReady.rows[0]?.updated_at;
  const reviewKey = randomUUID();
  const reviewResult = await client.query(
    "select public.update_team_planning_item_transaction($1, $2, 'deliverable', $3, $4::timestamptz, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, null, 'transaction verifier') as result",
    [
      token.id,
      profileId,
      taskId,
      reviewExpectedUpdatedAt,
      reviewKey,
      hash({ itemId: taskId, status: "Review", expectedUpdatedAt: reviewExpectedUpdatedAt }),
      JSON.stringify({ status: "Review" }),
      JSON.stringify(["status"]),
      JSON.stringify([{ field: "notification", before: null, after: { type: "task.review_requested" }, reason: "review" }]),
    ],
  );
  const reviewed = reviewResult.rows[0]?.result?.item;
  if (reviewed?.status !== "Review" || reviewed.review_status !== "requested" || reviewed.score_points !== 0 || reviewed.score_final !== false || !reviewed.review_requested_at) {
    throw new Error("Planning Items Review status did not execute the complete review transition.");
  }
  const reviewNotification = await client.query(
    "select count(*)::int as count from public.notification_events where entity_id = $1 and type = 'task.review_requested' and recipient_profile_id = $2",
    [taskId, profileId],
  );
  if (reviewNotification.rows[0]?.count !== 1) {
    throw new Error("Planning Items Review status did not notify the Review Owner exactly once.");
  }

  const deputyTokenResult = await client.query(
    "select public.create_team_planning_items_token($1, $2, $3, $4, true) as result",
    ["planning-items-verifier-deputy", "Planning Items Deputy verification", createHash("sha256").update(`deputy-${randomUUID()}`).digest("hex"), "…deputy"],
  );
  const founderTokenResult = await client.query(
    "select public.create_team_planning_items_token($1, $2, $3, $4, true) as result",
    ["planning-items-verifier-other", "Planning Items Founder verification", createHash("sha256").update(`founder-${randomUUID()}`).digest("hex"), "…founder"],
  );
  const deputyToken = deputyTokenResult.rows[0]?.result;
  const founderToken = founderTokenResult.rows[0]?.result;

  const permissionItems = deliverableItem(initiative.id, initiative.milestone_id, "planning-items-verifier-owner");
  const permissionCreate = await client.query(
    "select public.create_team_planning_items_transaction($1, $2, $3, $4, $5::jsonb, null, 'transaction verifier') as result",
    [token.id, profileId, randomUUID(), hash(permissionItems), JSON.stringify(permissionItems)],
  );
  const permissionTaskId = permissionCreate.rows[0]?.result?.items?.[0]?.item?.id;
  const approvedParent = await client.query(
    `update public.tasks
     set approval_status = 'approved', updated_at = clock_timestamp()
     where id = $1
     returning updated_at::text as updated_at`,
    [permissionTaskId],
  );
  const parentUpdatedAt = approvedParent.rows[0]?.updated_at;

  await expectDatabaseCode(
    () => client.query(
      "select public.update_team_planning_item_transaction($1, $2, 'deliverable', $3, $4::timestamptz, $5, $6, $7::jsonb, '[\"status\"]'::jsonb, '[]'::jsonb) as result",
      [deputyToken.id, "planning-items-verifier-deputy", permissionTaskId, parentUpdatedAt, randomUUID(), hash({ role: "deputy-final" }), JSON.stringify({ status: "Erledigt" })],
    ),
    "P0007",
    "Deputy unexpectedly completed a Deliverable.",
  );
  await expectDatabaseCode(
    () => client.query(
      "select public.update_team_planning_item_transaction($1, $2, 'deliverable', $3, $4::timestamptz, $5, $6, $7::jsonb, '[\"status\"]'::jsonb, '[]'::jsonb) as result",
      [founderToken.id, "planning-items-verifier-other", permissionTaskId, parentUpdatedAt, randomUUID(), hash({ role: "unrelated-founder" }), JSON.stringify({ status: "Blockiert" })],
    ),
    "P0007",
    "Unrelated Founder unexpectedly changed a Deliverable status.",
  );

  const subIssueItems = [{
    itemType: "sub_issue",
    title: "Planning Items status permission verification",
    parentTaskId: permissionTaskId,
    ownerId: "planning-items-verifier-owner",
    priority: "P2",
  }];
  const subIssueCreate = await client.query(
    "select public.create_team_planning_items_transaction($1, $2, $3, $4, $5::jsonb, null, 'transaction verifier') as result",
    [token.id, profileId, randomUUID(), hash(subIssueItems), JSON.stringify(subIssueItems)],
  );
  const subIssue = subIssueCreate.rows[0]?.result?.items?.[0]?.item;
  const subIssueComplete = await client.query(
    "select public.update_team_planning_item_transaction($1, $2, 'sub_issue', $3, $4::timestamptz, $5, $6, $7::jsonb, '[\"status\"]'::jsonb, '[]'::jsonb) as result",
    [founderToken.id, "planning-items-verifier-other", subIssue.id, subIssue.updated_at, randomUUID(), hash({ role: "sub-issue-complete" }), JSON.stringify({ status: "Erledigt" })],
  );
  const completedSubIssue = subIssueComplete.rows[0]?.result?.item;
  if (completedSubIssue?.status !== "Erledigt") {
    throw new Error("Unrelated Founder could not use the Sub-Issue completion exception.");
  }
  const subIssueReopen = await client.query(
    "select public.update_team_planning_item_transaction($1, $2, 'sub_issue', $3, $4::timestamptz, $5, $6, $7::jsonb, '[\"status\"]'::jsonb, '[]'::jsonb) as result",
    [founderToken.id, "planning-items-verifier-other", subIssue.id, completedSubIssue.updated_at, randomUUID(), hash({ role: "sub-issue-reopen" }), JSON.stringify({ status: "Offen" })],
  );
  const reopenedSubIssue = subIssueReopen.rows[0]?.result?.item;
  if (reopenedSubIssue?.status !== "Offen") {
    throw new Error("Unrelated Founder could not use the Sub-Issue reopen exception.");
  }

  await client.query(
    "update public.tasks set approval_status = 'proposed', updated_at = clock_timestamp() where id = $1",
    [permissionTaskId],
  );
  await expectDatabaseCode(
    () => client.query(
      "select public.update_team_planning_item_transaction($1, $2, 'sub_issue', $3, $4::timestamptz, $5, $6, $7::jsonb, '[\"status\"]'::jsonb, '[]'::jsonb) as result",
      [founderToken.id, "planning-items-verifier-other", subIssue.id, reopenedSubIssue.updated_at, randomUUID(), hash({ parent: "not-approved" }), JSON.stringify({ status: "Erledigt" })],
    ),
    "P0008",
    "Sub-Issue status unexpectedly changed below an unapproved parent.",
  );

  console.log("Planning Items transaction verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
