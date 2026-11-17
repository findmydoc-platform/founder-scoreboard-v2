import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves version 67 records and existing table selection while constraining Structure children before limits", { timeout: 120000 }, async () => {
 await resetLocalDatabaseTo("20261117022303");
 await withLocalDatabase(async client=>{
  await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic Structure child migration')");
  await client.query("insert into public.profiles(id,name,platform_role) values('structure-founder','Synthetic founder','founder')");
  await client.query("insert into public.tasks(id,project_id,title,task_type,status,owner) values('structure-epic','findmydoc-founder-execution','Epic','epic','Offen','structure-founder')");
  await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,approval_status,owner) values('structure-parent','findmydoc-founder-execution','Parent','initiative','structure-epic','Offen','approved','structure-founder'),('structure-other','findmydoc-founder-execution','Other','initiative','structure-epic','Offen','approved','structure-founder')");
  await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner,sort_order) values('structure-open','findmydoc-founder-execution','Open','deliverable','structure-parent','Offen','P2','approved','structure-founder',1),('structure-done','findmydoc-founder-execution','Done','deliverable','structure-parent','Erledigt','P2','approved','structure-founder',2),('structure-proposed','findmydoc-founder-execution','Proposed','deliverable','structure-parent','Offen','P0','proposed','structure-founder',0),('structure-foreign','findmydoc-founder-execution','Foreign','deliverable','structure-other','Offen','P1','approved','structure-founder',0)");
  const records=async()=>({tasks:(await client.query("select * from public.tasks order by id")).rows,profiles:(await client.query("select * from public.profiles order by id")).rows,projects:(await client.query("select * from public.projects order by id")).rows,sprints:(await client.query("select * from public.sprints order by id")).rows,commitments:(await client.query("select * from public.sprint_commitments order by id")).rows});
  const query={view:"table",level:"deliverable",filters:{sort:"priority",direction:"asc"}};
  const selection=async(input=query,actor="structure-founder")=>(await client.query("select public.planning_deliverable_query_basis($1,$2::jsonb,null,0,20,null,null,false) value",[actor,JSON.stringify(input)])).rows[0].value;
  const before=await records(),old=await selection();
  await applyMigration(client,resolve("supabase/migrations/20261117024037_planning_structure_child_selection.sql"));
  expect(await records()).toEqual(before);const current=await selection();
  for(const field of ["status","source_revision","valid_until","columns","metrics","card_ids","rows"])expect(current[field]).toEqual(old[field]);
  const scoped=await selection({...query,structureParentId:"structure-parent"});expect(scoped.status).toBe("ready");expect(scoped.card_ids).toEqual(["structure-open","structure-done"]);expect(scoped.metrics.total).toBe(2);
  const conflict=await selection({...query,structureParentId:"structure-parent",filters:{...query.filters,initiativeId:"structure-other"}});expect(conflict.card_ids).toEqual([]);expect(conflict.metrics.total).toBe(0);
  expect((await selection({...query,structureParentId:"not-known"})).status).toBe("forbidden");
  const signature="public.planning_deliverable_query_basis(text,jsonb,text,integer,integer,text,timestamptz,boolean)";
  for(const role of ["anon","authenticated","service_role"]){
   expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,signature])).rows[0].allowed).toBe(role==="service_role");
   await client.query(`set role ${role}`);try{if(role!=="service_role")await expect(selection({...query,structureParentId:"structure-parent"})).rejects.toMatchObject({code:"42501"});else expect((await selection({...query,structureParentId:"structure-parent"},"structure-unmapped")).status).toBe("forbidden");}finally{await client.query("reset role");}
  }
 });
});
