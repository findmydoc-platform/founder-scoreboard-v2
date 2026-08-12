import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const client = new pg.Client({ host: "127.0.0.1", port: 54322, user: "postgres", password: "postgres", database: "postgres", ssl: false });

async function expectCode(code, operation) {
  const savepoint = `trash_${randomUUID().replaceAll("-", "")}`;
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
  throw new Error(`Expected ${code}, but planning trash mutation succeeded.`);
}

async function mutate(action, rootType, rootId, revision, actorId, reason = null) {
  const result = await client.query(
    "select public.mutate_planning_trash_command_transaction($1,$2,$3,$4,$5,$6,null,null) as result",
    [action, rootType, rootId, revision, actorId, reason],
  );
  return result.rows[0]?.result;
}

await client.connect();
await client.query("begin");
try {
  const suffix = randomUUID().replaceAll("-", "");
  const ids = Object.fromEntries([
    "ceo", "deputy", "founder", "otherFounder", "epic", "initiative", "deliverable", "subIssue", "failureDeliverable", "failureSubIssue",
  ].map((key) => [key, `trash-command-${key}-${suffix}`]));
  await client.query(
    `insert into public.profiles (id,name,role,platform_role) values
       ($1,'Trash CEO','admin','ceo'),
       ($2,'Trash Deputy','member','deputy'),
       ($3,'Trash Founder','member','founder'),
       ($4,'Other Founder','member','founder')`,
    [ids.ceo, ids.deputy, ids.founder, ids.otherFounder],
  );
  await client.query(
    "insert into public.projects (id,name,range_label) values ('findmydoc-founder-execution','FounderOps','Verifier') on conflict (id) do nothing",
  );
  await client.query(
    `insert into public.tasks (
       id,project_id,parent_task_id,title,task_type,status,priority,owner,assignee,
       approval_status,approval_revision,proposed_by,proposed_at,review_status,score_points,score_final,
       github_repo,github_issue_number,github_issue_sync_status
     ) values
       ($1,'findmydoc-founder-execution',null,'Trash Epic','epic','Offen','P2',$7,$7,null,1,null,null,'not_requested',0,false,null,null,'not_applicable'),
       ($2,'findmydoc-founder-execution',$1,'Trash Initiative','initiative','Offen','P2',$7,$7,'proposed',2,$7,now(),'not_requested',0,false,null,null,'not_applicable'),
       ($3,'findmydoc-founder-execution',$2,'Trash Deliverable','deliverable','Offen','P2',$7,$7,'approved',3,$7,now(),'not_requested',0,false,'findmydoc-platform/management',910001,'synced'),
       ($4,'findmydoc-founder-execution',$3,'Trash Sub-Issue','sub_issue','Offen','P2',$7,$7,null,1,null,null,'not_requested',0,false,'findmydoc-platform/management',910002,'synced'),
       ($5,'findmydoc-founder-execution',$2,'Failure Deliverable','deliverable','Offen','P2',$7,$7,'approved',1,$7,now(),'not_requested',0,false,'findmydoc-platform/management',910003,'synced'),
       ($6,'findmydoc-founder-execution',$5,'Failure Sub-Issue','sub_issue','Offen','P2',$7,$7,null,1,null,null,'not_requested',0,false,'findmydoc-platform/management',910004,'synced')`,
    [ids.epic, ids.initiative, ids.deliverable, ids.subIssue, ids.failureDeliverable, ids.failureSubIssue, ids.founder],
  );

  const prepared = await client.query(
    "select public.prepare_planning_trash_command($1,'initiative',$2) as result",
    [ids.initiative, ids.founder],
  );
  assert.equal(prepared.rows[0]?.result?.task?.id, ids.initiative);
  assert.equal(prepared.rows[0]?.result?.parent?.id, ids.epic);
  assert.equal(prepared.rows[0]?.result?.actorRole, "founder");
  assert.deepEqual(prepared.rows[0]?.result?.affectedTaskIds, [ids.deliverable, ids.failureDeliverable, ids.failureSubIssue, ids.initiative, ids.subIssue].sort());

  await expectCode("22023", () => mutate("withdraw", "deliverable", ids.subIssue, 1, ids.ceo, "Unsupported root"));
  await expectCode("22023", () => mutate("withdraw", "initiative", ids.epic, 1, ids.ceo, "Unsupported root"));
  await expectCode("P0006", () => mutate("withdraw", "initiative", ids.initiative, 2, ids.otherFounder, "Forbidden"));
  await client.query("update public.tasks set review_status = 'requested' where id = $1", [ids.deliverable]);
  await expectCode("P0009", () => mutate("withdraw", "deliverable", ids.deliverable, 3, ids.ceo, "Review locked"));
  await client.query("update public.tasks set review_status = 'not_requested' where id = $1", [ids.deliverable]);

  const withdrawn = await mutate("withdraw", "initiative", ids.initiative, 2, ids.founder, "Tree no longer planned");
  assert.equal(withdrawn.rootType, "initiative");
  assert.deepEqual(withdrawn.affectedTaskIds, [ids.deliverable, ids.failureDeliverable, ids.failureSubIssue, ids.initiative, ids.subIssue].sort());
  const trashed = await client.query(
    `select id,trash_root_type,trash_root_id,trash_revision,trashed_at is not null as trashed
     from public.tasks where id = any($1::text[]) order by id`,
    [withdrawn.affectedTaskIds],
  );
  assert.equal(trashed.rows.every((row) => row.trashed && row.trash_root_type === "initiative" && row.trash_root_id === ids.initiative && row.trash_revision === 1), true);
  const closeJobs = await client.query(
    `select task_id,action,source_revision,status from public.planning_github_lifecycle_outbox
     where root_type = 'initiative' and root_id = $1 order by task_id`,
    [ids.initiative],
  );
  assert.deepEqual(closeJobs.rows.map((row) => [row.task_id, row.action, row.source_revision]), [
    [ids.deliverable, "close_not_planned", 1],
    [ids.failureDeliverable, "close_not_planned", 1],
    [ids.failureSubIssue, "close_not_planned", 1],
    [ids.subIssue, "close_not_planned", 1],
  ].sort(([left], [right]) => left.localeCompare(right)));

  const restored = await mutate("restore", "initiative", ids.initiative, 1, ids.deputy);
  assert.deepEqual([...restored.affectedTaskIds].sort(), [...withdrawn.affectedTaskIds].sort());
  const active = await client.query(
    "select id,trashed_at,trash_root_id from public.tasks where id = any($1::text[]) order by id",
    [restored.affectedTaskIds],
  );
  assert.equal(active.rows.every((row) => row.trashed_at === null && row.trash_root_id === null), true);
  const orderedJobs = await client.query(
    `select task_id,action,source_revision from public.planning_github_lifecycle_outbox
     where root_type = 'initiative' and root_id = $1 order by task_id,action`,
    [ids.initiative],
  );
  assert.equal(orderedJobs.rowCount, 8);
  for (const taskId of [ids.deliverable, ids.failureDeliverable, ids.failureSubIssue, ids.subIssue]) {
    assert.deepEqual(orderedJobs.rows.filter((row) => row.task_id === taskId).map((row) => row.action).sort(), ["close_not_planned", "reopen"]);
  }
  const firstClaims = await client.query(
    `select task_id,action
     from public.claim_planning_github_lifecycle_jobs_for_root(
       gen_random_uuid(), 'initiative', $1, $2::text[], 20, 120
     )`,
    [ids.initiative, [ids.deliverable, ids.failureDeliverable, ids.failureSubIssue, ids.subIssue]],
  );
  assert.equal(firstClaims.rows.length, 4);
  assert.equal(firstClaims.rows.every((row) => row.action === "close_not_planned"), true);

  const deliverableWithdrawn = await mutate("withdraw", "deliverable", ids.deliverable, 4, ids.ceo, "Deliverable tree no longer planned");
  assert.deepEqual(deliverableWithdrawn.affectedTaskIds, [ids.deliverable, ids.subIssue].sort());
  const deliverableRestored = await mutate("restore", "deliverable", ids.deliverable, 2, ids.deputy);
  assert.deepEqual([...deliverableRestored.affectedTaskIds].sort(), [...deliverableWithdrawn.affectedTaskIds].sort());

  const failFunction = `fail_planning_trash_${suffix}`;
  const failTrigger = `fail_planning_trash_${suffix}`;
  await client.query(`
    create function public.${failFunction}() returns trigger language plpgsql as $$
    begin
      if new.entity_id = '${ids.failureDeliverable}' then
        raise exception using errcode = 'XX000', message = 'injected planning trash audit failure';
      end if;
      return new;
    end;
    $$;
    create trigger ${failTrigger}
    before insert on public.audit_log
    for each row execute function public.${failFunction}();
  `);
  const beforeFailure = await client.query(
    `select
       (select count(*)::integer from public.task_activity where task_id = $1) activity_count,
       (select count(*)::integer from public.audit_log where entity_id = $1) audit_count,
       (select count(*)::integer from public.planning_github_lifecycle_outbox where root_id = $1) outbox_count`,
    [ids.failureDeliverable],
  );
  await expectCode("XX000", () => mutate("withdraw", "deliverable", ids.failureDeliverable, 2, ids.ceo, "Injected rollback"));
  const afterFailure = await client.query(
    `select
       (select trashed_at is null from public.tasks where id = $1) root_active,
       (select trashed_at is null from public.tasks where id = $2) child_active,
       (select count(*)::integer from public.task_activity where task_id = $1) activity_count,
       (select count(*)::integer from public.audit_log where entity_id = $1) audit_count,
       (select count(*)::integer from public.planning_github_lifecycle_outbox where root_id = $1) outbox_count`,
    [ids.failureDeliverable, ids.failureSubIssue],
  );
  assert.equal(afterFailure.rows[0]?.root_active, true);
  assert.equal(afterFailure.rows[0]?.child_active, true);
  assert.equal(afterFailure.rows[0]?.activity_count, beforeFailure.rows[0]?.activity_count);
  assert.equal(afterFailure.rows[0]?.audit_count, beforeFailure.rows[0]?.audit_count);
  assert.equal(afterFailure.rows[0]?.outbox_count, beforeFailure.rows[0]?.outbox_count);

  const privileges = await client.query(
    `select
       has_function_privilege('authenticated','public.prepare_planning_trash_command(text,text,text)','execute') authenticated_prepare,
       has_function_privilege('authenticated','public.mutate_planning_trash_command_transaction(text,text,text,integer,text,text,text,text)','execute') authenticated_commit,
       has_function_privilege('service_role','public.prepare_planning_trash_command(text,text,text)','execute') service_prepare,
       has_function_privilege('service_role','public.mutate_planning_trash_command_transaction(text,text,text,integer,text,text,text,text)','execute') service_commit`,
  );
  assert.deepEqual(privileges.rows[0], {
    authenticated_prepare: false,
    authenticated_commit: false,
    service_prepare: true,
    service_commit: true,
  });
  console.log("Planning trash tree scope, authorization, durable lifecycle ordering, injected rollback, and service-only access verified; all data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
