import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { buildPlanningTaskTableViewModel } from "@/features/planning/model/planning-task-table-view-model";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";
import { isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import type { Task } from "@/lib/types";

test("Structure pages all Initiative roots including proposed and completed records with bounded current header context", () => withPlanningCredentialDatabase(async f => {
  const epicId=`${f.prefix}-epic`,lastId=`${f.prefix}-structure-initiative-1008`;
  await f.db.query("update public.tasks set sort_order=0 where id=$1",[f.initiativeId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,sort_order,approval_status,owner)
    select $1||'-structure-initiative-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Structure Initiative '||n,'Current root description '||n,'initiative',$2,case when n=1008 then 'Erledigt' else 'Offen' end,'P2',n,case when n%2=0 then 'proposed' else 'approved' end,$3 from generate_series(1,1008) n`,[f.prefix,epicId,f.actors.founder.profileId]);
  await f.db.query("insert into public.planning_item_strategy(task_id,goal) values($1,'Current offpage strategic goal')",[lastId]);
  await f.db.query("update public.tasks set status='Erledigt',updated_at='2000-01-01T00:00:00Z' where id=$1",[epicId]);
  const {loadPlanningWorkspaceModel}=await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts",{"server-only":{}});
  const client=createClient(f.local.API_URL,f.local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const reference=await loadPlanningWorkspaceModel(client,{authorized:true,actorProfileId:f.actors.founder.profileId,query:{view:"complete"}});
  expect(reference.status).toBe("ready");if(reference.status!=="ready")throw new Error("Complete Structure reference was unavailable");
  const expected=[f.initiativeId,...Array.from({length:1008},(_,i)=>`${f.prefix}-structure-initiative-${String(i+1).padStart(4,"0")}`)];
  expect(reference.model.items.filter((row:Task)=>row.taskType==="initiative").map((row:Task)=>row.id)).toEqual(expected);
  expect(reference.model.items.find((row:Task)=>row.id===lastId)).toMatchObject({status:"Erledigt",approvalStatus:"proposed",description:"Current root description 1008",strategy:{goal:"Current offpage strategic goal"}});
  const {GET}=await importTestModule("src/app/api/planning-board-data/route.ts",{"server-only":{}});
  let continuation:string|undefined,deadline=Infinity;const ids:string[]=[];
  do{
    const query={view:"structure",area:"roots",limit:100,...(continuation?{continuation}:{})};
    const response=await GET(f.request("founder",`/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));expect(response.status).toBe(200);
    const body=await response.json();expect(body.model).toHaveProperty("structure");const selected=body.model.structure;
    expect(selected.query).toEqual(query);expect(selected.total).toBe(1009);expect(selected.contextIds).toEqual([epicId]);expect(selected.itemIds.length).toBeLessThanOrEqual(100);expect(body.model.items.length).toBeLessThanOrEqual(101);
    const ancestor=body.model.items.find((row:Task)=>row.id===epicId);expect(ancestor.status).toBe("Erledigt");expect(Date.parse(ancestor.updatedAt)).toBe(Date.UTC(2000,0,1));
    expect(body.readActor).toEqual({profileId:f.actors.founder.profileId,platformRole:"founder"});expect(body.readAuthority.deadline).toBeLessThanOrEqual(deadline);expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());deadline=body.readAuthority.deadline;
    expect(body.model.taskOmittedFields).toEqual(expect.arrayContaining(["note","evidenceLinks"]));
    ids.push(...selected.itemIds);continuation=selected.continuation||undefined;
    if(!continuation){const last=body.model.items.find((row:Task)=>row.id===lastId);expect(last).toMatchObject({status:"Erledigt",approvalStatus:"proposed",description:"Current root description 1008",strategy:{goal:"Current offpage strategic goal"},detailAvailability:"summary"});}
  }while(continuation);
  expect(ids).toEqual(expected);expect(new Set(ids).size).toBe(1009);
  const scope={view:"structure",area:"roots",limit:20};
  for(const actor of ["ceo","deputy","founder","viewer","administrator"] as const){
    const response=await GET(f.request(actor,`/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));expect(response.status).toBe(200);
    const body=await response.json();expect(body.model.structure.itemIds).toEqual(expected.slice(0,20));expect(body.readActor.profileId).toBe(f.actors[actor].profileId);
  }
  expect((await GET(f.request("unmapped",`/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`))).status).toBe(403);
  for(const actor of ["founder","unmapped","anonymous"] as const){
    const response=await f.rpc("planning_structure_selection",{p_actor_profile_id:f.actors.founder.profileId,p_limit:20,p_offset:0,p_source_revision:null,p_evaluated_at:null,p_valid_until:null},actor);
    expect(response.status).toBe(actor==="anonymous"?401:403);
  }
}),120_000);


test("expanded Structure selects the complete approved parent class with legacy filters and fixed priority order including completed rows", () => withPlanningCredentialDatabase(async f => {
  const text=`${f.prefix} Structure child description`,other=`${f.prefix}-other-structure-parent`;
  await f.db.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner) values($1,'findmydoc-founder-execution','Other Structure root','initiative',$2,'Offen','P2','approved',$3)",[other,`${f.prefix}-epic`,f.actors.founder.profileId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,description,definition_of_done,task_type,parent_task_id,status,priority,sort_order,approval_status,owner,assignee,workstream)
    select $1||'-structure-child-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Structure Delivery '||n,$2,case when n=1008 then 'Unique final definition' else '' end,'deliverable',$3,case when n=1008 then 'Erledigt' else 'Offen' end,'P2',n,'approved',$4,$4,'Structure Workstream' from generate_series(1,1008) n`,[f.prefix,text,f.initiativeId,f.actors.founder.profileId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,sort_order,approval_status,owner,assignee)
    values($1,'findmydoc-founder-execution','Unapproved match',$4,'deliverable',$3,'Offen','P0',0,'proposed',$5,$5),
    ($2,'findmydoc-founder-execution','Foreign parent match',$4,'deliverable',$6,'Offen','P0',0,'approved',$5,$5)`,[`${f.prefix}-structure-proposed`,`${f.prefix}-structure-foreign`,f.initiativeId,text,f.actors.founder.profileId,other]);
  const {loadPlanningWorkspaceModel}=await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts",{"server-only":{}});
  const client=createClient(f.local.API_URL,f.local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const reference=await loadPlanningWorkspaceModel(client,{authorized:true,actorProfileId:f.actors.founder.profileId,query:{view:"complete"}});
  expect(reference.status).toBe("ready");if(reference.status!=="ready")throw new Error("Complete Structure child reference was unavailable");
  const data=planningWorkspaceModelToPlanningShellState(reference.model),filters={...DEFAULT_PLANNING_FILTERS,query:text,assignee:f.actors.founder.profileId,sort:"title",direction:"desc" as const};
  const selected=buildPlanningTaskTableViewModel({data,filters,currentProfile:data.profiles.find(profile=>profile.id===f.actors.founder.profileId)!,includeAssignedSubIssueParents:false});
  const expected=Array.from({length:1008},(_,i)=>`${f.prefix}-structure-child-${String(i+1).padStart(4,"0")}`);
  expect(selected.visibleTasks.filter(row=>row.parentTaskId===f.initiativeId&&row.taskType==="deliverable"&&isTaskPlanningActive(row)).map(row=>row.id)).toEqual(expected);
  const {GET}=await importTestModule("src/app/api/planning-board-data/route.ts",{"server-only":{}});
  const read=(input=filters,continuation?:string)=>GET(f.request("founder",`/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({view:"structure",area:"children",parentId:f.initiativeId,filters:input,limit:100,continuation}))}`));
  const ids:string[]=[];let continuation:string|undefined,deadline=Infinity;
  do{
    const response=await read(filters,continuation);expect(response.status).toBe(200);const body=await response.json(),page=body.model.structure;
    expect(page.total).toBe(1008);expect(page.query.parentId).toBe(f.initiativeId);expect(page.contextIds).toEqual(expect.arrayContaining([f.initiativeId,`${f.prefix}-epic`]));
    expect(body.model.items.length).toBeLessThanOrEqual(102);expect(body.readAuthority.deadline).toBeLessThanOrEqual(deadline);expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());deadline=body.readAuthority.deadline;
    ids.push(...page.itemIds);continuation=page.continuation||undefined;
    if(!continuation)expect(body.model.items.find((row:Task)=>row.id===expected[1007]).status).toBe("Erledigt");
  }while(continuation);
  expect(ids).toEqual(expected);
  const definition=await read({...filters,query:"Unique final definition"});expect(definition.status).toBe(200);expect((await definition.json()).model.structure.itemIds).toEqual([expected[1007]]);
  const conflict=await read({...filters,initiativeId:other});expect(conflict.status).toBe(200);const empty=(await conflict.json()).model.structure;expect(empty.total).toBe(0);expect(empty.itemIds).toEqual([]);
}),120_000);
