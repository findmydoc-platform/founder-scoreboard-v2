import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import type { Task, Profile, Sprint } from "@/lib/types";

test("Structure controls preserve the complete Table scalar populations independently of filtered and paged membership", () => withPlanningCredentialDatabase(async f => {
  await f.db.query("update public.tasks set sort_order=0 where id=$1", [f.initiativeId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,sort_order,approval_status,owner,workstream)
    select $1||'-controls-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Control Initiative '||n,'initiative',$2,
    case when n=1008 then 'Erledigt' else 'Offen' end,'P2',n,case when n%2=0 then 'proposed' else 'approved' end,$3,
    case when n=1008 then 'Öffentlicher Bereich' else 'Alpha' end from generate_series(1,1008)n`, [f.prefix, `${f.prefix}-epic`, f.actors.founder.profileId]);
  await f.db.query("insert into public.sprints(id,project_id,name,status,start_date,end_date) values($1,'findmydoc-founder-execution','Closed scalar Sprint','closed','2026-01-01','2026-01-14'),($2,'findmydoc-founder-execution','Future scalar Sprint','planning','2026-12-01','2026-12-14')", [`${f.prefix}-closed`, `${f.prefix}-future`]);
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reference = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: f.actors.founder.profileId, query: { view: "complete" } });
  expect(reference.status).toBe("ready"); if(reference.status!=="ready") throw new Error("Complete scalar reference unavailable");
  const expectedIds = [f.initiativeId, ...Array.from({length:1008},(_,i)=>`${f.prefix}-controls-${String(i+1).padStart(4,"0")}`)];
  expect(reference.model.items.filter((row:Task)=>row.taskType==="initiative").map((row:Task)=>row.id)).toEqual(expectedIds);
  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
  const url=`/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({view:"structure",area:"controls"}))}`;
  const response=await GET(f.request("founder",url));expect(response.status).toBe(200);
  const body=await response.json(),controls=body.model.controls;
  expect(controls.coverage).toBe("complete");expect(controls.initiatives.map((row:{id:string})=>row.id)).toEqual(expectedIds);
  const byId=(a:{id:string},b:{id:string})=>a.id<b.id?-1:a.id>b.id?1:0;
  expect([...controls.people].sort(byId)).toEqual(reference.model.people.map((row:Profile)=>({id:row.id,name:row.name})).sort(byId));
  expect([...controls.sprints].sort(byId)).toEqual(reference.model.sprints.map((row:Sprint)=>({id:row.id,name:row.name})).sort(byId));
  expect(controls.workstreams).toEqual([...new Set(reference.model.items.map((row:Task)=>row.workstream).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"de")));
  expect(controls.sprints.map((row:{id:string})=>row.id)).toContain(`${f.prefix}-closed`);
  expect(body.model).not.toHaveProperty("items");expect(body.model).not.toHaveProperty("structure");
  expect(controls.sourceRevision).toBeTruthy();expect(controls.scopeRevision).toBeTruthy();expect(Date.parse(controls.validUntil)).toBeLessThanOrEqual(body.readAuthority.deadline);
  expect(body.readActor).toEqual({profileId:f.actors.founder.profileId,platformRole:"founder"});
  for(const actor of ["ceo","deputy","viewer","administrator"] as const) expect((await GET(f.request(actor,url))).status).toBe(200);
  expect((await GET(f.request("unmapped",url))).status).toBe(403);
  for(const actor of ["founder","unmapped","anonymous"] as const){const rpc=await f.rpc("planning_structure_controls",{p_actor_profile_id:f.actors.founder.profileId},actor);expect(rpc.status).toBe(actor==="anonymous"?401:403);}
}),20000);
