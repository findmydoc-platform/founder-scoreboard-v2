import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
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
    expect(body.model.items.find((row:Task)=>row.id===epicId)).toMatchObject({status:"Erledigt",updatedAt:"2000-01-01T00:00:00+00:00"});
    expect(body.readActor).toEqual({profileId:f.actors.founder.profileId,platformRole:"founder"});expect(body.readAuthority.deadline).toBeLessThanOrEqual(deadline);expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());deadline=body.readAuthority.deadline;
    expect(body.model.taskOmittedFields).toEqual(expect.arrayContaining(["note","evidenceLinks"]));
    ids.push(...selected.itemIds);continuation=selected.continuation||undefined;
    if(!continuation){const last=body.model.items.find((row:Task)=>row.id===lastId);expect(last).toMatchObject({status:"Erledigt",approvalStatus:"proposed",description:"Current root description 1008",strategy:{goal:"Current offpage strategic goal"},detailAvailability:"summary"});}
  }while(continuation);
  expect(ids).toEqual(expected);expect(new Set(ids).size).toBe(1009);
}),120_000);
