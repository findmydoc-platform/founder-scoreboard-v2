import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const client = new pg.Client({ host: "127.0.0.1", port: 54322, user: "postgres", password: "postgres", database: "postgres", ssl: false });

async function expectCode(code, operation) {
  const savepoint = `approval_${randomUUID().replaceAll("-", "")}`;
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
  throw new Error(`Expected ${code}, but approval mutation succeeded.`);
}

async function mutate(taskId, kind, revision, action, actorId, note = null) {
  return client.query(
    "select public.mutate_planning_approval_command_transaction($1,$2,$3,$4,$5,$6) as result",
    [taskId, kind, revision, action, actorId, note],
  );
}

await client.connect();
await client.query("begin");
try {
  const suffix = randomUUID().replaceAll("-", "");
  const ids = {
    ceo: `approval-ceo-${suffix}`,
    founder: `approval-founder-${suffix}`,
    responsible: `approval-responsible-${suffix}`,
    epic: `approval-epic-${suffix}`,
    initiative: `approval-initiative-${suffix}`,
    deliverable: `approval-deliverable-${suffix}`,
    locked: `approval-locked-${suffix}`,
  };
  await client.query(
    "insert into public.profiles (id,name,role,platform_role) values ($1,'Approval CEO','admin','ceo'),($2,'Approval Founder','member','founder'),($3,'Approval Responsible','member','founder')",
    [ids.ceo, ids.founder, ids.responsible],
  );
  await client.query(
    `insert into public.tasks (id,project_id,parent_task_id,title,task_type,status,priority,owner,assignee,approval_status,approval_revision,review_status,score_final)
     values
       ($1,'findmydoc-founder-execution',null,'Approval Epic','epic','Offen','P2',$5,$5,null,1,'not_requested',false),
       ($2,'findmydoc-founder-execution',$1,'Approval Initiative','initiative','Offen','P2',$5,$5,'proposed',1,'not_requested',false),
       ($3,'findmydoc-founder-execution',$2,'Approval Deliverable','deliverable','Offen','P2',$5,$5,'proposed',1,'not_requested',false),
       ($4,'findmydoc-founder-execution',$2,'Locked Deliverable','deliverable','Review','P2',$5,$5,'proposed',1,'requested',false)
     returning id,approval_revision`,
    [ids.epic, ids.initiative, ids.deliverable, ids.locked, ids.founder],
  );
  await client.query(
    "insert into public.planning_item_raci_assignments (task_id,profile_id,role,sort_order) values ($1,$2,'accountable',0),($1,$3,'responsible',1)",
    [ids.initiative, ids.ceo, ids.responsible],
  );
  const prepared = await client.query("select public.prepare_planning_approval_command($1,'initiative',$2) as result", [ids.initiative, ids.ceo]);
  assert.equal(prepared.rows[0]?.result?.task?.id, ids.initiative);
  assert.equal(prepared.rows[0]?.result?.accountableCount, 1);
  assert.equal(prepared.rows[0]?.result?.responsibleCount, 1);

  await expectCode("P0006", () => mutate(ids.initiative, "initiative", 1, "approve", ids.founder));
  await expectCode("P0001", () => mutate(ids.initiative, "initiative", 2, "approve", ids.ceo));
  await expectCode("P0009", () => mutate(ids.locked, "deliverable", 1, "approve", ids.ceo));

  const approvedInitiative = await mutate(ids.initiative, "initiative", 1, "approve", ids.ceo);
  assert.equal(approvedInitiative.rows[0]?.result?.task?.approval_status, "approved");
  const approvedDeliverable = await mutate(ids.deliverable, "deliverable", 1, "approve", ids.ceo);
  assert.equal(approvedDeliverable.rows[0]?.result?.task?.approval_status, "approved");
  const effects = await client.query(
    "select (select count(*)::integer from public.task_activity where task_id in ($1,$2)) activity_count, (select count(*)::integer from public.audit_log where entity_id in ($1,$2) and action = 'planning_item.approval_approve') audit_count",
    [ids.initiative, ids.deliverable],
  );
  assert.deepEqual(effects.rows[0], { activity_count: 2, audit_count: 2 });

  const privileges = await client.query(
    `select
      has_function_privilege('authenticated','public.prepare_planning_approval_command(text,text,text)','execute') authenticated_prepare,
      has_function_privilege('authenticated','public.mutate_planning_approval_command_transaction(text,text,integer,text,text,text)','execute') authenticated_commit,
      has_function_privilege('service_role','public.prepare_planning_approval_command(text,text,text)','execute') service_prepare,
      has_function_privilege('service_role','public.mutate_planning_approval_command_transaction(text,text,integer,text,text,text)','execute') service_commit`,
  );
  assert.deepEqual(privileges.rows[0], { authenticated_prepare: false, authenticated_commit: false, service_prepare: true, service_commit: true });
  console.log("Canonical Planning approval policy, atomic effects, and service-only access verified; all data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
