import { createClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";
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

test.each(["current", "role", "unmapped", "revoked", "deadline"] as const)("selected Backlog admits local cursor rejection without privileged dispatch after %s boundary", boundary => withPlanningCredentialDatabase(async f => {
  const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  const scope={view:"backlog" as const,filters:{...DEFAULT_BACKLOG_FILTERS,query:f.prefix},limit:20};
  const permission=await authorizeCredentialAction({credential:{kind:"session-request",request:f.request("founder","/api/backlog-data")},action:"planning.backlog.read"});
  expect(permission.ok).toBe(true);
  if(!permission.ok||!permission.readAuthority)throw new Error("Expected original Selected authority");
  const originalDeadline=permission.readAuthority.deadline;
  const invalidSignature=Buffer.from(JSON.stringify({offset:1,source:"untrusted-source",observedAt:new Date().toISOString(),validUntil:new Date(originalDeadline).toISOString(),deadline:originalDeadline,binding:"0".repeat(64)})).toString("base64url");
  let restoreClock: (()=>void) | undefined;
  try {
    if(boundary==="role")await f.db.query("update public.profiles set platform_role='viewer' where id=$1",[f.actors.founder.profileId]);
    if(boundary==="unmapped")await f.db.query("update public.profiles set auth_user_id=null where id=$1",[f.actors.founder.profileId]);
    if(boundary==="revoked")await f.db.query("delete from auth.sessions where id=$1",[f.actors.founder.sessionId]);
    if(boundary==="deadline") {
      const clock=vi.spyOn(Date,"now").mockReturnValue(originalDeadline);
      restoreClock=()=>clock.mockRestore();
    }
    for(const continuation of ["invalid-json",invalidSignature]) {
      const before=f.observed.length;
      const result=await permission.planning.loadBacklog({...scope,continuation});
      expect(result).toEqual({status:boundary==="current"?"staleContinuation":"forbidden"});
      expect(result).not.toHaveProperty("model");
      const dispatches=f.observed.slice(before);
      expect(dispatches.filter(row=>row.path==="/rest/v1/rpc/planning_backlog_selection"||row.path==="/rest/v1/rpc/planning_board_publication_context")).toEqual([]);
      if(boundary==="current")expect(dispatches.filter(row=>row.path==="/rest/v1/rpc/current_authenticated_profile"&&row.actor==="founder")).toHaveLength(1);
      expect(permission.readAuthority.deadline).toBe(originalDeadline);
    }
    const result=await permission.planning.loadBacklog(scope);
    expect(result.status).toBe(boundary==="current"?"ready":"forbidden");
    if(boundary!=="current")expect(result).not.toHaveProperty("model");
  } finally { restoreClock?.(); }
}),120_000);

test.each(["fresh-profile", "publication-role", "publication-source"] as const)("selected Backlog retains the %s fence around privileged dispatch", boundary => withPlanningCredentialDatabase(async f => {
  const {GET}=await importTestModule("src/app/api/backlog-data/route.ts",{"server-only":{}});
  const scope={view:"backlog",filters:{...DEFAULT_BACKLOG_FILTERS,query:f.prefix},limit:20};
  const transport=globalThis.fetch;
  let profiles=0,changed=false;
  vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
    const request=new Request(input,init),path=new URL(request.url).pathname;
    if(path==="/rest/v1/rpc/current_authenticated_profile") {
      profiles++;
      if(boundary==="fresh-profile"&&profiles===2) {
        await f.db.query("update public.profiles set platform_role='viewer' where id=$1",[f.actors.founder.profileId]);
        changed=true;
      }
    }
    const response=await transport(request);
    if(path==="/rest/v1/rpc/planning_backlog_selection"&&!changed) {
      expect(response.status).toBe(200);
      if(boundary==="publication-role")await f.db.query("update public.profiles set platform_role='viewer' where id=$1",[f.actors.founder.profileId]);
      if(boundary==="publication-source")await f.db.query("update public.tasks set title=title||' changed source' where id=$1",[f.initiativeId]);
      changed=true;
    }
    return response;
  });
  try {
    const response=await GET(f.request("founder",`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(changed).toBe(true);
    expect(response.status).toBe(boundary==="publication-source"?409:403);
    const body=await response.json();expect(body).not.toHaveProperty("model");
    if(boundary==="publication-source")expect(body.code).toBe("stale_continuation");
    expect(f.observed.filter(row=>row.path==="/rest/v1/rpc/planning_backlog_selection")).toHaveLength(boundary==="fresh-profile"?0:1);
    expect(f.observed.filter(row=>row.path==="/rest/v1/rpc/planning_board_publication_context"&&row.actor==="founder")).toHaveLength(boundary==="fresh-profile"?0:1);
  } finally { vi.stubGlobal("fetch",transport); }
}),120_000);

test("selected Backlog retains the original credential environment before privileged dispatch", () => withPlanningCredentialDatabase(async f => {
  const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  const scope={view:"backlog" as const,filters:{...DEFAULT_BACKLOG_FILTERS,query:f.prefix},limit:20};
  const permission=await authorizeCredentialAction({credential:{kind:"session-request",request:f.request("founder","/api/backlog-data")},action:"planning.backlog.read"});
  expect(permission.ok).toBe(true);
  if(!permission.ok||!permission.readAuthority)throw new Error("Expected original Selected environment binding");
  const originalDeadline=permission.readAuthority.deadline,before=f.observed.length;
  try {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","replaced-synthetic-service-key");
    const result=await permission.planning.loadBacklog(scope);
    expect(result).toEqual({status:"unavailable"});
    expect(result).not.toHaveProperty("model");
    expect(f.observed.slice(before).filter(row=>row.path==="/rest/v1/rpc/planning_backlog_selection"||row.path==="/rest/v1/rpc/planning_board_publication_context")).toEqual([]);
    expect(permission.readAuthority.deadline).toBe(originalDeadline);
  } finally { vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY",f.local.SERVICE_ROLE_KEY); }
  const recovered=await permission.planning.loadBacklog(scope);
  expect(recovered.status).toBe("ready");
  expect(permission.readAuthority.deadline).toBe(originalDeadline);
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

test("selected Backlog hydrates bounded references with one fresh pre-RPC admission and no separate data HTTP dispatches", () => withPlanningCredentialDatabase(async f => {
  const query=`${f.prefix} atomic hydration`,sprintId=`${f.prefix}-hydration-sprint`;
  await f.db.query("insert into public.sprints(id,project_id,name,status,start_date,end_date) values($1,'findmydoc-founder-execution','Bounded reference Sprint','planning','2026-11-16','2026-11-29')",[sprintId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,sort_order,approval_status,owner,assignee,created_by,sprint_id)
    select $1||'-atomic-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Bounded hydration Item '||n,$2,'deliverable',$3,'Offen','P2',n,'approved',$4,$4,$5,$6
    from generate_series(1,21) n`,[f.prefix,query,f.initiativeId,f.actors.founder.profileId,f.actors.ceo.profileId,sprintId]);
  const expected=Array.from({length:21},(_,index)=>`${f.prefix}-atomic-${String(index+1).padStart(4,'0')}`),selectedIds=[...expected.slice(0,20),`${f.prefix}-epic`,f.initiativeId];
  const {hydrateBacklogItems}=await importTestModule("src/features/planning-items/server/planning-backlog-read-source.ts",{"server-only":{}});
  const client=createClient(f.local.API_URL,f.local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const reference=await hydrateBacklogItems(client,{authorized:true,actorProfileId:f.actors.founder.profileId},selectedIds);
  expect(reference).not.toBeNull();
  const {GET}=await importTestModule("src/app/api/backlog-data/route.ts",{"server-only":{}});
  const scope={view:"backlog",filters:{...DEFAULT_BACKLOG_FILTERS,query},limit:20};
  const before=f.observed.length;
  const first=await GET(f.request("founder",`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));expect(first.status).toBe(200);const body=await first.json();
  const dispatches=f.observed.slice(before);
  expect(body.model.selection.itemIds).toEqual(expected.slice(0,20));expect(body.model.selection.total).toBe(21);
  expect(new Set(body.model.selection.contextIds)).toEqual(new Set([`${f.prefix}-epic`,f.initiativeId]));
  expect(body.model.items).toEqual(reference!.items);
  const byId=(rows:{id:string}[])=>[...rows].sort((left,right)=>left.id.localeCompare(right.id));
  expect(byId(body.model.people)).toEqual(byId(reference!.people));expect(byId(body.model.sprints)).toEqual(byId(reference!.sprints));
  expect(body.model.items).toHaveLength(22);expect(body.model.sprints.map((row:{id:string})=>row.id)).toEqual([sprintId]);
  expect(body.readActor).toEqual({profileId:f.actors.founder.profileId,platformRole:"founder"});expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  expect(body.model.selection.sourceRevision).toBeTruthy();expect(Date.parse(body.model.selection.validUntil)).toBeGreaterThan(Date.now());
  const next=await GET(f.request("founder",`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify({...scope,continuation:body.model.selection.continuation}))}`));expect(next.status).toBe(200);const second=await next.json();
  expect(second.model.selection.itemIds).toEqual(expected.slice(20));expect(second.model.selection.sourceRevision).toBe(body.model.selection.sourceRevision);
  expect(second.readAuthority.deadline).toBeLessThanOrEqual(body.readAuthority.deadline);
  expect(dispatches.some(row=>row.path==="/rest/v1/rpc/current_authenticated_profile"&&row.actor==="founder")).toBe(true);
  expect(dispatches.filter(row=>["/rest/v1/active_tasks","/rest/v1/profiles","/rest/v1/sprints"].includes(row.path)).map(row=>row.path)).toEqual([]);
  const selectedDispatch = dispatches.findIndex(row=>row.path==="/rest/v1/rpc/planning_backlog_selection");
  expect(selectedDispatch).toBeGreaterThan(-1);
  // Initial session admission remains separate from the fresh guard at the privileged RPC.
  expect(dispatches.slice(0,selectedDispatch).filter(row=>row.path==="/rest/v1/rpc/current_authenticated_profile"&&row.actor==="founder")).toHaveLength(2);
  expect(dispatches.slice(selectedDispatch+1).filter(row=>row.path==="/rest/v1/rpc/planning_board_publication_context"&&row.actor==="founder")).toHaveLength(1);
}),120_000);
