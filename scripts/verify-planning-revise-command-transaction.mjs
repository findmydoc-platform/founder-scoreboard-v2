import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const client = new pg.Client({ host: "127.0.0.1", port: 54322, user: "postgres", password: "postgres", database: "postgres", ssl: false });

async function expectCode(code, operation) {
  const savepoint = `revise_${randomUUID().replaceAll("-", "")}`;
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
  throw new Error(`Expected ${code}, but planning revise succeeded.`);
}

async function revision(taskId) {
  const result = await client.query("select updated_at::text as updated_at from public.tasks where id = $1", [taskId]);
  return result.rows[0]?.updated_at;
}

async function reviseStrategic(taskId, expectedUpdatedAt, patch, actorId, legacyAuditAction = null) {
  return client.query(
    "select public.update_browser_planning_item_transaction($1,$2,$3::jsonb,null,null,$4,null,null,$5) as result",
    [taskId, expectedUpdatedAt, JSON.stringify(patch), actorId, legacyAuditAction],
  );
}

async function reviseDelivery(taskId, expectedUpdatedAt, patch, actorId, activity = [], notifications = []) {
  return client.query(
    "select public.update_browser_planning_task_transaction($1,$2,$3::jsonb,false,null,false,null,$4::text[],$5::jsonb,$6) as result",
    [taskId, expectedUpdatedAt, JSON.stringify(patch), activity, JSON.stringify(notifications), actorId],
  );
}

