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
  const savepoint = `planning_relationship_${randomUUID().replaceAll("-", "")}`;
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
  throw new Error(`Expected ${code}, but the planning relationship mutation succeeded.`);
}

async function mutate({
  operation,
  taskId,
  relatedTaskId = null,
  relationType = null,
  relationId = null,
  note = "",
  expectedUpdatedAt = null,
  actorId,
}) {
  const result = await client.query(
    `select public.mutate_planning_relationship_transaction(
       $1, $2, $3, $4, $5::bigint, $6, $7::timestamptz, $8, 'local-verifier', 'Planning relationship verifier'
     ) as result`,
    [operation, taskId, relatedTaskId, relationType, relationId, note, expectedUpdatedAt, actorId],
  );
  return result.rows[0]?.result;
}

await client.connect();
await client.query("begin");

try {
  const suffix = randomUUID().replaceAll("-", "");
  const ceoId = `relationship-ceo-${suffix}`;
  const founderId = `relationship-founder-${suffix}`;
  const otherFounderId = `relationship-other-${suffix}`;
  const viewerId = `relationship-viewer-${suffix}`;
  await client.query(
    `insert into public.profiles (id, name, role, platform_role)
     values
       ($1, 'Relationship CEO', 'admin', 'ceo'),
       ($2, 'Relationship Founder', 'member', 'founder'),
       ($3, 'Relationship Other', 'member', 'founder'),
       ($4, 'Relationship Viewer', 'viewer', 'viewer')`,
    [ceoId, founderId, otherFounderId, viewerId],
  );

  const initiativeId = `relationship-initiative-${suffix}`;
  const sourceId = `relationship-source-${suffix}`;
  const targetId = `relationship-target-${suffix}`;
  const thirdId = `relationship-third-${suffix}`;
  const inserted = await client.query(
    `insert into public.tasks (
       id, project_id, parent_task_id, title, task_type, status, priority,
       owner, assignee, approval_status, review_status, score_final,
       github_issue_sync_status
     ) values
       ($1, 'findmydoc-founder-execution', null, 'Relationship Initiative', 'initiative', 'Offen', 'P2', $5, $5, 'approved', 'not_requested', false, 'not_applicable'),
       ($2, 'findmydoc-founder-execution', $1, 'Relationship Source', 'deliverable', 'Offen', 'P2', $5, $5, 'approved', 'not_requested', false, 'synced'),
       ($3, 'findmydoc-founder-execution', $1, 'Relationship Target', 'deliverable', 'Offen', 'P2', $6, $6, 'approved', 'not_requested', false, 'synced'),
       ($4, 'findmydoc-founder-execution', $1, 'Relationship Third', 'deliverable', 'Offen', 'P2', $6, $6, 'approved', 'not_requested', false, 'synced')
     returning id, updated_at::text as updated_at`,
    [initiativeId, sourceId, targetId, thirdId, founderId, otherFounderId],
  );
  const revisionById = new Map(inserted.rows.map((row) => [row.id, row.updated_at]));
  await client.query(
    `insert into public.planning_item_raci_assignments (task_id, profile_id, role, sort_order)
     values ($1, $2, 'accountable', 0)`,
    [initiativeId, founderId],
  );

  const prepared = await client.query(
    `select public.prepare_planning_relationship_command($1, $2, null, 'blocked_by', $3) as result`,
    [sourceId, targetId, founderId],
  );
  assert.equal(prepared.rows[0]?.result?.source?.id, sourceId);
  assert.equal(prepared.rows[0]?.result?.related?.id, targetId);
  assert.equal(prepared.rows[0]?.result?.initiative?.accountableProfileId, founderId);

  const created = await mutate({
    operation: "add",
    taskId: sourceId,
    relatedTaskId: targetId,
    relationType: "blocked_by",
    note: "Wait for target",
    expectedUpdatedAt: revisionById.get(sourceId),
    actorId: founderId,
  });
  const relationshipId = created?.relation?.id;
  assert.ok(relationshipId);
  assert.equal(created.relation.relation_type, "blocked_by");
  assert.deepEqual(created.affectedItemIds, [sourceId, targetId]);

  const committed = await client.query(
    `select
       (select count(*)::integer from public.task_relationship_edges where id = $1) as relationship_count,
       (select count(*)::integer from public.audit_log where action = 'task.relationship_created' and entity_id = $2) as audit_count,
       (select array_agg(github_issue_sync_status order by id) from public.tasks where id = any($3::text[])) as sync_statuses`,
    [relationshipId, sourceId, [sourceId, targetId]],
  );
  assert.equal(committed.rows[0]?.relationship_count, 1);
  assert.equal(committed.rows[0]?.audit_count, 1);
  assert.deepEqual(committed.rows[0]?.sync_statuses, ["not_synced", "not_synced"]);

  await client.query(
    `update public.tasks set github_issue_sync_status = 'synced' where id = any($1::text[])`,
    [[sourceId, targetId]],
  );
  await expectCode("P0003", () => mutate({
    operation: "add",
    taskId: sourceId,
    relatedTaskId: targetId,
    relationType: "blocked_by",
    actorId: founderId,
  }));
  const duplicateState = await client.query(
    `select
       (select count(*)::integer from public.task_relationship_edges where task_id = $1 and related_task_id = $2 and relation_type = 'blocked_by') as relationship_count,
       (select count(*)::integer from public.audit_log where action = 'task.relationship_created' and entity_id = $1) as audit_count,
       (select array_agg(github_issue_sync_status order by id) from public.tasks where id = any($3::text[])) as sync_statuses`,
    [sourceId, targetId, [sourceId, targetId]],
  );
  assert.equal(duplicateState.rows[0]?.relationship_count, 1);
  assert.equal(duplicateState.rows[0]?.audit_count, 1);
  assert.deepEqual(duplicateState.rows[0]?.sync_statuses, ["synced", "synced"]);

  await expectCode("P0006", () => mutate({
    operation: "add",
    taskId: sourceId,
    relatedTaskId: thirdId,
    relationType: "blocks",
    actorId: founderId,
  }));
  await expectCode("P0006", () => mutate({
    operation: "add",
    taskId: sourceId,
    relatedTaskId: thirdId,
    relationType: "blocked_by",
    actorId: viewerId,
  }));
  await expectCode("P0006", () => mutate({
    operation: "add",
    taskId: sourceId,
    relatedTaskId: thirdId,
    relationType: "blocked_by",
    actorId: otherFounderId,
  }));
  await expectCode("P0001", () => mutate({
    operation: "add",
    taskId: sourceId,
    relatedTaskId: thirdId,
    relationType: "relates_to",
    expectedUpdatedAt: revisionById.get(sourceId),
    actorId: ceoId,
  }));

  const removed = await mutate({
    operation: "remove",
    taskId: sourceId,
    relationId: relationshipId,
    actorId: founderId,
  });
  assert.equal(removed?.relation?.id, relationshipId);
  const removalState = await client.query(
    `select
       (select count(*)::integer from public.task_relationship_edges where id = $1) as relationship_count,
       (select count(*)::integer from public.audit_log where action = 'task.relationship_deleted' and entity_id = $2) as audit_count`,
    [relationshipId, sourceId],
  );
  assert.equal(removalState.rows[0]?.relationship_count, 0);
  assert.equal(removalState.rows[0]?.audit_count, 1);
  await expectCode("P0002", () => mutate({
    operation: "remove",
    taskId: sourceId,
    relationId: relationshipId,
    actorId: founderId,
  }));

  await client.query(
    `update public.tasks set review_status = 'requested', score_final = false where id = $1`,
    [targetId],
  );
  await expectCode("P0008", () => mutate({
    operation: "add",
    taskId: sourceId,
    relatedTaskId: targetId,
    relationType: "blocked_by",
    actorId: ceoId,
  }));

  const privileges = await client.query(
    `select
       has_function_privilege('authenticated', 'public.prepare_planning_relationship_command(text,text,bigint,text,text)', 'execute') as authenticated_prepare,
       has_function_privilege('authenticated', 'public.mutate_planning_relationship_transaction(text,text,text,text,bigint,text,timestamptz,text,text,text)', 'execute') as authenticated_commit,
       has_function_privilege('service_role', 'public.prepare_planning_relationship_command(text,text,bigint,text,text)', 'execute') as service_prepare,
       has_function_privilege('service_role', 'public.mutate_planning_relationship_transaction(text,text,text,text,bigint,text,timestamptz,text,text,text)', 'execute') as service_commit,
       has_table_privilege('authenticated', 'public.task_relationship_edges', 'insert') as authenticated_insert,
       has_table_privilege('authenticated', 'public.task_relationship_edges', 'update') as authenticated_update,
       has_table_privilege('authenticated', 'public.task_relationship_edges', 'delete') as authenticated_delete`,
  );
  assert.equal(privileges.rows[0]?.authenticated_prepare, false);
  assert.equal(privileges.rows[0]?.authenticated_commit, false);
  assert.equal(privileges.rows[0]?.service_prepare, true);
  assert.equal(privileges.rows[0]?.service_commit, true);
  assert.equal(privileges.rows[0]?.authenticated_insert, false);
  assert.equal(privileges.rows[0]?.authenticated_update, false);
  assert.equal(privileges.rows[0]?.authenticated_delete, false);

  console.log("Planning relationship transaction, policy parity, atomic effects, and direct-write closure verified; all data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
