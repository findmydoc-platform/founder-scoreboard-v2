import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves version 72 selection payloads and authority while adding only complete Gantt toolbar aggregates", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261118074553");
  await withLocalDatabase(async db => {
    const userId=randomUUID();
    await db.query("insert into auth.users(id,email,role,aud) values($1,'gantt-migration@example.test','authenticated','authenticated')",[userId]);
    await db.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Gantt migration fixture')");
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('gantt-founder',$1,'Gantt founder','founder')",[userId]);
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,owner) values('gantt-epic','findmydoc-founder-execution','Epic','epic','Offen','gantt-founder')");
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner)
      values('gantt-parent','findmydoc-founder-execution','Parent','initiative','gantt-epic','Offen','P2','approved','gantt-founder'),
        ('gantt-other-parent','findmydoc-founder-execution','Other parent','initiative','gantt-epic','Offen','P2','approved','gantt-founder')`);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner,sort_order)
      values('gantt-open','findmydoc-founder-execution','Open','deliverable','gantt-parent','Offen','P2','approved','gantt-founder',2),
        ('gantt-done','findmydoc-founder-execution','Done','deliverable','gantt-parent','Erledigt','P0','approved','gantt-founder',9),
        ('gantt-proposed','findmydoc-founder-execution','Proposed','deliverable','gantt-parent','Offen','P0','proposed','gantt-founder',0),
        ('gantt-other','findmydoc-founder-execution','Other','deliverable','gantt-other-parent','Offen','P1','approved','gantt-founder',1)`);
    await db.query("insert into public.sprints(id,project_id,name,status,start_date,end_date) values('gantt-sprint','findmydoc-founder-execution','Gantt Sprint','planning',current_date-1,current_date+1)");
    await db.query("update public.tasks set sprint_id='gantt-sprint' where id in ('gantt-open','gantt-done','gantt-other')");
    const evaluatedAt=(await db.query("select statement_timestamp()::text value")).rows[0].value;
    const signature="public.planning_deliverable_query_basis(text,jsonb,text,integer,integer,text,timestamptz,boolean)";
    const oldSignatures=[signature,"public.planning_deliverable_query_plan(text,jsonb,integer,timestamptz)",
      "public.planning_deliverable_selection(text,jsonb,text,integer,integer,text,timestamptz)",
      "public.planning_deliverable_column(text,text[],text,timestamptz,timestamptz)",
      "public.planning_gantt_selection(text,uuid,jsonb,timestamptz)"];
    const definitions=async()=>(await db.query(`select oid::regprocedure::text as signature,pg_get_userbyid(proowner) as owner,
      prosecdef,provolatile,proconfig,proacl::text as acl,proargnames,prorettype::regtype::text as returns
      from pg_proc where oid=any($1::regprocedure[]) order by oid::regprocedure::text`,[oldSignatures])).rows;
    const records=async()=>({projects:(await db.query("select * from public.projects order by id")).rows,
      profiles:(await db.query("select * from public.profiles order by id")).rows,tasks:(await db.query("select * from public.tasks order by id")).rows,
      sprints:(await db.query("select * from public.sprints order by id")).rows,users:(await db.query("select * from auth.users order by id")).rows,
      source:(await db.query("select public.planning_source_version() value")).rows[0].value});
    const queries=[{view:"board",level:"deliverable",filters:{}},{view:"board",level:"initiative",filters:{}},
      {view:"board",level:"epic",filters:{}},{view:"table",filters:{sort:"title",direction:"desc"}},
      {view:"table",structureParentId:"gantt-parent",filters:{sort:"priority",direction:"asc"}},
      {view:"table",filters:{quick:["week"],sort:"priority",direction:"asc"}}];
    const existing=async()=>{
      const results=[];
      for(const query of queries)for(const planOnly of [false,true])results.push((await db.query(
        "select public.planning_deliverable_query_basis('gantt-founder',$1::jsonb,null,0,20,null,$2::timestamptz,$3) value",
        [JSON.stringify(query),evaluatedAt,planOnly])).rows[0].value);
      return results;
    };
    const previousGantt=(await db.query("select public.planning_gantt_selection('gantt-founder',$1::uuid,'{}'::jsonb,$2::timestamptz) value",[userId,evaluatedAt])).rows[0].value;
    const before=await records(),oldDefinitions=await definitions(),oldResults=await existing();
    const oldOwner=(await db.query("select pg_get_userbyid(proowner) owner from pg_proc where oid=$1::regprocedure",[signature])).rows[0].owner;
    expect(oldResults.every(value=>value.status==="ready")).toBe(true);
    await applyMigration(db,resolve("supabase/migrations/20261118091800_planning_gantt_toolbar_counts.sql"));
    expect(await records()).toEqual(before);
    expect(await definitions()).toEqual(oldDefinitions);
    expect(await existing()).toEqual(oldResults);
    const updatedGantt=(await db.query("select public.planning_gantt_selection('gantt-founder',$1::uuid,'{}'::jsonb,$2::timestamptz) value",[userId,evaluatedAt])).rows[0].value;
    expect(updatedGantt.toolbar_counts).toEqual({filtered:7,unfiltered:7});
    const {toolbar_counts: counts,...unchangedGantt}=updatedGantt;
    expect(counts.filtered).toBeGreaterThan(updatedGantt.total);
    expect(unchangedGantt).toEqual(previousGantt);
    const proposed=(await db.query("select public.planning_gantt_selection('gantt-founder',$1::uuid,$2::jsonb,$3::timestamptz) value",[userId,JSON.stringify({query:"proposed"}),evaluatedAt])).rows[0].value;
    expect(proposed.card_ids).toEqual([]);
    expect(proposed.toolbar_counts).toEqual({filtered:1,unfiltered:7});

    const ganttSignature="public.planning_gantt_selection(text,uuid,jsonb,timestamptz)";
    const definition=(await db.query("select pg_get_userbyid(proowner) owner,prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure",[ganttSignature])).rows[0];
    expect(definition).toEqual({owner:oldOwner,prosecdef:false,provolatile:"s",proconfig:['search_path=""']});
    for(const entry of [signature,ganttSignature]) {
      expect((await db.query("select count(*)::int count from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid=$1::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE'",[entry])).rows[0].count).toBe(0);
      for(const role of ["anon","authenticated","service_role"])expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,entry])).rows[0].allowed).toBe(role==="service_role");
    }
    const gantt=async(actor="gantt-founder",user=userId,filters={},at=evaluatedAt)=>(await db.query("select public.planning_gantt_selection($1,$2::uuid,$3::jsonb,$4::timestamptz) value",[actor,user,JSON.stringify(filters),at])).rows[0].value;
    for(const role of ["anon","authenticated","service_role"]) {
      await db.query(`set role ${role}`);
      try {
        if(role!=="service_role")await expect(gantt()).rejects.toMatchObject({code:"42501"});
        else {
          const result=await gantt();expect(result.status).toBe("ready");
          expect(result.card_ids).toEqual(["gantt-done","gantt-other","gantt-open"]);expect(result.total).toBe(3);
          expect(result.source_revision).toBe(before.source);expect(Date.parse(result.evaluated_at)).toBe(Date.parse(evaluatedAt));
          expect(await gantt("unmapped-gantt")).toEqual({status:"forbidden"});
          expect(await gantt("gantt-founder",randomUUID())).toEqual({status:"forbidden"});
          expect(await gantt("gantt-founder",null)).toEqual({status:"forbidden"});
          const currentWeek=await gantt("gantt-founder",userId,{quick:["week"]});
          expect(currentWeek.card_ids).toEqual(result.card_ids);
          expect(Date.parse(currentWeek.valid_until)).toBeGreaterThan(Date.parse(evaluatedAt));
          const nextWeek=await gantt("gantt-founder",userId,{quick:["week"]},currentWeek.valid_until);
          expect(nextWeek.status).toBe("ready");expect(nextWeek.card_ids).toEqual([]);
          expect(nextWeek.source_revision).toBe(currentWeek.source_revision);
          expect(nextWeek.temporal_key).not.toBe(currentWeek.temporal_key);
        }
      } finally { await db.query("reset role"); }
    }
  });
});
