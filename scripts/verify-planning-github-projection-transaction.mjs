import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST || "127.0.0.1",
  port: Number(process.env.SUPABASE_DB_PORT || 54322),
  user: process.env.SUPABASE_DB_USER || "postgres",
  password: process.env.SUPABASE_DB_PASSWORD || "postgres",
  database: process.env.SUPABASE_DB_NAME || "postgres",
  ssl: process.env.SUPABASE_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

await client.connect();
await client.query("begin");
try {
  const suffix = randomUUID().replaceAll("-", "");
  const profileId = `projection-profile-${suffix}`;
  const initiativeId = `projection-initiative-${suffix}`;
  const taskId = `projection-task-${suffix}`;
  const tokenId = randomUUID();
  const operationKey = randomUUID();
  const operationId = `team-sync:${tokenId}:${operationKey}`;

  await client.query("insert into public.profiles (id,name,role,platform_role) values ($1,'Projection Founder','member','founder')", [profileId]);
  await client.query("insert into public.projects (id,name) values ('findmydoc-founder-execution','FounderOps') on conflict (id) do nothing");
  await client.query(
    `insert into public.tasks (id,project_id,task_type,title,status,priority,owner,assignee,approval_status,sort_order)
     values ($1,'findmydoc-founder-execution','initiative','Projection Initiative','Offen','P2',$2,$2,'approved',0)`,
    [initiativeId, profileId],
  );
  await client.query(
    `insert into public.tasks (id,project_id,task_type,title,status,priority,owner,assignee,parent_task_id,approval_status,github_repo,github_issue_number,sort_order)
     values ($1,'findmydoc-founder-execution','deliverable','Projection Deliverable','Offen','P2',$2,$2,$3,'approved','findmydoc-platform/management',42,0)`,
    [taskId, profileId, initiativeId],
  );
  await client.query(
    `insert into public.team_task_intake_tokens (id,profile_id,label,token_hash,token_hint,scopes,expires_at)
     values ($1::uuid,$2,'Projection verifier',encode(digest($1::text,'sha256'),'hex'),left($1::text,12),array['read:planning-context','write:planning-items:create','write:planning-items:update','write:planning-items:github-sync'],now()+interval '1 hour')`,
    [tokenId, profileId],
  );

  const first = await client.query(
    "select public.enqueue_team_planning_github_projection_transaction($1,$2,$3,$4,true) result",
    [tokenId, profileId, taskId, operationKey],
  );
  const replay = await client.query(
    "select public.enqueue_team_planning_github_projection_transaction($1,$2,$3,$4,true) result",
    [tokenId, profileId, taskId, operationKey],
  );
  assert.equal(first.rows[0].result.operationId, operationId);
  assert.equal(replay.rows[0].result.operationId, operationId);
  const duplicateCount = await client.query(
    "select count(*)::integer count from public.planning_github_projection_outbox where planning_operation_id=$1",
    [operationId],
  );
  assert.equal(duplicateCount.rows[0].count, 1);
  await client.query("savepoint projection_idempotency_conflict");
  await assert.rejects(
    client.query(
      "select public.enqueue_team_planning_github_projection_transaction($1,$2,$3,$4,false)",
      [tokenId, profileId, taskId, operationKey],
    ),
    (error) => error?.code === "P0003",
  );
  await client.query("rollback to savepoint projection_idempotency_conflict");
  await client.query("release savepoint projection_idempotency_conflict");

  const firstLock = randomUUID();
  const claim = await client.query(
    "select * from public.claim_planning_github_projection_requests($1,25,120,$2)",
    [firstLock, operationId],
  );
  assert.equal(claim.rows.length, 1);
  await client.query(
    "update public.planning_github_projection_outbox set locked_at=now()-interval '10 minutes' where id=$1",
    [claim.rows[0].id],
  );
  const recoveredLock = randomUUID();
  const recovered = await client.query(
    "select * from public.claim_planning_github_projection_requests($1,25,120,$2)",
    [recoveredLock, operationId],
  );
  assert.equal(recovered.rows[0].id, claim.rows[0].id);
  assert.equal(recovered.rows[0].attempts, 2);
  await client.query(
    "select public.finalize_planning_github_projection_request($1,$2,true,$3::jsonb,null)",
    [claim.rows[0].id, recoveredLock, JSON.stringify({ status: "synced", code: "github_sync_succeeded" })],
  );

  const orderedOperation = `verify-order:${suffix}`;
  const ordered = await client.query(
    "select (public.enqueue_planning_github_projection_request($1,$2,$3,true)).*",
    [orderedOperation, taskId, profileId],
  );
  await client.query(
    `insert into public.planning_github_lifecycle_outbox
      (root_type,root_id,root_trash_revision,task_id,github_repo,github_issue_number,action,source_type,source_revision)
     values ('deliverable',$1,1,$1,'findmydoc-platform/management',42,'close_not_planned','withdrawn',1)`,
    [taskId],
  );
  const blockedLifecycle = await client.query(
    "select * from public.claim_planning_github_lifecycle_jobs($1,25,120)",
    [randomUUID()],
  );
  assert.equal(blockedLifecycle.rows.some((row) => row.task_id === taskId), false);
  const orderedLock = randomUUID();
  await client.query(
    "select * from public.claim_planning_github_projection_requests($1,25,120,$2)",
    [orderedLock, orderedOperation],
  );
  await client.query(
    "select public.finalize_planning_github_projection_request($1,$2,true,$3::jsonb,null)",
    [ordered.rows[0].id, orderedLock, JSON.stringify({ status: "synced", code: "github_sync_succeeded" })],
  );
  const lifecycleLock = randomUUID();
  const unblockedLifecycle = await client.query(
    "select * from public.claim_planning_github_lifecycle_jobs($1,25,120)",
    [lifecycleLock],
  );
  assert.equal(unblockedLifecycle.rows.some((row) => row.task_id === taskId), true);

  const before = await client.query("select title,updated_at::text as updated_at from public.tasks where id=$1", [taskId]);
  const triggerName = `fail_projection_${suffix}`;
  await client.query(`
    create function public.${triggerName}() returns trigger language plpgsql as $$
    begin raise exception using errcode='XX000', message='injected projection enqueue failure'; end; $$;
    create trigger ${triggerName} before insert on public.planning_github_projection_outbox
      for each row execute function public.${triggerName}();
  `);
  await client.query("savepoint projection_enqueue_failure");
  await assert.rejects(
    client.query(
      `select public.update_team_planning_item_with_projection_transaction(
        $1,$2,'deliverable',$3,$4,$5,$6,$7::jsonb,$8::jsonb,'[]'::jsonb,$9::jsonb,null,null
      )`,
      [
        tokenId,
        profileId,
        taskId,
        before.rows[0].updated_at,
        randomUUID(),
        "a".repeat(64),
        JSON.stringify({ title: "Must Roll Back" }),
        JSON.stringify(["title"]),
        JSON.stringify({ createIfMissing: true }),
      ],
    ),
    (error) => error?.code === "XX000",
  );
  await client.query("rollback to savepoint projection_enqueue_failure");
  await client.query("release savepoint projection_enqueue_failure");
  const after = await client.query("select title,updated_at::text as updated_at from public.tasks where id=$1", [taskId]);
  assert.deepEqual(after.rows[0], before.rows[0]);

  const privileges = await client.query(
    `select
      has_table_privilege('anon','public.planning_github_projection_outbox','select') anon_select,
      has_table_privilege('authenticated','public.planning_github_projection_outbox','select') authenticated_select,
      has_function_privilege('service_role','public.claim_planning_github_projection_requests(uuid,integer,integer,text)','execute') service_claim`,
  );
  assert.deepEqual(privileges.rows[0], {
    anon_select: false,
    authenticated_select: false,
    service_claim: true,
  });

  console.log("Planning GitHub projection transaction verification passed.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
