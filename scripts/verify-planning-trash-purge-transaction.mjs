import pg from "pg";
import { loadLocalEnv } from "./lib/env.mjs";

await loadLocalEnv();

const password = process.env.SUPABASE_DB_PASSWORD;
const host = process.env.SUPABASE_DB_HOST?.trim();
const port = Number(process.env.SUPABASE_DB_PORT || 5432);
const user = process.env.SUPABASE_DB_USER?.trim();
const database = process.env.SUPABASE_DB_NAME || "postgres";
const ssl = process.env.SUPABASE_DB_SSL === "false" ? false : { rejectUnauthorized: false };
const local = process.argv.includes("--local");

if (!local && (!host || !user || !password)) {
  console.error("Missing SUPABASE_DB_HOST, SUPABASE_DB_USER, or SUPABASE_DB_PASSWORD.");
  process.exit(1);
}

const client = new pg.Client(local
  ? { host: "127.0.0.1", port: 54322, user: "postgres", password: "postgres", database: "postgres", ssl: false }
  : { host, port, user, password, database, ssl });
const suffix = Date.now();
const id = (kind) => `verify-trash-purge-${kind}-${suffix}`;
const ids = {
  profile: id("profile"),
  project: id("project"),
  initiative: id("initiative"),
  eligible: id("eligible"),
  eligibleChild: id("eligible-child"),
  blocked: id("blocked"),
  blockedChild: id("blocked-child"),
  late: id("late"),
  lateChild: id("late-child"),
  initiativeRoot: id("initiative-root"),
  initiativeMember: id("initiative-member"),
  externalChild: id("external-child"),
  historicalInitiative: id("historical-initiative"),
  historicalMember: id("historical-member"),
  historicalEpic: id("historical-epic"),
};
const expiredAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
const expiredAfter = new Date(new Date(expiredAt).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
const lateAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const lateAfter = new Date(new Date(lateAt).getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

await client.connect();
await client.query("begin");
try {
  await client.query(
    "insert into public.profiles (id,name,role,platform_role) values ($1,'Planning trash purge verifier','admin','ceo')",
    [ids.profile],
  );
  await client.query(
    "insert into public.projects (id,name,range_label) values ($1,'Planning trash purge verifier','Verification')",
    [ids.project],
  );
  await client.query(
    `insert into public.tasks
       (id,project_id,title,task_type,status,owner,assignee,sort_order)
     values ($1,'findmydoc-founder-execution','Historical empty Epic','epic','Offen',$2,$2,0)`,
    [ids.historicalEpic, ids.profile],
  );
  const historicalEpicRevision = (await client.query(
    "select updated_at::text as revision from public.tasks where id=$1",
    [ids.historicalEpic],
  )).rows[0]?.revision;
  await client.query(
    `insert into public.planning_item_historical_links
       (item_type,historical_id,task_id,project_id,source_snapshot)
     values ('epic',$1,$2,'findmydoc-founder-execution',$3::jsonb)`,
    [`historical-${ids.historicalEpic}`, ids.historicalEpic, JSON.stringify({ title: "Retained historical Epic source" })],
  );
  const historicalEpicPreview = await client.query(
    "select public.prepare_empty_epic_delete($1) as result",
    [ids.historicalEpic],
  );
  if (historicalEpicPreview.rows[0]?.result?.children?.initiatives !== 0
      || historicalEpicPreview.rows[0]?.result?.children?.tasks !== 0) {
    throw new Error("Historical empty Epic preview did not use canonical child counts.");
  }
  await client.query(
    "select public.delete_empty_epic_transaction($1,$2,$3)",
    [ids.historicalEpic, historicalEpicRevision, ids.profile],
  );
  const historicalEpicRetention = await client.query(
    `select
       (select count(*)::integer from public.tasks where id=$1) task_count,
       (select count(*)::integer from public.planning_item_historical_links where task_id=$1 and source_snapshot is not null) link_count`,
    [ids.historicalEpic],
  );
  if (historicalEpicRetention.rows[0]?.task_count !== 0 || historicalEpicRetention.rows[0]?.link_count !== 1) {
    throw new Error("Historical Epic source snapshot did not survive canonical deletion.");
  }
  await client.query("select set_config('founderops.trash_lifecycle_write', 'on', true)");
  await client.query(
    `insert into public.tasks (
       id,project_id,parent_task_id,title,task_type,status,priority,owner,assignee,
       approval_status,approval_revision,proposed_by,review_status,score_relevant,github_repo,
       trashed_at,trashed_by,trash_reason,trash_cause,purge_after,trash_root_type,trash_root_id,trash_revision
     ) values
       ($1,$10,null,'Purge Initiative','initiative','Offen','P2',$11,$11,'approved',1,$11,'not_requested',false,null,null,null,null,null,null,null,null,0),
       ($2,$10,$1,'Eligible root','deliverable','Offen','P2',$11,$11,'approved',1,$11,'not_requested',false,'findmydoc-platform/management',$12,$11,'Verification','withdrawn',$13,'deliverable',$2,1),
       ($3,$10,$2,'Eligible child','sub_issue','Offen','P2',$11,$11,null,1,$11,'not_requested',false,'findmydoc-platform/management',$12,$11,'Verification','withdrawn',$13,'deliverable',$2,1),
       ($4,$10,$1,'Blocked root','deliverable','Offen','P2',$11,$11,'approved',1,$11,'not_requested',false,'findmydoc-platform/management',$12,$11,'Verification','withdrawn',$13,'deliverable',$4,1),
       ($5,$10,$4,'Blocked child','sub_issue','Offen','P2',$11,$11,null,1,$11,'not_requested',false,'findmydoc-platform/management',$12,$11,'Verification','withdrawn',$13,'deliverable',$4,1),
       ($6,$10,$1,'Late root','deliverable','Offen','P2',$11,$11,'approved',1,$11,'not_requested',false,'findmydoc-platform/management',$14,$11,'Verification','withdrawn',$15,'deliverable',$6,1),
       ($7,$10,$6,'Late child','sub_issue','Offen','P2',$11,$11,null,1,$11,'not_requested',false,'findmydoc-platform/management',$14,$11,'Verification','withdrawn',$15,'deliverable',$6,1),
       ($8,$10,null,'Initiative cascade root','initiative','Offen','P2',$11,$11,'draft',1,$11,'not_requested',false,null,$12,$11,'Verification','withdrawn',$13,'initiative',$8,1),
       ($9,$10,$8,'Initiative member','deliverable','Offen','P2',$11,$11,'approved',1,$11,'not_requested',false,'findmydoc-platform/management',$12,$11,'Verification','withdrawn',$13,'initiative',$8,1),
       ($16,$10,null,'Historical initiative root','initiative','Offen','P2',$11,$11,'draft',1,$11,'not_requested',false,null,$12,$11,'Verification','withdrawn',$13,'initiative',$16,1),
       ($17,$10,$16,'Historical initiative member','deliverable','Offen','P2',$11,$11,'approved',1,$11,'not_requested',false,'findmydoc-platform/management',$12,$11,'Verification','withdrawn',$13,'initiative',$16,1)`,
    [
      ids.initiative, ids.eligible, ids.eligibleChild, ids.blocked, ids.blockedChild,
      ids.late, ids.lateChild, ids.initiativeRoot, ids.initiativeMember, ids.project,
      ids.profile, expiredAt, expiredAfter, lateAt, lateAfter,
      ids.historicalInitiative, ids.historicalMember,
    ],
  );
  await client.query(
    `insert into public.tasks (
       id,project_id,parent_task_id,title,task_type,status,priority,owner,assignee,
       approval_status,approval_revision,proposed_by,review_status,score_relevant,github_repo,
       trashed_at,trashed_by,trash_reason,trash_cause,purge_after,trash_root_type,trash_root_id,trash_revision
     ) values ($1,$2,$3,'External retained child','sub_issue','Offen','P2',$4,$4,null,1,$4,'not_requested',false,'findmydoc-platform/management',
       $5,$4,'Independent retention','withdrawn',$6,'deliverable',$1,1)`,
    [ids.externalChild, ids.project, ids.initiativeMember, ids.profile, lateAt, lateAfter],
  );
  await client.query("select set_config('founderops.trash_lifecycle_write', 'off', true)");

  await client.query(
    `insert into public.planning_item_historical_links
       (item_type,historical_id,task_id,project_id,source_snapshot)
     values ('initiative',$1,$2,$3,$4::jsonb)`,
    [`historical-${ids.historicalInitiative}`, ids.historicalInitiative, ids.project, JSON.stringify({ title: "Retained historical source" })],
  );

  await client.query(
    `insert into public.planning_github_lifecycle_outbox (
       root_type,root_id,root_trash_revision,task_id,action,source_type,source_revision,status,status_reason,completed_at
     ) values
       ('deliverable',$1,1,$1,'close_not_planned','withdrawn',1,'completed','issue_missing',now()),
       ('deliverable',$1,1,$2,'close_not_planned','withdrawn',1,'completed','issue_missing',now()),
       ('deliverable',$3,1,$3,'close_not_planned','withdrawn',1,'completed','issue_missing',now()),
       ('initiative',$4,1,$5,'close_not_planned','withdrawn',1,'completed','issue_missing',now())`,
    [ids.eligible, ids.eligibleChild, ids.blocked, ids.historicalInitiative, ids.historicalMember],
  );
  const notification = await client.query(
    `insert into public.notification_events (type,recipient_profile_id,entity_type,entity_id,title,body)
     values ('planning_item.rejected',$1,'task',$2,'Purge notification','Verification') returning id`,
    [ids.profile, ids.eligible],
  );

  const dryRun = await client.query("select public.purge_expired_planning_trash_batch(25,true) as result");
  if (dryRun.rows[0]?.result?.dryRun !== true || dryRun.rows[0]?.result?.eligibleRoots !== 2) {
    throw new Error("Canonical planning trash purge dry-run did not identify both eligible roots.");
  }
  const before = await client.query("select count(*)::integer as count from public.tasks where id = any($1::text[])", [[ids.eligible, ids.eligibleChild]]);
  if (before.rows[0]?.count !== 2) throw new Error("Planning trash purge dry-run changed source rows.");

  const purge = await client.query("select public.purge_expired_planning_trash_batch(25,false) as result");
  if (purge.rows[0]?.result?.purgedRoots !== 2 || purge.rows[0]?.result?.purgedTasks !== 4) {
    throw new Error("Canonical planning trash purge did not remove both eligible trees.");
  }
  const persisted = await client.query(
    `select
       (select count(*)::integer from public.tasks where id = any($1::text[])) eligible_count,
       (select count(*)::integer from public.tasks where id = any($2::text[])) blocked_count,
       (select count(*)::integer from public.tasks where id = any($3::text[])) late_count,
       (select count(*)::integer from public.tasks where id = any($4::text[])) initiative_count,
       (select count(*)::integer from public.audit_log where action='planning_trash.purge' and entity_id=$5) audit_count,
       (select status from public.notification_events where id=$6) notification_status,
       (select count(*)::integer from public.tasks where id = any($7::text[])) historical_task_count,
       (select count(*)::integer from public.planning_item_historical_links where task_id=$8 and source_snapshot is not null) historical_link_count`,
    [
      [ids.eligible, ids.eligibleChild], [ids.blocked, ids.blockedChild], [ids.late, ids.lateChild],
      [ids.initiativeRoot, ids.initiativeMember, ids.externalChild], ids.eligible, notification.rows[0].id,
      [ids.historicalInitiative, ids.historicalMember], ids.historicalInitiative,
    ],
  );
  const result = persisted.rows[0];
  if (result.eligible_count !== 0 || result.blocked_count !== 2 || result.late_count !== 2 || result.initiative_count !== 3) {
    throw new Error("Canonical planning trash purge violated lifecycle, retention, or hierarchy boundaries.");
  }
  if (result.audit_count !== 1 || result.notification_status !== "resolved") {
    throw new Error("Canonical planning trash purge did not commit audit and notification effects atomically.");
  }
  if (result.historical_task_count !== 0 || result.historical_link_count !== 1) {
    throw new Error("Historical source snapshots were not retained independently of purged canonical items.");
  }
  console.log("Canonical Planning trash purge verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
