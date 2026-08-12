import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const client = new pg.Client({ host: "127.0.0.1", port: 54322, user: "postgres", password: "postgres", database: "postgres", ssl: false });

async function expectCode(code, operation) {
  const savepoint = `reparent_${randomUUID().replaceAll("-", "")}`;
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
  throw new Error(`Expected ${code}, but reparent mutation succeeded.`);
}

async function revision(id) {
  const result = await client.query("select updated_at::text as revision from public.tasks where id = $1", [id]);
  return result.rows[0]?.revision;
}

async function mutate(itemId, kind, expectedRevision, parentId, expectedParentRevision, actorId) {
  const result = await client.query(
    "select public.mutate_planning_reparent_command_transaction($1,$2,$3::timestamptz,$4,$5::timestamptz,$6) as result",
    [itemId, kind, expectedRevision, parentId, expectedParentRevision, actorId],
  );
  return result.rows[0]?.result;
}

await client.connect();
await client.query("begin");
try {
  const suffix = randomUUID().replaceAll("-", "");
  const ids = Object.fromEntries([
    "ceo", "founder", "epicOne", "epicTwo", "initiativeOne", "initiativeTwo",
    "deliverableOne", "deliverableTwo", "subIssue",
  ].map((key) => [key, `reparent-${key}-${suffix}`]));
  await client.query(
    "insert into public.profiles (id,name,role,platform_role) values ($1,'Reparent CEO','admin','ceo'),($2,'Reparent Founder','member','founder')",
    [ids.ceo, ids.founder],
  );
  await client.query(
    "insert into public.projects (id,name,range_label) values ('findmydoc-founder-execution','FounderOps','Verifier') on conflict (id) do nothing",
  );
  await client.query(
    `insert into public.tasks (
       id,project_id,parent_task_id,title,task_type,status,priority,owner,assignee,
       approval_status,approval_revision,review_status,score_points,score_final,github_issue_sync_status
     ) values
       ($1,'findmydoc-founder-execution',null,'Epic One','epic','Offen','P2',$8,$8,null,1,'not_requested',0,false,'not_applicable'),
       ($2,'findmydoc-founder-execution',null,'Epic Two','epic','Offen','P2',$8,$8,null,1,'not_requested',0,false,'not_applicable'),
       ($3,'findmydoc-founder-execution',$1,'Initiative One','initiative','Offen','P2',$8,$8,'approved',3,'not_requested',0,false,'not_applicable'),
       ($4,'findmydoc-founder-execution',$2,'Initiative Two','initiative','Offen','P2',$8,$8,'approved',2,'not_requested',0,false,'not_applicable'),
       ($5,'findmydoc-founder-execution',$3,'Deliverable One','deliverable','In Arbeit','P2',$9,$9,'approved',4,'not_requested',0,false,'synced'),
       ($6,'findmydoc-founder-execution',$4,'Deliverable Two','deliverable','In Arbeit','P2',$9,$9,'approved',2,'not_requested',0,false,'synced'),
       ($7,'findmydoc-founder-execution',$5,'Sub-Issue','sub_issue','Offen','P2',$9,$9,null,1,'not_requested',0,false,'synced')`,
    [ids.epicOne, ids.epicTwo, ids.initiativeOne, ids.initiativeTwo, ids.deliverableOne, ids.deliverableTwo, ids.subIssue, ids.ceo, ids.founder],
  );
  await client.query(
    `insert into public.planning_item_raci_assignments (task_id,profile_id,role,sort_order)
     values ($1,$3,'accountable',0),($1,$4,'responsible',0),($2,$3,'accountable',0),($2,$4,'responsible',0)`,
    [ids.initiativeOne, ids.initiativeTwo, ids.ceo, ids.founder],
  );

  const prepared = await client.query(
    "select public.prepare_planning_reparent_command($1,$2,'sub_issue',$3) as result",
    [ids.subIssue, ids.deliverableTwo, ids.founder],
  );
  assert.equal(prepared.rows[0]?.result?.task?.id, ids.subIssue);
  assert.equal(prepared.rows[0]?.result?.parent?.id, ids.deliverableTwo);
  assert.equal(prepared.rows[0]?.result?.oldParent?.id, ids.deliverableOne);

  await expectCode("P0006", async () => mutate(
    ids.deliverableOne, "deliverable", await revision(ids.deliverableOne), ids.initiativeTwo, await revision(ids.initiativeTwo), ids.founder,
  ));
  await expectCode("P0001", async () => mutate(
    ids.deliverableOne, "deliverable", "2026-08-12T00:00:00.000Z", ids.initiativeTwo, await revision(ids.initiativeTwo), ids.ceo,
  ));
  await expectCode("P0012", async () => mutate(
    ids.deliverableOne, "deliverable", await revision(ids.deliverableOne), ids.initiativeTwo, "2026-08-12T00:00:00.000Z", ids.ceo,
  ));
  await expectCode("23514", async () => mutate(
    ids.deliverableOne, "deliverable", await revision(ids.deliverableOne), ids.epicTwo, await revision(ids.epicTwo), ids.ceo,
  ));
  assert.equal((await client.query("select parent_task_id from public.tasks where id = $1", [ids.deliverableOne])).rows[0]?.parent_task_id, ids.initiativeOne);

  const initiativeRevision = await revision(ids.initiativeOne);
  const movedInitiative = await mutate(ids.initiativeOne, "initiative", initiativeRevision, ids.epicTwo, await revision(ids.epicTwo), ids.ceo);
  assert.equal(movedInitiative?.task?.parent_task_id, ids.epicTwo);
  assert.equal(movedInitiative?.task?.approval_status, "proposed");
  assert.equal(Number(movedInitiative?.task?.approval_revision), 4);

  const deliverableRevision = await revision(ids.deliverableOne);
  const movedDeliverable = await mutate(ids.deliverableOne, "deliverable", deliverableRevision, ids.initiativeTwo, await revision(ids.initiativeTwo), ids.ceo);
  assert.equal(movedDeliverable?.task?.parent_task_id, ids.initiativeTwo);
  assert.equal(movedDeliverable?.task?.approval_status, "proposed");
  assert.equal(Number(movedDeliverable?.task?.approval_revision), 5);
  assert.equal(movedDeliverable?.task?.github_issue_sync_status, "not_synced");

  const subIssueRevision = await revision(ids.subIssue);
  const movedSubIssue = await mutate(ids.subIssue, "sub_issue", subIssueRevision, ids.deliverableTwo, await revision(ids.deliverableTwo), ids.founder);
  assert.equal(movedSubIssue?.task?.parent_task_id, ids.deliverableTwo);
  assert.equal(movedSubIssue?.task?.github_issue_sync_status, "not_synced");

  await client.query("update public.tasks set approval_status = 'rejected' where id = $1", [ids.initiativeOne]);
  await expectCode("23514", async () => mutate(
    ids.deliverableOne, "deliverable", await revision(ids.deliverableOne), ids.initiativeOne, await revision(ids.initiativeOne), ids.ceo,
  ));
  await client.query("update public.tasks set approval_status = 'proposed' where id = $1", [ids.deliverableOne]);
  await expectCode("23514", async () => mutate(
    ids.subIssue, "sub_issue", await revision(ids.subIssue), ids.deliverableOne, await revision(ids.deliverableOne), ids.founder,
  ));
  await client.query("update public.tasks set review_status = 'requested', score_final = false where id = $1", [ids.deliverableTwo]);
  await expectCode("P0009", async () => mutate(
    ids.subIssue, "sub_issue", await revision(ids.subIssue), ids.deliverableTwo, await revision(ids.deliverableTwo), ids.founder,
  ));

  const effects = await client.query(
    `select
       (select count(*)::integer from public.task_activity where task_id = any($1::text[]) and message = 'Übergeordnete Planungsebene geändert') activity_count,
       (select count(*)::integer from public.audit_log where entity_id = any($1::text[]) and action in ('task.parent_changed','planning_item.updated')) audit_count`,
    [[ids.initiativeOne, ids.deliverableOne, ids.subIssue]],
  );
  assert.deepEqual(effects.rows[0], { activity_count: 0, audit_count: 3 });

  const privileges = await client.query(
    `select
       has_function_privilege('authenticated','public.prepare_planning_reparent_command(text,text,text,text)','execute') authenticated_prepare,
       has_function_privilege('authenticated','public.mutate_planning_reparent_command_transaction(text,text,timestamptz,text,timestamptz,text)','execute') authenticated_commit,
       has_function_privilege('authenticated','public.mutate_team_planning_reparent_command_transaction(uuid,text,text,text,timestamptz,text,timestamptz,uuid,text,text,text,text)','execute') authenticated_team_commit,
       has_function_privilege('service_role','public.prepare_planning_reparent_command(text,text,text,text)','execute') service_prepare,
       has_function_privilege('service_role','public.mutate_planning_reparent_command_transaction(text,text,timestamptz,text,timestamptz,text)','execute') service_commit,
       has_function_privilege('service_role','public.mutate_team_planning_reparent_command_transaction(uuid,text,text,text,timestamptz,text,timestamptz,uuid,text,text,text,text)','execute') service_team_commit`,
  );
  assert.deepEqual(privileges.rows[0], {
    authenticated_prepare: false,
    authenticated_commit: false,
    authenticated_team_commit: false,
    service_prepare: true,
    service_commit: true,
    service_team_commit: true,
  });
  console.log("Planning reparent hierarchy, authorization, CAS, approval reset, atomic effects, and service-only access verified; all data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
