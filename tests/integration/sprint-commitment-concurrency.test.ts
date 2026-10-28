import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
it("authorized commitment compare-and-save rejects stale and absent-row races without changing independent records or their audit",()=>withPlanningCredentialDatabase(async f=>{
 const sprint=`${f.prefix}-commitment`;
 await f.db.query("insert into public.sprints(id,project_id,name,status) values($1,'findmydoc-founder-execution','Synthetic commitment CAS','planning')",[sprint]);
 const {PUT}=await importTestModule("src/app/api/sprint-commitments/route.ts",{"server-only":{}});
 const payload={sprintId:sprint,profileId:f.actors.founder.profileId,commitmentLevel:"Standard",weeklyHours:20,note:"Original",expectedUpdatedAt:null as string|null};
 const save=(actor:"founder"|"other"|"ceo"|"deputy"|"viewer"|"administrator"|"unmapped",body:typeof payload)=>PUT(f.request(actor,"/api/sprint-commitments","PUT",body));
 const first=await save("founder",payload);expect(first.status).toBe(200);const shown=(await first.json()).commitment;expect(shown.updatedAt).toEqual(expect.any(String));
 const independent=await save("other",{...payload,profileId:f.actors.other.profileId,note:"Independent"});expect(independent.status).toBe(200);
 const auditCount=async()=>Number((await f.db.query("select count(*) from public.audit_log where actor_profile_id=any($1) and action='sprint.commitment.update'",[[f.actors.founder.profileId,f.actors.other.profileId,f.actors.ceo.profileId,f.actors.deputy.profileId]])).rows[0].count);
 expect(await auditCount()).toBe(2);
 const contenders=await Promise.all([save("founder",{...payload,expectedUpdatedAt:shown.updatedAt,weeklyHours:24}),save("deputy",{...payload,expectedUpdatedAt:shown.updatedAt,weeklyHours:28})]);
 expect(contenders.map(response=>response.status).sort()).toEqual([200,409]);
 const winner=await contenders.find(response=>response.status===200)!.json();expect(winner.commitment.updatedAt).not.toBe(shown.updatedAt);
 const stale=await save("ceo",{...payload,expectedUpdatedAt:shown.updatedAt,weeklyHours:40});expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({code:"commitment_revision_conflict"});
 expect((await save("founder",payload)).status).toBe(409);
 expect(await auditCount()).toBe(3);
 expect((await f.db.query("select weekly_hours,note from public.sprint_commitments where sprint_id=$1 and profile_id=$2",[sprint,f.actors.other.profileId])).rows).toEqual([{weekly_hours:20,note:"Independent"}]);
 for(const actor of ["other","viewer","administrator","unmapped"] as const)expect((await save(actor,{...payload,expectedUpdatedAt:winner.commitment.updatedAt})).status).toBe(403);
 const allowed=await save("ceo",{...payload,expectedUpdatedAt:winner.commitment.updatedAt,weeklyHours:36});expect(allowed.status).toBe(200);
 const absent={...payload,profileId:f.actors.ceo.profileId};
 const inserts=await Promise.all([save("ceo",absent),save("deputy",{...absent,weeklyHours:12})]);expect(inserts.map(response=>response.status).sort()).toEqual([200,409]);
 expect((await f.db.query("select count(*)::int as count from public.sprint_commitments where sprint_id=$1 and profile_id=$2",[sprint,f.actors.ceo.profileId])).rows[0].count).toBe(1);
 expect(await auditCount()).toBe(5);
 vi.useFakeTimers({toFake:["Date"]});
 try {
  vi.setSystemTime(new Date("2099-01-01T12:00:00.123Z"));
  let version=(await allowed.json()).commitment.updatedAt;
  const versions:string[]=[];
  for(const weeklyHours of [37,38,39]){
   const response=await save("founder",{...payload,expectedUpdatedAt:version,weeklyHours});expect(response.status).toBe(200);version=(await response.json()).commitment.updatedAt;versions.push(version);
  }
  expect(versions).toEqual(["2099-01-01T12:00:00.123+00:00","2099-01-01T12:00:00.124+00:00","2099-01-01T12:00:00.125+00:00"]);
  const replay=await save("founder",{...payload,expectedUpdatedAt:versions[0],weeklyHours:40});expect(replay.status).toBe(409);expect(await auditCount()).toBe(8);
 } finally {vi.useRealTimers();}
}),30_000);
