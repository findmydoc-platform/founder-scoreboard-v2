import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";
it("preserves version 68 records and Table contracts while adding service-only complete Structure scalar options", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261117024037");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic controls migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('controls-founder','Synthetic founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('controls-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','P2','controls-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status,workstream) values('controls-initiative','findmydoc-founder-execution','Existing Initiative','initiative','controls-epic','Offen','P2','controls-founder','approved','Existing workstream')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('controls-deliverable','findmydoc-founder-execution','Existing Deliverable','deliverable','controls-initiative','Offen','P2','controls-founder','approved')");
    await client.query("insert into public.sprints(id,project_id,name,status) values('controls-sprint','findmydoc-founder-execution','Existing closed Sprint','closed')");
    const records=async()=>({projects:(await client.query("select * from public.projects order by id")).rows,profiles:(await client.query("select * from public.profiles order by id")).rows,tasks:(await client.query("select * from public.tasks order by id")).rows,sprints:(await client.query("select * from public.sprints order by id")).rows,commitments:(await client.query("select * from public.sprint_commitments order by id")).rows});
    const table=async()=>(await client.query(`select public.planning_deliverable_query_basis('controls-founder','{"view":"table","filters":{}}'::jsonb) value`)).rows[0].value;
    const before=await records(),old=await table();expect(old.status).toBe("ready");
    await applyMigration(resolve("supabase/migrations/20261117032638_planning_structure_controls.sql"));
    expect(await records()).toEqual(before);const current=await table();
    for(const key of Object.keys(old).filter(key=>key!=="evaluated_at"))expect(current[key]).toEqual(old[key]);
    const read=async(actor='controls-founder')=>(await client.query("select public.planning_structure_controls($1) value",[actor])).rows[0].value;
    const options=await read();expect(options.status).toBe("ready");
    expect(options.people).toEqual(old.profiles.map(({id,name})=>({id,name})));expect(options.sprints).toEqual(old.sprints.map(({id,name})=>({id,name})));
    expect(options.initiatives).toEqual(old.initiative_options);expect(options.workstreams).toEqual(old.workstreams);expect(options.source_revision).toBe(old.source_revision);
    const signature='public.planning_structure_controls(text)';
    for(const role of ['anon','authenticated','service_role']){
      expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed).toBe(role==='service_role');
      await client.query(`set role ${role}`);
      try{if(role!=='service_role')await expect(read()).rejects.toMatchObject({code:'42501'});else expect(await read('unmapped-controls')).toEqual({status:'forbidden'});}finally{await client.query('reset role');}
    }
  });
});
