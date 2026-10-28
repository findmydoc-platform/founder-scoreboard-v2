import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";
const name="20261028045846_protect_score_objection_displayed_basis.sql",migration=resolve("supabase/migrations",name);
const legacy="public.process_score_objection_transaction",guarded="public.process_score_objection_with_basis_transaction";
const columns=["score_objections","founder_sprint_scores","audit_log","tasks","sprints"];
async function snapshot(db){const out={};for(const table of columns)out[table]=(await db.query(`select to_jsonb(row) as data from public.${table} row order by to_jsonb(row)::text`)).rows;return out;}
async function objection(db,id){return(await db.query("select to_jsonb(row) as data from public.score_objections row where id=$1",[id])).rows[0].data;}
async function score(db,sprint="basis-sprint",profile="basis-founder"){return(await db.query("select to_jsonb(row) as data from public.founder_sprint_scores row where sprint_id=$1 and profile_id=$2",[sprint,profile])).rows[0]?.data||null;}
async function create(db,profile="basis-founder",sprint="basis-sprint"){return(await db.query("select public.create_score_objection_transaction($1,$2,'Original objection',null,null) as data",[sprint,profile])).rows[0].data;}
async function process(db,shown,{actor="basis-ceo",action="assign_second_review",reviewer="basis-reviewer",expectedScore=null,status="accepted",decision="Independent evidence",comment="Verified",guard=true,basis=shown}={}){
 const values=[shown.sprint_id,shown.id,actor,action,status,comment,10,3,4,reviewer,decision,null,null];
 if(guard)return db.query(`select ${guarded}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb) as data`,[...values,JSON.stringify(basis),JSON.stringify(expectedScore)]);
 return db.query(`select ${legacy}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) as data`,values);
}
async function waiting(db,pid){const deadline=Date.now()+10000;while(Date.now()<deadline){if((await db.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0]?.wait_event_type==="Lock")return;}throw new Error("Expected actual Sprint lock wait");}
it("preserves existing Score policy and atomically compares the displayed objection and accepted-score tuples",{timeout:120000},async()=>{
 const previous=(await readdir(resolve("supabase/migrations"))).filter(file=>file.endsWith(".sql")&&file<name).sort().at(-1);await resetLocalDatabaseTo(previous.slice(0,14));
 await withLocalDatabase(async db=>{
  await db.query("insert into public.projects(id,name) values('findmydoc-founder-execution','FounderOps'); insert into public.profiles(id,name,platform_role) values('basis-ceo','CEO','ceo'),('basis-founder','Founder','founder'),('basis-reviewer','Reviewer','founder'),('basis-other','Other reviewer','deputy'),('basis-third','Third reviewer','founder'),('basis-viewer','Viewer','viewer'); insert into public.sprints(id,project_id,name,status,end_date,review_due_at) values('basis-sprint','findmydoc-founder-execution','Sprint','review',current_date-1,clock_timestamp()+interval '1 day'); insert into public.tasks(id,project_id,title,status,priority,task_type) values('basis-task','findmydoc-founder-execution','Independent task','Offen','P2','initiative')");
  const original=await create(db);
  const assigned=(await process(db,original,{guard:false})).rows[0].data.objection;
  const changed=(await process(db,original,{guard:false,reviewer:"basis-other"})).rows[0].data.objection;
  expect(assigned.second_reviewer_profile_id).toBe("basis-reviewer");expect(changed.second_reviewer_profile_id).toBe("basis-other");
  const before=await snapshot(db);const oldAcl=(await db.query("select oid::regprocedure::text as signature,proacl::text as acl from pg_proc where proname in ('process_score_objection_transaction','resolve_score_objection_transaction','create_score_objection_transaction') order by proname")).rows;
  await applyMigration(db,migration);expect(await snapshot(db)).toEqual(before);expect((await db.query("select oid::regprocedure::text as signature,proacl::text as acl from pg_proc where proname in ('process_score_objection_transaction','resolve_score_objection_transaction','create_score_objection_transaction') order by proname")).rows).toEqual(oldAcl);
  await expect(process(db,assigned)).rejects.toMatchObject({code:"P0007"});expect(await snapshot(db)).toEqual(before);
  for(const malformed of [null,{},[changed],{...changed,unexpected:"field"},{...changed,id:"invalid"}]){await expect(process(db,changed,{basis:malformed})).rejects.toMatchObject({code:expect.stringMatching(/22023|P0007/)});expect(await snapshot(db)).toEqual(before);}
  for(const role of ["anon","authenticated"]){await db.query("begin");await db.query(`set local role ${role}`);await expect(process(db,changed)).rejects.toMatchObject({code:"42501"});await db.query("rollback");}
  for(const actor of ["basis-founder","basis-other","basis-viewer"]){await expect(process(db,changed,{actor})).rejects.toMatchObject({code:"P0005"});expect(await snapshot(db)).toEqual(before);}
  const first=process(db,changed,{reviewer:"basis-reviewer"}).then(value=>({value}),error=>({error}));
  await withLocalDatabase(async contender=>{const second=process(contender,changed,{reviewer:"basis-third"}).then(value=>({value}),error=>({error}));const outcomes=await Promise.all([first,second]);expect(outcomes.filter(outcome=>outcome.value)).toHaveLength(1);expect(outcomes.find(outcome=>outcome.error)?.error.code).toBe("P0007");});
  const live=await objection(db,original.id);
  await process(db,live,{guard:false,reviewer:"basis-other"});await process(db,live,{guard:false,reviewer:live.second_reviewer_profile_id});
  expect((await process(db,live,{reviewer:"basis-reviewer"})).rows[0].data.objection.second_reviewer_profile_id).toBe("basis-reviewer");
  const own=await create(db,"basis-ceo");await expect(process(db,own,{action:"resolve"})).rejects.toMatchObject({code:"P0005"});
  const ownAssigned=(await process(db,own)).rows[0].data.objection;
  await expect(process(db,ownAssigned,{actor:"basis-other",action:"second_review"})).rejects.toMatchObject({code:"P0005"});
  const reviewed=(await process(db,ownAssigned,{actor:"basis-reviewer",action:"second_review"})).rows[0].data.objection;
  const ownDone=(await process(db,reviewed,{action:"resolve"})).rows[0].data;expect(ownDone.objection.status).toBe("accepted");expect(ownDone.score.total_points).toBe(17);
  const next=await create(db),other=await create(db);expect(next.id).not.toBe(other.id);
  const shownScore=await score(db);
  await process(db,other,{guard:false,action:"resolve"});const afterForeign=await snapshot(db);
  await expect(process(db,next,{action:"resolve",expectedScore:shownScore})).rejects.toMatchObject({code:"P0007"});expect(await snapshot(db)).toEqual(afterForeign);
  const presentBasis=await score(db),further=await create(db);await process(db,further,{guard:false,action:"resolve"});const afterSecondForeign=await snapshot(db);await expect(process(db,next,{action:"resolve",expectedScore:presentBasis})).rejects.toMatchObject({code:"P0007"});expect(await snapshot(db)).toEqual(afterSecondForeign);
  const accepted=(await process(db,next,{action:"resolve",expectedScore:await score(db)})).rows[0].data;expect(accepted.score.total_points).toBe(17);expect(accepted.objection.status).toBe("accepted");
  const concurrent=await create(db);await db.query("begin");await process(db,concurrent,{guard:false});
  await withLocalDatabase(async contender=>{const pid=(await contender.query("select pg_backend_pid() as pid")).rows[0].pid;const pending=process(contender,concurrent,{reviewer:"basis-other"}).then(value=>({value}),error=>({error}));await waiting(db,pid);await db.query("commit");expect((await pending).error?.code).toBe("P0007");});
  await db.query("update public.sprints set score_locked=true where id='basis-sprint'");await expect(process(db,await objection(db,concurrent.id))).rejects.toMatchObject({code:"P0003"});
  expect((await db.query("select title from public.tasks where id='basis-task'")).rows).toEqual([{title:"Independent task"}]);
  const preserved=await snapshot(db);await applyMigration(db,migration);expect(await snapshot(db)).toEqual(preserved);
 });
});


