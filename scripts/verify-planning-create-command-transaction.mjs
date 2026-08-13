import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const client = new pg.Client({ host: "127.0.0.1", port: 54322, user: "postgres", password: "postgres", database: "postgres", ssl: false });

async function expectCode(code, operation) {
  const savepoint = `create_${randomUUID().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await operation();
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    assert.equal(error?.code, code);
    return;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  throw new Error(`Expected ${code}, but planning create succeeded.`);
}

async function createStrategic(item, actorId) {
  const result = await client.query(
    "select public.create_browser_planning_item_transaction($1::jsonb,null,'[]'::jsonb,$2,null,'planning create verifier') as result",
    [JSON.stringify(item), actorId],
  );
  return result.rows[0]?.result;
}

await client.connect();
await client.query("begin");
try {
  const suffix = randomUUID().replaceAll("-", "");
  const ceoId = `planning-create-ceo-${suffix}`;
  const founderId = `planning-create-founder-${suffix}`;
  await client.query(
    `insert into public.profiles (id,name,role,platform_role) values
       ($1,'Planning Create CEO','admin','ceo'),
       ($2,'Planning Create Founder','member','founder')`,
    [ceoId, founderId],
  );
  await client.query(
    "insert into public.projects (id,name) values ('findmydoc-founder-execution','FounderOps') on conflict (id) do nothing",
  );

  const privileges = await client.query(
    `select
       has_function_privilege('anon', 'public.create_browser_planning_item_transaction(jsonb,jsonb,jsonb,text,text,text)', 'execute') anon,
       has_function_privilege('authenticated', 'public.create_browser_planning_item_transaction(jsonb,jsonb,jsonb,text,text,text)', 'execute') authenticated,
       has_function_privilege('service_role', 'public.create_browser_planning_item_transaction(jsonb,jsonb,jsonb,text,text,text)', 'execute') service_role`,
  );
  assert.deepEqual(privileges.rows[0], { anon: false, authenticated: false, service_role: true });

  const baseItem = {
    project_id: "findmydoc-founder-execution",
    task_type: "epic",
    title: "Planning create verifier",
    description: "Atomic browser command",
    status: "Offen",
    priority: "P2",
    owner: ceoId,
    assignee: ceoId,
    sort_order: 0,
  };
  await expectCode("P0006", () => createStrategic({ ...baseItem, id: `forbidden-${suffix}` }, founderId));

  const successId = `planning-create-success-${suffix}`;
  const created = await createStrategic({ ...baseItem, id: successId }, ceoId);
  assert.equal(created?.task?.id, successId);
  const successEffects = await client.query(
    `select
       (select count(*)::integer from public.tasks where id = $1) task_count,
       (select count(*)::integer from public.task_activity where task_id = $1) activity_count,
       (select count(*)::integer from public.audit_log where entity_id = $1 and action = 'planning_item.created') command_audit_count`,
    [successId],
  );
  assert.deepEqual(successEffects.rows[0], { task_count: 1, activity_count: 1, command_audit_count: 1 });

  const failureId = `planning-create-failure-${suffix}`;
  const triggerFunction = `fail_planning_create_${suffix}`;
  const triggerName = `fail_planning_create_${suffix}`;
  await client.query(`
    create function public.${triggerFunction}() returns trigger language plpgsql as $$
    begin
      if new.action = 'planning_item.created' and new.entity_id = '${failureId}' then
        raise exception using errcode = 'XX000', message = 'injected planning create audit failure';
      end if;
      return new;
    end;
    $$;
    create trigger ${triggerName}
    before insert on public.audit_log
    for each row execute function public.${triggerFunction}();
  `);
  await expectCode("XX000", () => createStrategic({ ...baseItem, id: failureId }, ceoId));
  const failedEffects = await client.query(
    `select
       (select count(*)::integer from public.tasks where id = $1) task_count,
       (select count(*)::integer from public.task_activity where task_id = $1) activity_count,
       (select count(*)::integer from public.audit_log where entity_id = $1) audit_count`,
    [failureId],
  );
  assert.deepEqual(failedEffects.rows[0], { task_count: 0, activity_count: 0, audit_count: 0 });

  console.log("Planning create command transaction verification passed.");
} finally {
  await client.query("rollback");
  await client.end();
}
