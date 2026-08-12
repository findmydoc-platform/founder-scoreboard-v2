import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const client = new pg.Client({
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: "postgres",
  database: "postgres",
  ssl: false,
});

async function expectCode(code, operation) {
  const savepoint = `backlog_move_${randomUUID().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await operation();
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    assert.equal(error?.code, code, `Expected ${code}, received ${error?.code || "no SQLSTATE"}.`);
    return;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  throw new Error(`Expected ${code}, but the backlog move succeeded.`);
}

await client.connect();
await client.query("begin");

try {
  const profiles = await client.query(
    `select id, platform_role
     from public.profiles
     where platform_role in ('ceo', 'founder')
     order by id`,
  );
  const ceoId = profiles.rows.find((profile) => profile.platform_role === "ceo")?.id;
  const founderId = profiles.rows.find((profile) => profile.platform_role === "founder")?.id;
  assert.ok(ceoId, "Local backlog move verification requires a CEO profile.");
  assert.ok(founderId, "Local backlog move verification requires a Founder profile.");

  const suffix = randomUUID().replaceAll("-", "");
  const sourceId = `backlog-move-source-${suffix}`;
  const targetId = `backlog-move-target-${suffix}`;
  const inserted = await client.query(
    `insert into public.tasks (id, project_id, title, task_type, status, priority, sort_order)
     values
       ($1, 'findmydoc-founder-execution', 'Rollback compatible source', 'deliverable', 'Offen', 'P2', 990001),
       ($2, 'findmydoc-founder-execution', 'Rollback compatible target', 'deliverable', 'Offen', 'P2', 990002)
     returning id, updated_at::text as updated_at`,
    [sourceId, targetId],
  );
  const revisionById = new Map(inserted.rows.map((row) => [row.id, row.updated_at]));

  await expectCode("P0004", () => client.query(
    `select public.move_backlog_task_transaction($1, $2, 'after', $3::timestamptz, $4::timestamptz, $5, null, 'local rollback verifier')`,
    [sourceId, targetId, revisionById.get(sourceId), revisionById.get(targetId), founderId],
  ));
  const deniedState = await client.query(
    `select
       (select array_agg(sort_order order by id) from public.tasks where id = any($1::text[])) as orders,
       (select count(*)::integer from public.audit_log where user_agent = 'local rollback verifier') as audit_count`,
    [[sourceId, targetId]],
  );
  assert.deepEqual(deniedState.rows[0]?.orders, [990001, 990002]);
  assert.equal(deniedState.rows[0]?.audit_count, 0);

  const moved = await client.query(
    `select public.move_backlog_task_transaction($1, $2, 'after', $3::timestamptz, $4::timestamptz, $5, null, 'local rollback verifier') as result`,
    [sourceId, targetId, revisionById.get(sourceId), revisionById.get(targetId), ceoId],
  );
  assert.ok(moved.rows[0]?.result?.some((update) => update.id === sourceId));

  const order = await client.query(
    `select id, sort_order from public.tasks where id = any($1::text[]) order by sort_order, id`,
    [[sourceId, targetId]],
  );
  assert.deepEqual(order.rows.map((row) => row.id), [targetId, sourceId]);
  const audit = await client.query(
    `select count(*)::integer as count
     from public.audit_log
     where action = 'task.backlog_reorder' and user_agent = 'local rollback verifier'`,
  );
  assert.equal(audit.rows[0]?.count, 1);

  const privileges = await client.query(
    `select
       has_function_privilege('authenticated', 'public.move_backlog_task_transaction(text,text,text,timestamptz,timestamptz,text,text,text)', 'execute') as authenticated,
       has_function_privilege('service_role', 'public.move_backlog_task_transaction(text,text,text,timestamptz,timestamptz,text,text,text)', 'execute') as service_role`,
  );
  assert.equal(privileges.rows[0]?.authenticated, false);
  assert.equal(privileges.rows[0]?.service_role, true);

  console.log("Backlog move transaction, authorization parity, and previous direct-RPC caller compatibility verified; all data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
