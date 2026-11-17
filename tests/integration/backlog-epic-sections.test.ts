import type { Task } from "@/lib/types";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { buildBacklogOverviewViewModel, DEFAULT_BACKLOG_FILTERS } from "@/features/backlog/model/backlog-view-model";

test("Epic Backlog pages its filtered primary class independently from unfiltered orphan sections including completed rows", () => withPlanningCredentialDatabase(async f => {
  const query=`${f.prefix} Epic-only description`;
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,status,priority,sort_order,approval_status,owner)
    select $1||'-selected-epic-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Selected Epic '||lpad(n::text,4,'0'),$2,'epic','Offen','P2',n,'approved',$3
    from generate_series(1,1008) n`,[f.prefix,query,f.actors.founder.profileId]);
  for(const kind of ["initiative","deliverable"]){
    await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,status,priority,sort_order,approval_status,owner)
      values($1,'findmydoc-founder-execution','Open orphan','Unmatched orphan description',$3,'Offen','P3',1,$5,$4),
      ($2,'findmydoc-founder-execution','Completed orphan','Unmatched orphan description',$3,'Erledigt','P3',2,$5,$4)`,[`${f.prefix}-orphan-${kind}-open`,`${f.prefix}-orphan-${kind}-done`,kind,f.actors.founder.profileId,kind==="deliverable"?"proposed":"approved"]);
  }
  const {loadPlanningWorkspaceModel}=await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts",{"server-only":{}});
  const client=createClient(f.local.API_URL,f.local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const reference=await loadPlanningWorkspaceModel(client,{authorized:true,actorProfileId:f.actors.founder.profileId,query:{view:"complete"}});
  expect(reference.status).toBe("ready");if(reference.status!=="ready")throw new Error("Complete Epic section reference was unavailable");
  const filters={...DEFAULT_BACKLOG_FILTERS,level:"epic" as const,query,status:"Offen"};
  const model={revision:reference.model.revision,items:reference.model.items,people:reference.model.people,sprints:reference.model.sprints,commitments:[],coverage:{items:"complete" as const,people:"complete" as const,sprints:"complete" as const,commitments:"complete" as const}};
  const expected=Array.from({length:1008},(_,i)=>`${f.prefix}-selected-epic-${String(i+1).padStart(4,"0")}`);
  expect(buildBacklogOverviewViewModel(model,filters,false).visibleLevelTasks.map(row=>row.id)).toEqual(expected);
  expect(buildBacklogOverviewViewModel(model,{...filters,priority:"P2"},false).visibleLevelTasks).toEqual([]);
  const orphans=Object.fromEntries(["initiative","deliverable"].map(kind=>[kind,reference.model.items.filter((row:Task)=>row.taskType===kind&&!row.parentTaskId).map((row:Task)=>row.id)]));
  for(const kind of ["initiative","deliverable"])expect(orphans[kind]).toEqual([`${f.prefix}-orphan-${kind}-open`,`${f.prefix}-orphan-${kind}-done`]);
  const {GET}=await importTestModule("src/app/api/backlog-data/route.ts",{"server-only":{}});
  const read=(section?:string,continuation?:string,actor:"founder"|"unmapped"="founder",inputFilters=filters)=>GET(f.request(actor,`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify({view:"backlog",filters:inputFilters,section,limit:100,continuation}))}`));
  let continuation:string|undefined,deadline=Infinity;const ids:string[]=[];
  do {
    const response=await read(undefined,continuation);expect(response.status).toBe(200);const body=await response.json(),selection=body.model.selection;
    expect(selection.total).toBe(1008);expect(selection.contextIds).toEqual([]);expect(selection.query.filters.level).toBe("epic");
    expect(body.readAuthority.deadline).toBeLessThanOrEqual(deadline);expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());deadline=body.readAuthority.deadline;
    ids.push(...selection.itemIds);continuation=selection.continuation||undefined;
  } while(continuation);
  expect(ids).toEqual(expected);
  for(const [section,kind] of [["orphanInitiatives","initiative"],["orphanDeliverables","deliverable"]] as const){
    const response=await read(section);expect(response.status).toBe(200);const body=await response.json(),selection=body.model.selection;
    expect(selection.itemIds).toEqual(orphans[kind]);expect(selection.total).toBe(2);expect(selection.contextIds).toEqual([]);expect(selection.coverage).toBe("complete");
    expect(selection.query.section).toBe(section);expect(selection.query.filters).toEqual({...DEFAULT_BACKLOG_FILTERS,level:"epic"});
    expect(body.model.items.find((row:{id:string})=>row.id===`${f.prefix}-orphan-${kind}-done`).status).toBe("Erledigt");
    expect(body.readActor.profileId).toBe(f.actors.founder.profileId);expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
    const filtered=await read(section,undefined,"founder",{...filters,priority:"P2"});expect(filtered.status).toBe(200);expect((await filtered.json()).model.selection.itemIds).toEqual(orphans[kind]);
    expect((await read(section,undefined,"unmapped")).status).toBe(403);
  }
}),120_000);
