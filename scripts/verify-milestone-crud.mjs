import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const FOUNDER_OPS_PROJECT_ID = "findmydoc-founder-execution";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
let savepointCounter = 0;

export function localMilestoneDatabaseConfig(env = process.env) {
  return {
    host: env.MILESTONE_VERIFY_DB_HOST || "127.0.0.1",
    port: Number(env.MILESTONE_VERIFY_DB_PORT || 54322),
    user: env.MILESTONE_VERIFY_DB_USER || "postgres",
    password: env.MILESTONE_VERIFY_DB_PASSWORD || "postgres",
    database: env.MILESTONE_VERIFY_DB_NAME || "postgres",
    ssl: false,
  };
}

export function assertLocalDatabaseTarget(config) {
  if (!LOCAL_HOSTS.has(config.host) || config.port !== 54322 || config.ssl !== false) {
    throw new Error(
      `Milestone CRUD verification is local-only; expected 127.0.0.1:54322 without TLS, received ${config.host}:${config.port}.`,
    );
  }
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function expectSqlState(client, expectedCode, operation) {
  const savepoint = `milestone_expected_${savepointCounter += 1}`;
  await client.query(`savepoint ${savepoint}`);

  try {
    await operation();
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    assert.equal(error?.code, expectedCode, `Expected SQLSTATE ${expectedCode}, received ${error?.code || "none"}.`);
    return error;
  }

  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  throw new Error(`Expected SQLSTATE ${expectedCode}, but the statement succeeded.`);
}

async function ensureFounderOpsProject(client) {
  const result = await client.query(
    `insert into public.projects (id, name, range_label)
     values ($1, 'Milestone CRUD verifier', 'Local verification only')
     on conflict (id) do nothing
     returning id`,
    [FOUNDER_OPS_PROJECT_ID],
  );
  return result.rowCount === 1;
}

async function verifyTransactionalRpcContract(config) {
  const client = new pg.Client(config);
  await client.connect();
  await client.query("begin");

  try {
    await ensureFounderOpsProject(client);

    const suffix = randomUUID().replaceAll("-", "");
    const ceoId = `milestone-verifier-ceo-${suffix}`;
    const founderId = `milestone-verifier-founder-${suffix}`;
    await client.query(
      `insert into public.profiles (id, name, role, platform_role)
       values
         ($1, 'Milestone verifier CEO', 'admin', 'ceo'),
         ($2, 'Milestone verifier Founder', 'member', 'founder')`,
      [ceoId, founderId],
    );

    const tokenHash = hash(`milestone-token-${suffix}`);
    const tokenResult = await client.query(
      `select public.create_team_planning_items_token_v2(
         $1, $2, $3, $4, true, true
       ) as result`,
      [ceoId, "Milestone CRUD verifier", tokenHash, "verify-ms"],
    );
    const token = tokenResult.rows[0]?.result;
    assert.ok(token?.id, "Token v2 must return a token identifier.");
    assert.equal(token.token_hash, undefined, "Token v2 must not expose the stored token hash.");
    assert.ok(token.scopes?.includes("write:planning-items:update"));
    assert.ok(token.scopes?.includes("write:planning-items:delete-empty"));

    await expectSqlState(client, "P0006", () => client.query(
      `select public.create_team_planning_items_token_v2(
         $1, $2, $3, $4, false, true
       )`,
      [founderId, "Forbidden delete token", hash(`founder-token-${suffix}`), "deny-ms"],
    ));

    const createItems = [{
      itemType: "milestone",
      title: "Transactional Milestone",
      description: "Created by the local rollback verifier.",
      targetDate: "2026-12-31",
      status: "planned",
    }];
    const createKey = randomUUID();
    const createResult = await client.query(
      `select public.create_team_planning_items_transaction(
         $1, $2, $3, $4, $5::jsonb, null, 'milestone CRUD verifier'
       ) as result`,
      [token.id, ceoId, createKey, hash(createItems), JSON.stringify(createItems)],
    );
    const created = createResult.rows[0]?.result;
    const milestone = created?.items?.[0]?.item;
    assert.equal(created?.replayed, false);
    assert.equal(created?.items?.[0]?.itemType, "milestone");
    assert.equal(milestone?.project_id, FOUNDER_OPS_PROJECT_ID);
    assert.equal(milestone?.status, "planned");
    assert.ok(Number.isInteger(milestone?.sort_order));
    assert.ok(milestone?.updated_at);

    const patch = { status: "active" };
    const updateKey = randomUUID();
    const updateHash = hash({
      itemType: "milestone",
      itemId: milestone.id,
      expectedUpdatedAt: milestone.updated_at,
      patch,
    });
    const updateResult = await client.query(
      `select public.update_team_planning_item_transaction(
         $1, $2, 'milestone', $3, $4::timestamptz, $5, $6,
         $7::jsonb, '["status"]'::jsonb, '[]'::jsonb,
         null, 'milestone CRUD verifier'
       ) as result`,
      [token.id, ceoId, milestone.id, milestone.updated_at, updateKey, updateHash, JSON.stringify(patch)],
    );
    const updated = updateResult.rows[0]?.result;
    assert.equal(updated?.replayed, false);
    assert.equal(updated?.item?.status, "active");
    assert.notEqual(updated?.item?.updated_at, milestone.updated_at);

    const noOpKey = randomUUID();
    const noOpHash = hash({
      itemType: "milestone",
      itemId: milestone.id,
      expectedUpdatedAt: updated.item.updated_at,
      patch: {},
    });
    const noOpArgs = [token.id, ceoId, milestone.id, updated.item.updated_at, noOpKey, noOpHash];
    const noOpResult = await client.query(
      `select public.update_team_planning_item_transaction(
         $1, $2, 'milestone', $3, $4::timestamptz, $5, $6,
         '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
         null, 'milestone CRUD verifier'
       ) as result`,
      noOpArgs,
    );
    assert.equal(noOpResult.rows[0]?.result?.replayed, false);
    assert.equal(noOpResult.rows[0]?.result?.item?.updated_at, updated.item.updated_at);
    const noOpReplay = await client.query(
      `select public.update_team_planning_item_transaction(
         $1, $2, 'milestone', $3, $4::timestamptz, $5, $6,
         '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
         null, 'milestone CRUD verifier'
       ) as result`,
      noOpArgs,
    );
    assert.equal(noOpReplay.rows[0]?.result?.replayed, true);
    assert.equal(noOpReplay.rows[0]?.result?.item?.updated_at, updated.item.updated_at);

    const initiativeId = `milestone-verifier-initiative-${suffix}`;
    await client.query(
      `insert into public.packages (id, project_id, title, milestone_id)
       values ($1, $2, 'Milestone verifier Initiative', $3)`,
      [initiativeId, FOUNDER_OPS_PROJECT_ID, milestone.id],
    );

    const blockedDeleteKey = randomUUID();
    const blockedDeleteHash = hash({ milestoneId: milestone.id, expectedUpdatedAt: updated.item.updated_at });
    await expectSqlState(client, "P0008", () => client.query(
      `select public.delete_team_planning_milestone_transaction(
         $1, $2, $3, $4::timestamptz, $5, $6, null, 'milestone CRUD verifier'
       )`,
      [token.id, ceoId, milestone.id, updated.item.updated_at, blockedDeleteKey, blockedDeleteHash],
    ));

    const blockedState = await client.query(
      `select
         (select count(*)::integer from public.milestones where id = $1) as milestones,
         (select count(*)::integer from public.packages where id = $2) as initiatives,
         (select count(*)::integer from public.team_planning_milestone_delete_requests where token_id = $3) as delete_requests,
         (select count(*)::integer from public.audit_log where entity_id = $1 and action = 'team.planning_items.milestone_delete') as delete_audits`,
      [milestone.id, initiativeId, token.id],
    );
    assert.deepEqual(blockedState.rows[0], {
      milestones: 1,
      initiatives: 1,
      delete_requests: 0,
      delete_audits: 0,
    });

    await client.query("select set_config('founderops.trash_lifecycle_write', 'on', true)");
    await client.query("delete from public.packages where id = $1", [initiativeId]);

    const deleteKey = randomUUID();
    const deleteHash = hash({ milestoneId: milestone.id, expectedUpdatedAt: updated.item.updated_at });
    const deleteArgs = [token.id, ceoId, milestone.id, updated.item.updated_at, deleteKey, deleteHash];
    const deletedResult = await client.query(
      `select public.delete_team_planning_milestone_transaction(
         $1, $2, $3, $4::timestamptz, $5, $6, null, 'milestone CRUD verifier'
       ) as result`,
      deleteArgs,
    );
    const deleted = deletedResult.rows[0]?.result;
    assert.equal(deleted?.replayed, false);
    assert.equal(deleted?.itemType, "milestone");
    assert.equal(deleted?.item?.id, milestone.id);
    assert.deepEqual(deleted?.children, { initiatives: 0, tasks: 0 });

    const replayedResult = await client.query(
      `select public.delete_team_planning_milestone_transaction(
         $1, $2, $3, $4::timestamptz, $5, $6, null, 'milestone CRUD verifier'
       ) as result`,
      deleteArgs,
    );
    assert.equal(replayedResult.rows[0]?.result?.replayed, true);
    assert.equal(replayedResult.rows[0]?.result?.item?.id, milestone.id);

    await expectSqlState(client, "P0003", () => client.query(
      `select public.delete_team_planning_milestone_transaction(
         $1, $2, $3, $4::timestamptz, $5, $6, null, 'milestone CRUD verifier'
       )`,
      [token.id, ceoId, milestone.id, updated.item.updated_at, deleteKey, hash("changed request")],
    ));

    const taskMilestoneId = `milestone-verifier-task-parent-${suffix}`;
    const taskId = `milestone-verifier-task-${suffix}`;
    const taskMilestoneResult = await client.query(
      `insert into public.milestones (id, project_id, title, description, status)
       values ($1, $2, 'Task child Milestone', '', 'planned')
       returning updated_at::text as updated_at`,
      [taskMilestoneId, FOUNDER_OPS_PROJECT_ID],
    );
    const taskMilestoneUpdatedAt = taskMilestoneResult.rows[0].updated_at;

    const oldTokenResult = await client.query(
      "select public.create_team_planning_items_token($1, $2, $3, $4, true) as result",
      [ceoId, "Milestone no-delete verifier", hash(`old-token-${suffix}`), "old-ms"],
    );
    const oldToken = oldTokenResult.rows[0]?.result;
    await expectSqlState(client, "P0005", () => client.query(
      `select public.delete_team_planning_milestone_transaction(
         $1, $2, $3, $4::timestamptz, $5, $6
       )`,
      [oldToken.id, ceoId, taskMilestoneId, taskMilestoneUpdatedAt, randomUUID(), hash("missing scope")],
    ));

    await expectSqlState(client, "P0001", () => client.query(
      `select public.delete_team_planning_milestone_transaction(
         $1, $2, $3, $4::timestamptz, $5, $6
       )`,
      [token.id, ceoId, taskMilestoneId, "2000-01-01T00:00:00.000Z", randomUUID(), hash("stale version")],
    ));

    await client.query(
      `insert into public.tasks (
         id, project_id, title, status, priority, github_repo,
         task_type, approval_status, score_relevant, milestone_id
       ) values (
         $1, $2, 'Milestone verifier Task', 'Offen', 'P2',
         'findmydoc-platform/management', 'deliverable', 'proposed', false, $3
       )`,
      [taskId, FOUNDER_OPS_PROJECT_ID, taskMilestoneId],
    );
    await expectSqlState(client, "P0008", () => client.query(
      `select public.delete_team_planning_milestone_transaction(
         $1, $2, $3, $4::timestamptz, $5, $6
       )`,
      [token.id, ceoId, taskMilestoneId, taskMilestoneUpdatedAt, randomUUID(), hash("task child")],
    ));

    await expectSqlState(client, "23503", () => client.query(
      "delete from public.milestones where id = $1",
      [taskMilestoneId],
    ));
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

async function verifyParallelSortAllocation(config) {
  const clients = [new pg.Client(config), new pg.Client(config)];
  await Promise.all(clients.map((client) => client.connect()));

  const suffix = randomUUID().replaceAll("-", "");
  const milestoneIds = [
    `milestone-sort-a-${suffix}`,
    `milestone-sort-b-${suffix}`,
  ];
  let insertedProject = false;

  try {
    insertedProject = await ensureFounderOpsProject(clients[0]);
    const results = await Promise.all(milestoneIds.map((id, index) => clients[index].query(
      `insert into public.milestones (id, project_id, title, description, status, sort_order)
       values ($1, $2, $3, '', 'planned', 0)
       returning sort_order`,
      [id, FOUNDER_OPS_PROJECT_ID, `Parallel sort ${index + 1}`],
    )));
    const sortOrders = results.map((result) => result.rows[0]?.sort_order);
    assert.equal(new Set(sortOrders).size, 2, "Parallel Milestone inserts must receive distinct sort orders.");
  } finally {
    try {
      await clients[0].query("delete from public.milestones where id = any($1::text[])", [milestoneIds]);
      if (insertedProject) {
        await clients[0].query("delete from public.projects where id = $1", [FOUNDER_OPS_PROJECT_ID]);
      }
    } finally {
      await Promise.all(clients.map((client) => client.end().catch(() => {})));
    }
  }
}

async function verifyChildInsertDeleteRace(config) {
  const clients = [new pg.Client(config), new pg.Client(config)];
  await Promise.all(clients.map((client) => client.connect()));

  const suffix = randomUUID().replaceAll("-", "");
  const milestoneId = `milestone-race-${suffix}`;
  const initiativeId = `milestone-race-initiative-${suffix}`;
  let insertedProject = false;

  try {
    insertedProject = await ensureFounderOpsProject(clients[0]);
    await clients[0].query(
      `insert into public.milestones (id, project_id, title, description, status)
       values ($1, $2, 'Milestone delete race', '', 'planned')`,
      [milestoneId, FOUNDER_OPS_PROJECT_ID],
    );

    const outcomes = await Promise.allSettled([
      clients[0].query("delete from public.milestones where id = $1", [milestoneId]),
      clients[1].query(
        `insert into public.packages (id, project_id, title, milestone_id)
         values ($1, $2, 'Milestone race Initiative', $3)`,
        [initiativeId, FOUNDER_OPS_PROJECT_ID, milestoneId],
      ),
    ]);

    const finalState = await clients[0].query(
      `select
         (select count(*)::integer from public.milestones where id = $1) as milestones,
         (select count(*)::integer from public.packages where id = $2) as initiatives`,
      [milestoneId, initiativeId],
    );
    const state = finalState.rows[0];
    const retainedWithChild = state.milestones === 1 && state.initiatives === 1;
    const deletedWithoutChild = state.milestones === 0 && state.initiatives === 0;
    assert.ok(retainedWithChild || deletedWithoutChild, `Invalid race outcome: ${JSON.stringify(state)}`);

    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    assert.equal(rejected.length, 1, "Exactly one side of the child-insert/delete race must be rejected.");
    assert.equal(rejected[0].reason?.code, "23503");
  } finally {
    try {
      await clients[0].query("select set_config('founderops.trash_lifecycle_write', 'on', false)");
      await clients[0].query("delete from public.packages where id = $1", [initiativeId]);
      await clients[0].query("delete from public.milestones where id = $1", [milestoneId]);
      if (insertedProject) {
        await clients[0].query("delete from public.projects where id = $1", [FOUNDER_OPS_PROJECT_ID]);
      }
    } finally {
      await Promise.all(clients.map((client) => client.end().catch(() => {})));
    }
  }
}

export async function runMilestoneCrudVerification(env = process.env) {
  const config = localMilestoneDatabaseConfig(env);
  assertLocalDatabaseTarget(config);

  await verifyTransactionalRpcContract(config);
  await verifyParallelSortAllocation(config);
  await verifyChildInsertDeleteRace(config);

  return {
    status: "milestone-crud-verified",
    target: `${config.host}:${config.port}`,
    transactionalRollback: true,
    parallelSort: true,
    childDeleteRace: true,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  runMilestoneCrudVerification()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(`Milestone CRUD verification failed: ${error.message}`);
      process.exitCode = 1;
    });
}
