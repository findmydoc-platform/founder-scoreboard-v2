import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { buildBacklogOverviewViewModel, buildBacklogTableViewModel, DEFAULT_BACKLOG_FILTERS } from "@/features/backlog/model/backlog-view-model";

test("selected Backlog searches the full authorized description scope before paging while preserving global rank and completed context", () => withPlanningCredentialDatabase(async f => {
  const query = `${f.prefix} 50%_Ä backlog`, epicId = `${f.prefix}-epic`;
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,sort_order,approval_status,owner,assignee)
    select $1||'-selected-deliverable-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Selected Backlog Item '||n,$2,'deliverable',$3,'Offen','P2',n*2,'approved',$4,$4
    from generate_series(1,1008) n`, [f.prefix,query,f.initiativeId,f.actors.founder.profileId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,sort_order,approval_status,owner)
    values($1,'findmydoc-founder-execution','Unmatched rank context','Different description','deliverable',$3,'Offen','P2',1,'approved',$4),
    ($2,'findmydoc-founder-execution','Completed matching history',$5,'deliverable',$3,'Erledigt','P2',0,'approved',$4)`, [`${f.prefix}-rank-decoy`,`${f.prefix}-completed-match`,f.initiativeId,f.actors.founder.profileId,query]);
  // Context completion occurs after its descendants are created; no parent-lock bypass.
  await f.db.query("update public.tasks set status='Erledigt',updated_at='2000-01-01T00:00:00Z' where id=$1", [epicId]);
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", {"server-only":{}});
  const client = createClient(f.local.API_URL,f.local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const reference = await loadPlanningWorkspaceModel(client,{authorized:true,actorProfileId:f.actors.founder.profileId,query:{view:"complete"}});
  expect(reference.status).toBe("ready");if(reference.status!=="ready")throw new Error("Complete Backlog reference was unavailable");
  const filters = {...DEFAULT_BACKLOG_FILTERS,query};
  const full = buildBacklogTableViewModel({revision:reference.model.revision,items:reference.model.items,people:reference.model.people,sprints:reference.model.sprints,commitments:[],coverage:{items:"complete",people:"complete",sprints:"complete",commitments:"complete"}},filters);
  const expected=Array.from({length:1008},(_,i)=>`${f.prefix}-selected-deliverable-${String(i+1).padStart(4,"0")}`);
  expect(full.visibleItems.map(item=>item.task.id)).toEqual(expected);
  const ranks=Object.fromEntries(full.allItems.map(item=>[item.task.id,item.rank]));
  const {GET}=await importTestModule("src/app/api/backlog-data/route.ts",{"server-only":{}});
  const read=(input=filters,continuation?:string)=>GET(f.request("founder",`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify({view:"backlog",filters:input,limit:20,continuation}))}`));
  const first=await read();expect(first.status).toBe(200);const body=await first.json();
  expect(body.model).toHaveProperty("selection");
  const selected=body.model.selection;
  expect(selected.itemIds).toEqual(expected.slice(0,20));expect(selected.total).toBe(1008);expect(selected.coverage).toBe("partial");
  expect(selected.rankById).toEqual(Object.fromEntries(expected.slice(0,20).map(id=>[id,ranks[id]])));
  expect(selected.contextIds).toEqual(expect.arrayContaining([epicId,f.initiativeId]));
  expect(body.model.items.filter((item:{taskType:string})=>item.taskType==="deliverable").map((item:{id:string})=>item.id)).toEqual(expected.slice(0,20));
  const completedContext=body.model.items.find((item:{id:string})=>item.id===epicId);
  expect(completedContext.status).toBe("Erledigt");expect(Date.parse(completedContext.updatedAt)).toBe(Date.UTC(2000,0,1));
  expect(body.model.items).toHaveLength(22);
  expect(body.readActor).toEqual({profileId:f.actors.founder.profileId,platformRole:"founder"});expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  expect(selected.sourceRevision).toBeTruthy();expect(Date.parse(selected.validUntil)).toBeGreaterThan(Date.now());
  const next=await read(filters,selected.continuation);expect(next.status).toBe(200);const second=await next.json();
  expect(second.model.selection.itemIds).toEqual(expected.slice(20,40));expect(second.model.selection.sourceRevision).toBe(selected.sourceRevision);
  expect(second.readAuthority.deadline).toBeLessThanOrEqual(body.readAuthority.deadline);
  expect((await read({...filters,query:query+" changed"},selected.continuation)).status).toBe(409);
}),120_000);

