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
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  project: `verify-trash-project-${suffix}`,
  ceo: `verify-trash-ceo-${suffix}`,
  parentInitiative: `verify-trash-parent-${suffix}`,
  separateDeliverable: `verify-trash-separate-${suffix}`,
  separateChild: `verify-trash-separate-child-${suffix}`,
  linkInitiative: `verify-trash-links-${suffix}`,
  linkDeliverable: `verify-trash-link-root-${suffix}`,
  linkChild: `verify-trash-link-child-${suffix}`,
  invalidDeliverable: `verify-trash-invalid-${suffix}`,
  approvalInitiative: `verify-trash-approval-${suffix}`,
  approvalDeliverable: `verify-trash-reopen-${suffix}`,
};

async function expectDatabaseError(label, code, query, params = []) {
  await client.query(`savepoint ${label}`);
  try {
    await client.query(query, params);
    throw new Error(`${label} unexpectedly succeeded.`);
  } catch (error) {
    if (error?.code !== code) throw error;
  } finally {
    await client.query(`rollback to savepoint ${label}`);
    await client.query(`release savepoint ${label}`);
  }
}

async function insertDeliverable({ id, packageId, githubIssueUrl = null }) {
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, title, status, priority, task_type,
       approval_status, approval_revision, proposed_by, proposed_at,
       score_relevant, github_repo, github_issue_url
     ) values ($1, $2, $3, $4, 'Offen', 'P2', 'deliverable',
       'proposed', 1, $5, now(), false, 'findmydoc-platform/management', $6)`,
    [id, ids.project, packageId, `Lifecycle verification ${id}`, ids.ceo, githubIssueUrl],
  );
}

await client.connect();
await client.query("begin");

try {
  await client.query(
    `insert into public.projects (id, name, range_label)
     values ($1, 'Planning trash lifecycle verification', 'rollback-only')`,
    [ids.project],
  );
  await client.query(
    `insert into public.profiles (id, name, role, platform_role)
     values ($1, 'Lifecycle verifier', 'admin', 'ceo')`,
    [ids.ceo],
  );

  await expectDatabaseError(
    "null_withdraw_revision",
    "22023",
    `select public.withdraw_planning_item_transaction(
      'deliverable', 'missing', null, $1, 'Verification', null, null
    )`,
    [ids.ceo],
  );
  await expectDatabaseError(
    "null_approval_revision",
    "22023",
    `select public.decide_deliverable_approval_transaction(
      'missing', null, 'approve', $1, null
    )`,
    [ids.ceo],
  );

  await client.query(
    `insert into public.packages (
       id, project_id, accountable_profile_id, title, approval_status,
       approval_revision, proposed_by, proposed_at
     ) values ($1, $2, $3, 'Parent restore verification', 'proposed', 1, $3, now())`,
    [ids.parentInitiative, ids.project, ids.ceo],
  );
  await insertDeliverable({ id: ids.separateDeliverable, packageId: ids.parentInitiative });
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, parent_task_id, title, status, priority,
       task_type, approval_status, score_relevant, github_repo
     ) values ($1, $2, $3, $4, 'Separate child', 'Offen', 'P2',
       'sub_issue', null, false, 'findmydoc-platform/management')`,
    [ids.separateChild, ids.project, ids.parentInitiative, ids.separateDeliverable],
  );

  const separateTrash = await client.query(
    `select public.withdraw_planning_item_transaction(
      'deliverable', $1, 1, $2, 'Separate withdrawal', null, null
    ) as result`,
    [ids.separateDeliverable, ids.ceo],
  );
  const separateTrashRevision = separateTrash.rows[0]?.result?.trashRevision;
  if (separateTrashRevision !== 1) throw new Error("Separate deliverable trash revision was not created.");

  const parentTrash = await client.query(
    `select public.withdraw_planning_item_transaction(
      'initiative', $1, 1, $2, 'Parent withdrawal', null, null
    ) as result`,
    [ids.parentInitiative, ids.ceo],
  );
  const parentTrashRevision = parentTrash.rows[0]?.result?.trashRevision;
  if (parentTrashRevision !== 1) throw new Error("Parent initiative trash revision was not created.");

  await expectDatabaseError(
    "child_before_parent_restore",
    "P0003",
    `select public.restore_planning_item_transaction(
      'deliverable', $1, $2, $3, null, null
    )`,
    [ids.separateDeliverable, separateTrashRevision, ids.ceo],
  );

  await client.query(
    `select public.restore_planning_item_transaction('initiative', $1, $2, $3, null, null)`,
    [ids.parentInitiative, parentTrashRevision, ids.ceo],
  );
  const stillTrashed = await client.query(
    `select count(*)::integer as count
     from public.tasks
     where id = any($1::text[]) and trashed_at is not null`,
    [[ids.separateDeliverable, ids.separateChild]],
  );
  if (stillTrashed.rows[0]?.count !== 2) {
    throw new Error("Parent restore incorrectly restored a separately trashed deliverable tree.");
  }

  await client.query(
    `select public.restore_planning_item_transaction('deliverable', $1, $2, $3, null, null)`,
    [ids.separateDeliverable, separateTrashRevision, ids.ceo],
  );
  const restoredTree = await client.query(
    `select count(*)::integer as count
     from public.tasks
     where id = any($1::text[]) and trashed_at is null`,
    [[ids.separateDeliverable, ids.separateChild]],
  );
  if (restoredTree.rows[0]?.count !== 2) throw new Error("Deliverable tree was not restored after its parent.");

  await client.query(
    `insert into public.packages (
       id, project_id, accountable_profile_id, title, approval_status,
       approval_revision, proposed_by, proposed_at
     ) values ($1, $2, $3, 'GitHub reference verification', 'proposed', 1, $3, now())`,
    [ids.linkInitiative, ids.project, ids.ceo],
  );
  await insertDeliverable({ id: ids.linkDeliverable, packageId: ids.linkInitiative });
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, parent_task_id, title, status, priority,
       task_type, approval_status, score_relevant, github_repo, github_issue_url
     ) values ($1, $2, $3, $4, 'URL-only child', 'Offen', 'P2',
       'sub_issue', null, false, 'findmydoc-platform/website',
       'https://github.com/findmydoc-platform/website/issues/17#issuecomment-1')`,
    [ids.linkChild, ids.project, ids.linkInitiative, ids.linkDeliverable],
  );
  await client.query(
    `select public.withdraw_planning_item_transaction(
      'deliverable', $1, 1, $2, 'URL normalization', null, null
    )`,
    [ids.linkDeliverable, ids.ceo],
  );

  const normalized = await client.query(
    `select task_id, github_repo, github_issue_number, status, status_reason
     from public.planning_github_lifecycle_outbox
     where root_type = 'deliverable' and root_id = $1
     order by task_id`,
    [ids.linkDeliverable],
  );
  const normalizedChild = normalized.rows.find((row) => row.task_id === ids.linkChild);
  const missingRoot = normalized.rows.find((row) => row.task_id === ids.linkDeliverable);
  if (
    normalizedChild?.github_repo !== "findmydoc-platform/website"
    || normalizedChild?.github_issue_number !== 17
    || normalizedChild?.status !== "pending"
  ) {
    throw new Error("URL-only sub-issue reference was not normalized canonically.");
  }
  if (missingRoot?.github_issue_number !== null || missingRoot?.status !== "pending") {
    throw new Error("Missing deliverable issue reference did not remain an issue-less pending job.");
  }

  const scopedClaim = await client.query(
    `select task_id
     from public.claim_planning_github_lifecycle_jobs_for_root(
       gen_random_uuid(), 'deliverable', $1, $2::text[], 10, 120
     )`,
    [ids.linkDeliverable, [ids.linkChild]],
  );
  if (scopedClaim.rows.length !== 1 || scopedClaim.rows[0]?.task_id !== ids.linkChild) {
    throw new Error("Scoped lifecycle claim escaped the exact root and task id set.");
  }

  await insertDeliverable({
    id: ids.invalidDeliverable,
    packageId: ids.linkInitiative,
    githubIssueUrl: "not-a-github-issue-url",
  });
  await client.query(
    `select public.withdraw_planning_item_transaction(
      'deliverable', $1, 1, $2, 'Invalid URL verification', null, null
    )`,
    [ids.invalidDeliverable, ids.ceo],
  );
  const invalidJob = await client.query(
    `select status, status_reason, last_error
     from public.planning_github_lifecycle_outbox
     where root_type = 'deliverable' and root_id = $1 and task_id = $1`,
    [ids.invalidDeliverable],
  );
  if (
    invalidJob.rows[0]?.status !== "failed"
    || invalidJob.rows[0]?.status_reason !== "invalid_issue_reference"
    || !invalidJob.rows[0]?.last_error
  ) {
    throw new Error("Malformed GitHub reference did not create a fail-closed outbox job.");
  }

  await client.query(
    `insert into public.packages (
       id, project_id, accountable_profile_id, title, approval_status,
       approval_revision, proposed_by, proposed_at, decided_by, decided_at
     ) values ($1, $2, $3, 'Approval reopen verification', 'approved', 1, $3, now(), $3, now())`,
    [ids.approvalInitiative, ids.project, ids.ceo],
  );
  await insertDeliverable({ id: ids.approvalDeliverable, packageId: ids.approvalInitiative });
  await client.query("select set_config('founderops.trash_lifecycle_write', 'on', true)");
  await client.query("update public.tasks set trash_revision = 2 where id = $1", [ids.approvalDeliverable]);
  await client.query("select set_config('founderops.trash_lifecycle_write', 'off', true)");
  await client.query(
    `insert into public.planning_github_lifecycle_outbox (
       root_type, root_id, root_trash_revision, task_id, github_repo,
       github_issue_number, action, source_type, source_revision, status,
       completed_at, created_at
     ) values
       ('initiative', $2, 99, $1, 'findmydoc-platform/management', 101,
        'close_not_planned', 'withdrawn', 99, 'completed', now() - interval '2 days', now() - interval '2 days'),
       ('deliverable', $3, 1, $1, 'findmydoc-platform/management', 202,
        'close_not_planned', 'withdrawn', 1, 'completed', now() - interval '1 day', now() - interval '1 day')`,
    [ids.approvalDeliverable, ids.parentInitiative, ids.separateDeliverable],
  );
  await client.query(
    `select public.decide_deliverable_approval_transaction($1, 1, 'approve', $2, null)`,
    [ids.approvalDeliverable, ids.ceo],
  );
  const reopen = await client.query(
    `select root_type, root_id, root_trash_revision, github_issue_number
     from public.planning_github_lifecycle_outbox
     where task_id = $1 and action = 'reopen'`,
    [ids.approvalDeliverable],
  );
  if (
    reopen.rows.length !== 1
    || reopen.rows[0]?.root_type !== "deliverable"
    || reopen.rows[0]?.root_id !== ids.approvalDeliverable
    || reopen.rows[0]?.root_trash_revision !== 2
    || reopen.rows[0]?.github_issue_number !== 202
  ) {
    throw new Error("Approval did not reopen the latest close target under the current deliverable root.");
  }

  console.log("Planning trash lifecycle transaction verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
