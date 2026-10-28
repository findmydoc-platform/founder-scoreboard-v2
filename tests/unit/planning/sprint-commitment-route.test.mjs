import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { planningRouteProtocol } from "../../helpers/planning-route-protocol.mjs";
const { PUT }=await importTestModule("src/app/api/sprint-commitments/route.ts",{"server-only":{}});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
const payload={sprintId:"sprint",profileId:"synthetic-profile",commitmentLevel:"Heavy",weeklyHours:32,note:"Shown draft",expectedUpdatedAt:"2026-10-27T12:00:00Z"};
const row={id:8,sprint_id:"sprint",profile_id:"synthetic-profile",commitment_level:"Heavy",weekly_hours:32,note:"Shown draft",updated_at:"2026-10-28T12:00:00Z"};
test("the commitment action conditionally updates the displayed pair/version and returns the actual row version",async()=>{
 const p=planningRouteProtocol({role:"ceo",tables:{sprint_commitments:(request,url,body)=>{expect(request.method).toBe("PATCH");expect(url.searchParams.get("sprint_id")).toBe("eq.sprint");expect(url.searchParams.get("profile_id")).toBe("eq.synthetic-profile");expect(url.searchParams.get("updated_at")).toBe(`eq.${payload.expectedUpdatedAt}`);expect(body).toMatchObject({commitment_level:"Heavy",weekly_hours:32});return Response.json(row);},audit_log:[]}});
 const response=await PUT(p.request("/api/sprint-commitments","PUT",payload));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({commitment:{id:8,updatedAt:row.updated_at}});
});

test.each([null,{code:"23505",message:"Concurrent insert"}])("zero affected update or absent insertion collision reports an actual revision conflict: %j",async error=>{
 const p=planningRouteProtocol({role:"ceo",tables:{sprint_commitments:()=>error?Response.json(error,{status:409}):Response.json(null),audit_log:()=>{throw new Error("Rejected write cannot audit");}}});
 const response=await PUT(p.request("/api/sprint-commitments","PUT",{...payload,expectedUpdatedAt:error?null:payload.expectedUpdatedAt}));expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:"commitment_revision_conflict"});expect(p.requests.filter(item=>item.table==="audit_log")).toHaveLength(0);
});
test("audit failure preserves the confirmed versioned commitment receipt",async()=>{
 const p=planningRouteProtocol({role:"ceo",tables:{sprint_commitments:row,audit_log:()=>Response.json({message:"Audit unavailable"},{status:503})}});const response=await PUT(p.request("/api/sprint-commitments","PUT",payload));expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,auditError:"Commitment gespeichert. Ob die Änderung protokolliert wurde, ist noch unklar.",commitment:{id:8,sprintId:"sprint",profileId:"synthetic-profile",commitmentLevel:"Heavy",weeklyHours:32,note:"Shown draft",updatedAt:row.updated_at}});
});
test.each([undefined,"",32,"invalid","999999999999999999999999-01-01","+275760-09-13T00:00:00.000Z"])("missing or malformed displayed basis never dispatches the commitment write: %j",async expectedUpdatedAt=>{
 const p=planningRouteProtocol({role:"ceo",tables:{sprint_commitments:row}});expect((await PUT(p.request("/api/sprint-commitments","PUT",{...payload,expectedUpdatedAt}))).status).toBe(400);expect(p.requests.some(item=>item.table==="sprint_commitments")).toBe(false);
});

test("same-millisecond saves cannot retain the displayed timestamp merely because PostgreSQL spells its offset differently",async()=>{
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-28T12:00:00.123Z"));
 const p=planningRouteProtocol({role:"ceo",tables:{sprint_commitments:(request,url,body)=>{expect(body.updated_at).toBe("2026-10-28T12:00:00.124Z");return Response.json({...row,updated_at:body.updated_at});},audit_log:[]}});
 const response=await PUT(p.request("/api/sprint-commitments","PUT",{...payload,expectedUpdatedAt:"2026-10-28T12:00:00.123+00:00"}));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({commitment:{updatedAt:"2026-10-28T12:00:00.124Z"}});
});

test("three same-clock saves cannot recycle the original stale commitment token",async()=>{
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-28T12:00:00.123Z"));
 const p=planningRouteProtocol({role:"ceo",tables:{sprint_commitments:(request,url,body)=>{expect(body.updated_at).toBe("2026-10-28T12:00:00.125Z");return Response.json({...row,updated_at:body.updated_at});},audit_log:[]}});
 const response=await PUT(p.request("/api/sprint-commitments","PUT",{...payload,expectedUpdatedAt:"2026-10-28T12:00:00.124+00:00"}));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({commitment:{updatedAt:"2026-10-28T12:00:00.125Z"}});
});

test("a frozen-time commitment sequence rejects every previously accepted token",async()=>{
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-28T12:00:00.123Z"));let persisted={...row,updated_at:"2026-10-28T12:00:00.122+00:00"};
 const p=planningRouteProtocol({role:"ceo",tables:{sprint_commitments:(request,url,body)=>{if(Date.parse(url.searchParams.get("updated_at").slice(3))!==Date.parse(persisted.updated_at))return Response.json(null);persisted={...persisted,...body,updated_at:body.updated_at.replace("Z","+00:00")};return Response.json(persisted);},audit_log:[]}});
 const versions=[persisted.updated_at];
 for(const expected of ["2026-10-28T12:00:00.123+00:00","2026-10-28T12:00:00.124+00:00","2026-10-28T12:00:00.125+00:00"]){const response=await PUT(p.request("/api/sprint-commitments","PUT",{...payload,expectedUpdatedAt:versions.at(-1)}));expect(response.status).toBe(200);expect((await response.json()).commitment.updatedAt).toBe(expected);versions.push(expected);}
 for(const older of versions.slice(0,-1)){const response=await PUT(p.request("/api/sprint-commitments","PUT",{...payload,expectedUpdatedAt:older}));expect(response.status).toBe(409);}
 expect(p.requests.filter(item=>item.table==="audit_log")).toHaveLength(3);
});


test("a valid timestamp basis keeps its exact offset and fractional spelling in the atomic comparison",async()=>{
 const expectedUpdatedAt="2026-10-27T14:00:00.123456+02:00";
 const p=planningRouteProtocol({role:"ceo",tables:{sprint_commitments:(request,url)=>{expect(url.searchParams.get("updated_at")).toBe(`eq.${expectedUpdatedAt}`);return Response.json(row);},audit_log:[]}});
 expect((await PUT(p.request("/api/sprint-commitments","PUT",{...payload,expectedUpdatedAt}))).status).toBe(200);
});
test.each([{authError:401},{profile:false},{role:"viewer"}])("authorization still precedes malformed commitment-version validation: %j",async denied=>{
 const p=planningRouteProtocol({...denied,tables:{sprint_commitments:row}});
 const response=await PUT(p.request("/api/sprint-commitments","PUT",{...payload,expectedUpdatedAt:"invalid"}));
 expect([401,403]).toContain(response.status);expect(p.requests.some(item=>item.table==="sprint_commitments")).toBe(false);
});
