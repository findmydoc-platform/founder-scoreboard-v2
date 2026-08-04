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
  const savepoint = `bulk_sprint_expected_${randomUUID().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await operation();
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    assert.equal(error?.code, code, `Expected SQLSTATE ${code}, received ${error?.code || "none"}.`);
    return;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  throw new Error(`Expected SQLSTATE ${code}, but the operation succeeded.`);
}

await client.connect();
await client.query("begin");

try {
  const suffix = randomUUID().replaceAll("-", "");
  const projectId = `bulk-sprint-project-${suffix}`;
  const profileId = `bulk-sprint-profile-${suffix}`;
  const sprintId = `bulk-sprint-target-${suffix}`;
  const epicId = `bulk-sprint-epic-${suffix}`;
  const initiativeId = `bulk-sprint-initiative-${suffix}`;
  const taskIds = [`bulk-sprint-one-${suffix}`, `bulk-sprint-two-${suffix}`];

  await client.query(
    `insert into public.profiles (id, name, role, platform_role)
     values ($1, 'Bulk Sprint verifier', 'admin', 'ceo')`,
    [profileId],
  );
  await client.query(
    "insert into public.projects (id, name) values ($1, 'Bulk Sprint verification')",
    [projectId],
  );
  await client.query(
    "insert into public.sprints (id, project_id, name, status) values ($1, $2, 'Target Sprint', 'planning')",
    [sprintId, projectId],
  );
  await client.query(
    `insert into public.tasks (id, project_id, title, status, priority, owner, assignee, task_type, score_relevant, approval_status)
     values ($1, $2, 'Verification Epic', 'Offen', null, $3, $3, 'epic', false, null)`,
    [epicId, projectId, profileId],
  );
  await client.query(
    `insert into public.tasks (id, project_id, parent_task_id, title, status, priority, owner, assignee, task_type, score_relevant, approval_status)
     values ($1, $2, $3, 'Verification Initiative', 'Offen', 'P1', $4, $4, 'initiative', false, 'approved')`,
    [initiativeId, projectId, epicId, profileId],
  );
  for (const [index, taskId] of taskIds.entries()) {
    await client.query(
      `insert into public.tasks (id, project_id, parent_task_id, title, status, priority, owner, assignee, sort_order, task_type, score_relevant, approval_status)
       values ($1, $2, $3, $4, 'Offen', 'P2', $5, $5, $6, 'deliverable', false, 'approved')`,
      [taskId, projectId, initiativeId, `Verification Deliverable ${index + 1}`, profileId, index + 1],
    );
  }

  const revisions = await client.query(
    "select id, updated_at::text as updated_at from public.tasks where id = any($1::text[]) order by id",
    [taskIds],
  );
  const assignments = revisions.rows.map((row) => ({
    taskId: row.id,
    expectedUpdatedAt: row.updated_at,
  }));
  const assigned = await client.query(
    "select public.assign_backlog_tasks_to_sprint_transaction($1::jsonb, $2, $3, null, 'local verifier') as result",
    [JSON.stringify(assignments), sprintId, profileId],
  );
  assert.equal(assigned.rows[0]?.result?.length, 2);

  const persisted = await client.query(
    "select id, sprint_id, score_relevant from public.tasks where id = any($1::text[]) order by id",
    [taskIds],
  );
  assert.deepEqual(persisted.rows.map((row) => [row.id, row.sprint_id, row.score_relevant]), taskIds.slice().sort().map((taskId) => [taskId, sprintId, true]));
  const audit = await client.query(
    "select count(*)::integer as count from public.audit_log where action = 'task.sprint.bulk_assigned' and entity_id = any($1::text[])",
    [taskIds],
  );
  assert.equal(audit.rows[0]?.count, 2);

  await client.query(
    "update public.tasks set sprint_id = null, score_relevant = false, updated_at = clock_timestamp() where id = any($1::text[])",
    [taskIds],
  );
  const currentRevisions = await client.query(
    "select id, updated_at::text as updated_at from public.tasks where id = any($1::text[]) order by id",
    [taskIds],
  );
  const staleAssignments = currentRevisions.rows.map((row, index) => ({
    taskId: row.id,
    expectedUpdatedAt: index === 0 ? "2000-01-01T00:00:00.000Z" : row.updated_at,
  }));
  await expectCode("P0001", () => client.query(
    "select public.assign_backlog_tasks_to_sprint_transaction($1::jsonb, $2, $3, null, 'local verifier')",
    [JSON.stringify(staleAssignments), sprintId, profileId],
  ));
  const unchanged = await client.query(
    "select count(*)::integer as count from public.tasks where id = any($1::text[]) and sprint_id is null and score_relevant = false",
    [taskIds],
  );
  assert.equal(unchanged.rows[0]?.count, 2, "A stale item must roll back the complete selection.");

  const privileges = await client.query(
    `select
       has_function_privilege('authenticated', 'public.assign_backlog_tasks_to_sprint_transaction(jsonb,text,text,text,text)'::regprocedure, 'execute') as authenticated,
       has_function_privilege('service_role', 'public.assign_backlog_tasks_to_sprint_transaction(jsonb,text,text,text,text)'::regprocedure, 'execute') as service_role`,
  );
  assert.equal(privileges.rows[0]?.authenticated, false);
  assert.equal(privileges.rows[0]?.service_role, true);

  await client.query("rollback");
  console.log("Atomic bulk Sprint assignment verified.");
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