test("selected Backlog retains mapped reader roles and denies unmapped or direct user selection", () => withPlanningCredentialDatabase(async f => {
  const {GET}=await importTestModule("src/app/api/backlog-data/route.ts",{"server-only":{}});
  const scope={view:"backlog",filters:{...DEFAULT_BACKLOG_FILTERS,query:f.prefix},limit:20};
  for(const actor of ["ceo","deputy","founder","viewer","administrator"] as const){
    const response=await GET(f.request(actor,`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));expect(response.status).toBe(200);
    const body=await response.json();expect(body.model.selection.itemIds).toEqual([]);expect(body.model.selection.total).toBe(0);
    expect(body.readActor).toEqual({profileId:f.actors[actor].profileId,platformRole:actor==="administrator"?"founder":actor});expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  }
  const denied=await GET(f.request("unmapped",`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));expect(denied.status).toBe(403);expect(await denied.json()).not.toHaveProperty("model");
  for(const actor of ["founder","unmapped","anonymous"] as const){
    const response=await f.rpc("planning_backlog_selection",{p_actor_profile_id:f.actors.founder.profileId,p_filters:scope.filters,p_limit:20},actor);
    expect(response.status).toBe(actor==="anonymous"?401:403);
  }
}),120_000);


test("selected Initiative Backlog searches beyond 1000 rows and includes completed membership before paging", () => withPlanningCredentialDatabase(async f => {
  const query = `${f.prefix} strategic description`, epicId = `${f.prefix}-epic`;
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,sort_order,approval_status,owner,assignee)
    select $1||'-selected-initiative-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Selected Initiative '||lpad(n::text,4,'0'),$2,'initiative',$3,'Offen','P2',n,'approved',$4,$4
    from generate_series(1,1008) n`, [f.prefix,query,epicId,f.actors.founder.profileId]);
  await f.db.query("update public.tasks set status='Erledigt' where id=$1", [`${f.prefix}-selected-initiative-1008`]);
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", {"server-only":{}});
  const client = createClient(f.local.API_URL,f.local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const reference = await loadPlanningWorkspaceModel(client,{authorized:true,actorProfileId:f.actors.founder.profileId,query:{view:"complete"}});
  expect(reference.status).toBe("ready");if(reference.status!=="ready")throw new Error("Complete strategic Backlog reference was unavailable");
  const filters = {...DEFAULT_BACKLOG_FILTERS,level:"initiative" as const,query,epic:epicId};
  const full = buildBacklogOverviewViewModel({revision:reference.model.revision,items:reference.model.items,people:reference.model.people,sprints:reference.model.sprints,commitments:[],coverage:{items:"complete",people:"complete",sprints:"complete",commitments:"complete"}},filters,false);
  const expected=Array.from({length:1008},(_,i)=>`${f.prefix}-selected-initiative-${String(i+1).padStart(4,"0")}`);
  expect(full.visibleLevelTasks.map(item=>item.id)).toEqual(expected);
  const {GET}=await importTestModule("src/app/api/backlog-data/route.ts",{"server-only":{}});
  const read=(continuation?:string)=>GET(f.request("founder",`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify({view:"backlog",filters,limit:100,continuation}))}`));
  const ids:string[]=[];let continuation:string|undefined,deadline=Number.POSITIVE_INFINITY,source:string|undefined;
  do {
    const response=await read(continuation);expect(response.status).toBe(200);const body=await response.json(),selection=body.model.selection;
    expect(selection.total).toBe(1008);expect(body.readActor).toEqual({profileId:f.actors.founder.profileId,platformRole:"founder"});
    expect(body.readAuthority.deadline).toBeLessThanOrEqual(deadline);expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());deadline=body.readAuthority.deadline;
    if(source)expect(selection.sourceRevision).toBe(source);source=selection.sourceRevision;
    expect(selection.contextIds).toContain(epicId);expect(body.model.items.filter((item:{taskType:string})=>item.taskType==="initiative").map((item:{id:string})=>item.id)).toEqual(selection.itemIds);
    ids.push(...selection.itemIds);continuation=selection.continuation||undefined;
    if(!continuation)expect(body.model.items.find((item:{id:string})=>item.id===expected[1007]).status).toBe("Erledigt");
  } while(continuation);
  expect(ids).toEqual(expected);expect(new Set(ids).size).toBe(1008);
  for(const actor of ["ceo","deputy","founder","viewer","administrator"] as const){
    const response=await GET(f.request(actor,`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify({view:"backlog",filters,limit:20}))}`));expect(response.status).toBe(200);
    const body=await response.json();expect(body.model.selection.itemIds).toEqual(expected.slice(0,20));expect(body.readActor.profileId).toBe(f.actors[actor].profileId);
  }
  expect((await GET(f.request("unmapped",`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify({view:"backlog",filters,limit:20}))}`))).status).toBe(403);
  for(const actor of ["founder","unmapped","anonymous"] as const){
    const response=await f.rpc("planning_backlog_selection",{p_actor_profile_id:f.actors.founder.profileId,p_filters:filters,p_limit:20,p_offset:0,p_source_revision:null,p_evaluated_at:null,p_valid_until:null},actor);
    expect(response.status).toBe(actor==="anonymous"?401:403);
  }
}),120_000);

test("filtered Backlog returns exact bounded Parent progress without hydrating its off-page Children", () => withPlanningCredentialDatabase(async f => {
  const query = `${f.prefix} parent progress literal`;
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,sort_order,approval_status,owner,assignee)
    select $1||'-progress-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Progress Item '||n,$2,'deliverable',$3,'Offen','P2',n,
      case when n=1008 then 'proposed' else 'approved' end,$4,$4 from generate_series(1,1008) n`, [f.prefix,query,f.initiativeId,f.actors.founder.profileId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,approval_status,owner)
    values($1,'findmydoc-founder-execution','Completed progress context','Unmatched description','deliverable',$2,'Erledigt','P2','approved',$3)`, [`${f.prefix}-progress-completed`,f.initiativeId,f.actors.founder.profileId]);
  const {GET:detail}=await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts",{"server-only":{}});
  const previous=await detail(f.request("founder",`/api/tasks/${f.initiativeId}/detail-data?area=children`),{params:Promise.resolve({id:f.initiativeId})});
  expect(previous.status).toBe(200);const prior=await previous.json();
  expect(prior.taskDetail.childProgress).toEqual({total:1009,completed:1,unfinished:1008,percentage:0});
  const {GET}=await importTestModule("src/app/api/backlog-data/route.ts",{"server-only":{}});
  const scope={view:"backlog",filters:{...DEFAULT_BACKLOG_FILTERS,query},limit:20};
  const response=await GET(f.request("founder",`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
  expect(response.status).toBe(200);const body=await response.json();
  const expected=Array.from({length:20},(_,index)=>`${f.prefix}-progress-${String(index+1).padStart(4,"0")}`);
  expect(body.model.selection.itemIds).toEqual(expected);expect(body.model.selection.total).toBe(1008);
  expect(body.model.selection.parentProgressById).toEqual({[f.initiativeId]:prior.taskDetail.childProgress});
  expect(body.model.items.filter((row:{taskType:string})=>row.taskType==="deliverable").map((row:{id:string})=>row.id)).toEqual(expected);
  expect(body.model.items).toHaveLength(22);expect(body.model.selection.contextIds).toContain(f.initiativeId);
  expect(body.readActor).toEqual({profileId:f.actors.founder.profileId,platformRole:"founder"});
  expect(body.model.selection.sourceRevision).toBeTruthy();expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
}),120_000);
