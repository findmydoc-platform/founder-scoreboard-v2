import { createClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("Relationship discovery excludes its bound source and Sub-Issues before paging and preserves effective assignee labels", () => withPlanningCredentialDatabase(async f => {
  const title = `${f.prefix} 50%_Ä relationship`, ownerLabel = "Synthetic owner fallback", assigneeLabel = "Synthetic assigned reader";
  await f.db.query("update public.profiles set name=case when id=$1 then $3 else $4 end where id=any($2)", [f.actors.founder.profileId, [f.actors.founder.profileId,f.actors.viewer.profileId], ownerLabel, assigneeLabel]);
  await f.db.query("update public.tasks set title=$1,sort_order=-2 where id=$2", [`${title} self`,f.initiativeId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,sort_order,approval_status,parent_task_id,owner,assignee)
    select $1||'-relationship-choice-'||lpad(n::text,4,'0'),'findmydoc-founder-execution',$2||' '||n,'deliverable','Offen','P2',n,'approved',$3,$4,
      case when n=1008 then $5 else null end from generate_series(1,1008) n`, [f.prefix,title,f.initiativeId,f.actors.founder.profileId,f.actors.viewer.profileId]);
  await f.db.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,sort_order,owner,assignee) values($1,'findmydoc-founder-execution',$2,'sub_issue',$3,'Offen','P2',-1,$4,$4)", [`${f.prefix}-excluded-sub-issue`,`${title} child`,`${f.prefix}-relationship-choice-0001`,f.actors.founder.profileId]);
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL,f.local.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  const reference = await loadPlanningWorkspaceModel(client,{authorized:true,actorProfileId:f.actors.founder.profileId,query:{view:"complete"}});
  expect(reference.status).toBe("ready"); if(reference.status!=="ready") throw new Error("Complete relationship reference was unavailable");
  const expected = Array.from({length:1008},(_,i)=>`${f.prefix}-relationship-choice-${String(i+1).padStart(4,"0")}`);
  expect(reference.model.items.filter((item:{id:string;taskType:string;title:string})=>item.taskType!=="sub_issue"&&item.id!==f.initiativeId&&item.title.toLocaleLowerCase("de").includes(title.toLocaleLowerCase("de"))).map((item:{id:string})=>item.id)).toEqual(expected);
  const { GET }=await importTestModule("src/app/api/planning-board-data/route.ts",{"server-only":{}});
  const read=(sourceId:string|null,query=title,continuation?:string)=>GET(f.request("founder",`/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({view:"candidates",kind:"relationship",sourceId,query,limit:100,continuation}))}`));
  const before=f.observed.length;
  const first=await read(f.initiativeId);expect(first.status).toBe(200);const body=await first.json();
  expect(body.candidates.items.map((item:{id:string})=>item.id)).toEqual(expected.slice(0,100));expect(body.candidates.total).toBe(1008);
  expect(body.candidates.items.every((item:{assigneeLabel:string})=>item.assigneeLabel===ownerLabel)).toBe(true);
  const second=await read(f.initiativeId,title,body.candidates.continuation);expect(second.status).toBe(200);const next=await second.json();
  expect(next.candidates.items.map((item:{id:string})=>item.id)).toEqual(expected.slice(100,200));expect(next.readAuthority.deadline).toBeLessThanOrEqual(body.readAuthority.deadline);
  expect((await read(null,title,body.candidates.continuation)).status).toBe(409);
  expect((await read(expected[0],title,body.candidates.continuation)).status).toBe(409);
  const sparse=await read(f.initiativeId,`${title} 1008`);expect(sparse.status).toBe(200);
  expect((await sparse.json()).candidates.items).toEqual([expect.objectContaining({id:expected[1007],assigneeLabel})]);
  const creation=await read(null);expect(creation.status).toBe(200);const createBody=await creation.json();
  expect(createBody.candidates.total).toBe(1009);expect(createBody.candidates.items[0].id).toBe(f.initiativeId);
  expect(f.observed.slice(before).some(entry=>/\/(active_tasks|tasks)$/.test(entry.path))).toBe(false);
}),120_000);

test("Relationship discovery retains all mapped reader roles and denies unmapped or direct user RPC access", () => withPlanningCredentialDatabase(async f => {
  await f.db.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values($1,'findmydoc-founder-execution',$2,'deliverable',$3,'Offen','P2',$4,'proposed')", [`${f.prefix}-permitted-deliverable`, `${f.prefix} permitted Deliverable`, f.initiativeId, f.actors.founder.profileId]);
  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
  const scope = { view: "candidates", kind: "relationship", sourceId: f.initiativeId, query: f.prefix, limit: 20 };
  for (const actor of ["ceo", "deputy", "founder", "viewer", "administrator"] as const) {
    const response = await GET(f.request(actor, `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(response.status).toBe(200);
    const body = await response.json(); expect(body.candidates.items.map((item: { id: string }) => item.id)).toEqual([`${f.prefix}-permitted-deliverable`]);
    expect(body.readActor).toEqual({ profileId: f.actors[actor].profileId, platformRole: actor === "administrator" ? "founder" : actor });
    expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  }
  const denied = await GET(f.request("unmapped", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
  expect(denied.status).toBe(403); expect(await denied.json()).not.toHaveProperty("candidates");
  const invalidSource = await GET(f.request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({ ...scope, sourceId: `${f.prefix}-missing-source` }))}`));
  expect(invalidSource.status).toBe(403); expect(await invalidSource.json()).not.toHaveProperty("candidates");
  for (const actor of ["founder", "unmapped", "anonymous"] as const) {
    const response = await f.rpc("planning_item_candidates", { p_actor_profile_id: f.actors.founder.profileId, p_kind: "relationship", p_source_id: f.initiativeId, p_query: "", p_limit: 20, p_offset: 0, p_source_revision: null, p_evaluated_at: null, p_valid_until: null }, actor);
    expect(response.status).toBe(actor === "anonymous" ? 401 : 403);
  }
}), 120_000);

test("stored relationship endpoints use one bounded identity batch independently of candidate membership", () => withPlanningCredentialDatabase(async f => {
  const source = `${f.prefix}-context-source`, endpoints = [`${f.prefix}-context-left`, `${f.prefix}-context-right`];
  for (const [index,id] of [source,...endpoints].entries()) await f.db.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values($1,'findmydoc-founder-execution',$2,'deliverable',$3,'Offen','P2',$4,'approved')", [id, `Stored endpoint ${index}`, f.initiativeId, f.actors.founder.profileId]);
  await f.db.query("insert into public.task_relationship_edges(task_id,related_task_id,relation_type,note) values($1,$2,'blocked_by','Outgoing stored note'),($3,$1,'blocked_by','Incoming stored note')", [source,...endpoints]);
  const original = globalThis.fetch, batches: string[][] = [];
  vi.stubGlobal("fetch", async (input:RequestInfo|URL,init?:RequestInit)=>{
    const request = new Request(input,init),url = new URL(request.url);
    if(url.pathname.endsWith("/active_tasks")) { const ids=url.searchParams.get("id"); if(ids?.startsWith("in.(")) batches.push(ids.slice(4,-1).split(",")); }
    return original(request);
  });
  try {
    const { GET } = await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts", {"server-only":{}});
    const response=await GET(f.request("founder",`/api/tasks/${source}/detail-data`),{params:Promise.resolve({id:source})});expect(response.status).toBe(200);
    const body=await response.json();
    expect(body.taskDetail.relatedItems.map((item:{id:string})=>item.id).sort()).toEqual([...endpoints].sort());
    expect(body.taskDetail.relationships.map((edge:{note:string})=>edge.note).sort()).toEqual(["Incoming stored note","Outgoing stored note"]);
    expect(batches).toEqual([expect.arrayContaining(endpoints)]);expect(batches[0]).toHaveLength(2);
    expect(body.taskDetail.coverage.relationships).toBe("complete");
    const {GET:candidates}=await importTestModule("src/app/api/planning-board-data/route.ts",{"server-only":{}});
    const page=await candidates(f.request("founder",`/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({view:"candidates",kind:"relationship",sourceId:source,query:"no stored endpoints match",limit:20}))}`));
    expect(page.status).toBe(200);expect((await page.json()).candidates.items).toEqual([]);
    expect(body.taskDetail.relatedItems).toHaveLength(2);expect(body.taskDetail.relationships).toHaveLength(2);
  } finally { vi.stubGlobal("fetch",original); }
}),120_000);
