import { resolve } from "node:path";
import { expect, it } from "vitest";
import { taskRowColumns } from "../../src/lib/planning-row-types.ts";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";
it("preserves version 70 records and selected receipts while adding only bounded existing hydration fields", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261117081756");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic atomic hydration migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('atomic-founder','Synthetic founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('atomic-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','P2','atomic-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('atomic-parent','findmydoc-founder-execution','Existing Initiative','initiative','atomic-epic','Offen','P2','atomic-founder','approved')");
    await client.query("insert into public.sprints(id,project_id,name,status) values('atomic-sprint','findmydoc-founder-execution','Existing Sprint','planning')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,created_by,approval_status,sprint_id) values('atomic-open','findmydoc-founder-execution','Existing Deliverable','deliverable','atomic-parent','Offen','P2','atomic-founder','atomic-founder','approved','atomic-sprint')");
    await client.query("insert into public.task_dependencies(task_id,note) values('atomic-open','Existing dependency')");
    await client.query("insert into public.task_notes(task_id,note) values('atomic-open','Existing private note')");
    const records=async()=>({projects:(await client.query("select * from public.projects order by id")).rows,profiles:(await client.query("select * from public.profiles order by id")).rows,tasks:(await client.query("select * from public.tasks order by id")).rows,sprints:(await client.query("select * from public.sprints order by id")).rows,commitments:(await client.query("select * from public.sprint_commitments order by id")).rows,dependencies:(await client.query("select * from public.task_dependencies order by id")).rows,notes:(await client.query("select * from public.task_notes order by task_id")).rows});
    const read=async(actor='atomic-founder')=>(await client.query(`select public.planning_backlog_selection($1,'{"level":"deliverable","query":"existing"}'::jsonb,20) value`,[actor])).rows[0].value;
    const before=await records(),old=await read();expect(old.status).toBe('ready');
    await applyMigration(client,resolve('supabase/migrations/20261117095225_planning_backlog_atomic_hydration.sql'));
    expect(await records()).toEqual(before);const current=await read();
    for(const key of Object.keys(old).filter(key=>key!=='observed_at'))expect(current[key]).toEqual(old[key]);
    expect(current.hydrated_items.map(row=>row.id)).toEqual([...old.item_ids,...old.context_ids]);
    for(const row of current.hydrated_items)expect(Object.keys(row).sort()).toEqual([...taskRowColumns,'task_dependencies','task_notes'].sort());
    expect(current.hydrated_items.find(row=>row.id==='atomic-open').task_dependencies).toEqual([{note:'Existing dependency'}]);
    expect(current.hydrated_items.find(row=>row.id==='atomic-open').task_notes).toEqual({note:'Existing private note'});
    expect(current.hydrated_people.map(row=>row.id)).toEqual(['atomic-founder']);
    expect(Object.keys(current.hydrated_people[0]).sort()).toEqual('id,name,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity,profile_color'.split(',').sort());
    expect(current.hydrated_sprints.map(row=>row.id)).toEqual(['atomic-sprint']);
    expect(Object.keys(current.hydrated_sprints[0]).sort()).toEqual('id,name,status,start_date,end_date,review_due_at,score_locked,updated_at'.split(',').sort());
    const signature='public.planning_backlog_selection(text,jsonb,integer,integer,text,timestamptz,timestamptz)';
    for(const role of ['anon','authenticated','service_role']){
      expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed).toBe(role==='service_role');
      await client.query(`set role ${role}`);
      try{if(role!=='service_role')await expect(read()).rejects.toMatchObject({code:'42501'});else expect(await read('unmapped-atomic')).toEqual({status:'forbidden'});}finally{await client.query('reset role');}
    }
  });
});
