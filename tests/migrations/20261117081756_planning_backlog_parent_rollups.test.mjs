import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";
it("preserves version 69 records and selected Backlog contracts while adding bounded service-only Parent progress", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261117032638");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic Parent progress migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('progress-founder','Synthetic founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('progress-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','P2','progress-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('progress-parent','findmydoc-founder-execution','Existing Initiative','initiative','progress-epic','Offen','P2','progress-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('progress-open','findmydoc-founder-execution','Existing proposed Deliverable','deliverable','progress-parent','Offen','P2','progress-founder','proposed'),('progress-done','findmydoc-founder-execution','Existing done Deliverable','deliverable','progress-parent','Erledigt','P2','progress-founder','approved')");
    const records=async()=>({projects:(await client.query("select * from public.projects order by id")).rows,profiles:(await client.query("select * from public.profiles order by id")).rows,tasks:(await client.query("select * from public.tasks order by id")).rows,sprints:(await client.query("select * from public.sprints order by id")).rows,commitments:(await client.query("select * from public.sprint_commitments order by id")).rows});
    const read=async(actor='progress-founder')=>(await client.query(`select public.planning_backlog_selection($1,'{"level":"deliverable","query":"existing"}'::jsonb,20) value`,[actor])).rows[0].value;
    const before=await records(),old=await read();expect(old.status).toBe('ready');
    await applyMigration(client,resolve('supabase/migrations/20261117081756_planning_backlog_parent_rollups.sql'));
    expect(await records()).toEqual(before);const current=await read();
    for(const key of Object.keys(old).filter(key=>key!=='observed_at'))expect(current[key]).toEqual(old[key]);
    expect(current.parent_progress_by_id).toEqual({'progress-parent':{total:2,completed:1,unfinished:1,percentage:50}});
    const signature='public.planning_backlog_selection(text,jsonb,integer,integer,text,timestamptz,timestamptz)';
    for(const role of ['anon','authenticated','service_role']){
      expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed).toBe(role==='service_role');
      await client.query(`set role ${role}`);
      try{if(role!=='service_role')await expect(read()).rejects.toMatchObject({code:'42501'});else expect(await read('unmapped-progress')).toEqual({status:'forbidden'});}finally{await client.query('reset role');}
    }
  });
});