it("denies direct authenticated Score writes even for a mapped deputy after Sprint scoring is locked", async () => {
 await withLocalDatabase(async db => {
  await db.query("begin");
  try {
   await db.query("insert into auth.users(id,email,role,aud) values('c6f91a65-2883-40e7-b740-dcbcc44ed556','score-parity@example.test','authenticated','authenticated'); update public.profiles set auth_user_id='c6f91a65-2883-40e7-b740-dcbcc44ed556' where id='basis-other'; update workspace_private.configuration set mode='legacy',linking_enforced=false where singleton");
   await db.query("select set_config('request.jwt.claim.sub','c6f91a65-2883-40e7-b740-dcbcc44ed556',true),set_config('request.jwt.claim.role','authenticated',true)");
   await db.query("set local role authenticated");
   expect((await db.query("select public.current_platform_role() as role,public.workspace_request_admitted() as admitted")).rows).toEqual([{role:"deputy",admitted:true}]);
   expect((await db.query("select count(*)::integer as count from public.founder_sprint_scores where sprint_id='basis-sprint'")).rows[0].count).toBeGreaterThan(0);
   for(const operation of [
    "insert into public.founder_sprint_scores(sprint_id,profile_id,delivery_points,form_points,weekly_points,total_points,fulfilled,finalized_by,finalized_at) values('basis-sprint','basis-third',12,4,4,20,true,'basis-other',clock_timestamp()) returning id",
    "update public.founder_sprint_scores set delivery_points=0 where sprint_id='basis-sprint' returning id",
    "delete from public.founder_sprint_scores where sprint_id='basis-sprint' returning id",
    "insert into public.score_objections(sprint_id,profile_id,comment) values('basis-sprint','basis-other','Bypassed creation') returning id",
    "update public.score_objections set status='accepted' where sprint_id='basis-sprint' returning id",
   ]) {
    await db.query("savepoint denied_score_write");
    let failure;
    try { await db.query(operation); } catch(error) { failure=error; }
    await db.query("rollback to savepoint denied_score_write");
    expect(failure, "A mapped deputy must not bypass the Sprint transaction through direct Score/objection DML").toMatchObject({code:"42501"});
   }
  } finally { await db.query("rollback"); }
 });
});
