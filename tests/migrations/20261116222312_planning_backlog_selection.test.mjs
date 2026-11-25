import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves version 59 records and existing context while adding service-only selected Backlog reads", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261116192711");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic selected Backlog migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('backlog-selection-founder','Synthetic founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('backlog-selection-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','P2','backlog-selection-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('backlog-selection-initiative','findmydoc-founder-execution','Existing Initiative','initiative','backlog-selection-epic','Offen','P2','backlog-selection-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('backlog-selection-deliverable','findmydoc-founder-execution','Existing Deliverable','deliverable','backlog-selection-initiative','Offen','P2','backlog-selection-founder','approved')");
    const records = async () => ({ projects:(await client.query("select * from public.projects order by id")).rows,
      profiles:(await client.query("select * from public.profiles order by id")).rows,tasks:(await client.query("select * from public.tasks order by id")).rows,
      sprints:(await client.query("select * from public.sprints order by id")).rows,commitments:(await client.query("select * from public.sprint_commitments order by id")).rows });
    const context = async () => (await client.query("select public.planning_detail_source('backlog-selection-deliverable','target') value")).rows[0].value;
    const candidates = async () => (await client.query("select public.planning_item_candidates('backlog-selection-founder','initiative','',20) value")).rows[0].value;
    const before=await records(),oldContext=await context(),oldCandidates=await candidates();
    expect(before.tasks).toHaveLength(3);
    await applyMigration(client,resolve("supabase/migrations/20261116222312_planning_backlog_selection.sql"));
    expect(await records()).toEqual(before);
    const nextContext=await context(),nextCandidates=await candidates();
    for(const key of ["target_id","ancestor_ids","source_revision","valid_until"])expect(nextContext[key]).toEqual(oldContext[key]);
    for(const key of ["items","total","source_revision","valid_until"])expect(nextCandidates[key]).toEqual(oldCandidates[key]);
    const signature="public.planning_backlog_selection(text,jsonb,integer,integer,text,timestamptz,timestamptz)";
    const filters={level:"deliverable",query:"",scope:"all",sort:"rank",direction:"asc"};
    const read=async actor=>(await client.query("select public.planning_backlog_selection($1,$2::jsonb,20) value",[actor,JSON.stringify(filters)])).rows[0].value;
    for(const role of ["anon","authenticated","service_role"]){
      expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed).toBe(role==="service_role");
      await client.query(`set role ${role}`);
      try {
        if(role!=="service_role")await expect(read("backlog-selection-founder")).rejects.toMatchObject({code:"42501"});
        else {
          const page=await read("backlog-selection-founder");expect(page.status).toBe("ready");expect(page.item_ids).toEqual(["backlog-selection-deliverable"]);
          expect(page.total).toBe(1);expect(page.rank_by_id).toEqual({"backlog-selection-deliverable":1});
          expect([...page.context_ids].sort()).toEqual(["backlog-selection-epic","backlog-selection-initiative"]);
          expect(await read("backlog-selection-unmapped")).toEqual({status:"forbidden"});
        }
      }finally{await client.query("reset role");}
    }
  });
});