await client.connect();
await client.query("begin");
try {
  const suffix = randomUUID().replaceAll("-", "");
  const ceoId = `planning-revise-ceo-${suffix}`;
  const founderId = `planning-revise-founder-${suffix}`;
  const otherId = `planning-revise-other-${suffix}`;
  const epicId = `planning-revise-epic-${suffix}`;
  const initiativeId = `planning-revise-initiative-${suffix}`;
  const deliverableId = `planning-revise-deliverable-${suffix}`;
  await client.query(
    `insert into public.profiles (id,name,role,platform_role) values
       ($1,'Planning Revise CEO','admin','ceo'),
       ($2,'Planning Revise Founder','member','founder'),
       ($3,'Planning Revise Other','member','founder')`,
    [ceoId, founderId, otherId],
  );
  await client.query("insert into public.projects (id,name) values ('findmydoc-founder-execution','FounderOps') on conflict (id) do nothing");
  await client.query(
    `insert into public.tasks (id,project_id,task_type,title,status,priority,owner,assignee,parent_task_id,approval_status,sort_order)
     values
       ($1,'findmydoc-founder-execution','epic','Revise Epic','Offen',null,$4,$4,null,null,0),
       ($2,'findmydoc-founder-execution','initiative','Revise Initiative','Offen','P2',$4,$4,$1,'approved',0),
       ($3,'findmydoc-founder-execution','deliverable','Revise Deliverable','Offen','P2',$5,$5,$2,'approved',0)`,
    [epicId, initiativeId, deliverableId, ceoId, founderId],
  );

  const privileges = await client.query(
    `select
       has_function_privilege('anon', 'public.update_browser_planning_item_transaction(text,timestamptz,jsonb,jsonb,jsonb,text,text,text,text)', 'execute') strategic_anon,
       has_function_privilege('authenticated', 'public.update_browser_planning_item_transaction(text,timestamptz,jsonb,jsonb,jsonb,text,text,text,text)', 'execute') strategic_authenticated,
       has_function_privilege('service_role', 'public.update_browser_planning_item_transaction(text,timestamptz,jsonb,jsonb,jsonb,text,text,text,text)', 'execute') strategic_service,
       has_function_privilege('anon', 'public.update_browser_planning_task_transaction(text,timestamptz,jsonb,boolean,text,boolean,text,text[],jsonb,text)', 'execute') delivery_anon,
       has_function_privilege('authenticated', 'public.update_browser_planning_task_transaction(text,timestamptz,jsonb,boolean,text,boolean,text,text[],jsonb,text)', 'execute') delivery_authenticated,
       has_function_privilege('service_role', 'public.update_browser_planning_task_transaction(text,timestamptz,jsonb,boolean,text,boolean,text,text[],jsonb,text)', 'execute') delivery_service`,
  );
  assert.deepEqual(privileges.rows[0], {
    strategic_anon: false,
    strategic_authenticated: false,
    strategic_service: true,
    delivery_anon: false,
    delivery_authenticated: false,
    delivery_service: true,
  });

  const epicRevision = await revision(epicId);
  await expectCode("P0006", () => reviseStrategic(epicId, epicRevision, { title: "Forbidden Epic" }, founderId));
  await expectCode("22023", () => reviseStrategic(epicId, epicRevision, { parent_task_id: deliverableId }, ceoId));
  const strategic = await reviseStrategic(epicId, epicRevision, { title: "Updated Epic" }, ceoId);
  assert.equal(strategic.rows[0]?.result?.task?.title, "Updated Epic");
  await expectCode("P0001", () => reviseStrategic(epicId, epicRevision, { title: "Stale Epic" }, ceoId));

  const epicRollbackRevision = await revision(epicId);
  const auditTriggerFunction = `fail_planning_revise_audit_${suffix}`;
  const auditTriggerName = `fail_planning_revise_audit_${suffix}`;
  await client.query(`
    create function public.${auditTriggerFunction}() returns trigger language plpgsql as $$
    begin
      if new.action = 'milestone.update' and new.entity_id = '${epicId}' then
        raise exception using errcode = 'XX000', message = 'injected planning revise audit failure';
      end if;
      return new;
    end;
    $$;
    create trigger ${auditTriggerName}
    before insert on public.audit_log
    for each row execute function public.${auditTriggerFunction}();
  `);
  await expectCode("XX000", () => reviseStrategic(epicId, epicRollbackRevision, { title: "Must Roll Back Epic" }, ceoId, "milestone.update"));
  const epicRollback = await client.query("select title from public.tasks where id = $1", [epicId]);
  assert.equal(epicRollback.rows[0]?.title, "Updated Epic");

  const deliveryRevision = await revision(deliverableId);
  await expectCode("P0006", () => reviseDelivery(deliverableId, deliveryRevision, { title: "Forbidden Deliverable" }, otherId));
  const delivery = await reviseDelivery(deliverableId, deliveryRevision, { title: "Updated Deliverable", evidence_links: ["https://example.com/evidence"] }, founderId, ["Deliverable revised"]);
  assert.equal(delivery.rows[0]?.result?.task?.title, "Updated Deliverable");
  const deliveryEffects = await client.query(
    `select count(*)::integer as evidence_count
     from public.task_links where task_id = $1 and type = 'evidence'`,
    [deliverableId],
  );
  assert.deepEqual(deliveryEffects.rows[0], { evidence_count: 1 });

  await client.query("update public.tasks set review_status = 'requested', score_final = false, updated_at = clock_timestamp() where id = $1", [deliverableId]);
  await expectCode("P0010", async () => reviseDelivery(deliverableId, await revision(deliverableId), { title: "Review Locked" }, founderId));
  await client.query("update public.tasks set review_status = 'not_requested', score_final = false, updated_at = clock_timestamp() where id = $1", [deliverableId]);
  const lockedSprintId = `planning-revise-sprint-${suffix}`;
  await client.query(
    "insert into public.sprints (id,project_id,name,score_locked) values ($1,'findmydoc-founder-execution','Locked Sprint',true)",
    [lockedSprintId],
  );
  await expectCode("P0015", async () => reviseDelivery(deliverableId, await revision(deliverableId), { sprint_id: lockedSprintId }, ceoId));

  const rollbackRevision = await revision(deliverableId);
  const triggerFunction = `fail_planning_revise_${suffix}`;
  const triggerName = `fail_planning_revise_${suffix}`;
  await client.query(`
    create function public.${triggerFunction}() returns trigger language plpgsql as $$
    begin
      if new.entity_id = '${deliverableId}' then
        raise exception using errcode = 'XX000', message = 'injected planning revise notification failure';
      end if;
      return new;
    end;
    $$;
    create trigger ${triggerName}
    before insert on public.notification_events
    for each row execute function public.${triggerFunction}();
  `);
  await expectCode("XX000", () => reviseDelivery(
    deliverableId,
    rollbackRevision,
    { title: "Must Roll Back", evidence_links: ["https://example.com/rollback"] },
    founderId,
    ["Must roll back"],
    [{ type: "task.updated", actor_profile_id: founderId, recipient_profile_id: otherId, entity_type: "task", entity_id: deliverableId, title: "Rollback", body: "Rollback" }],
  ));
  const rollback = await client.query(
    `select
       (select title from public.tasks where id = $1) title,
       (select count(*)::integer from public.task_links where task_id = $1 and type = 'evidence' and url = 'https://example.com/rollback') rollback_evidence_count,
       (select count(*)::integer from public.task_activity where task_id = $1 and message = 'Must roll back') rollback_activity_count,
       (select count(*)::integer from public.notification_events where entity_id = $1 and title = 'Rollback') rollback_notification_count`,
    [deliverableId],
  );
  assert.deepEqual(rollback.rows[0], {
    title: "Updated Deliverable",
    rollback_evidence_count: 0,
    rollback_activity_count: 0,
    rollback_notification_count: 0,
  });

  console.log("Planning revise command transaction verification passed.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
