import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
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
