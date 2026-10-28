import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); vi.useRealTimers(); });
async function protocol({role="deputy",auditFailure=false,writeFailure=false}={}) {
 const auth=administratorProtocol({role}),fallback=globalThis.fetch;
 let row=null,writes=0,audits=0;
 vi.stubGlobal("fetch",async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);
  if(url.pathname==="/rest/v1/meetings")return Response.json({id:7,title:"Weekly"});
  if(url.pathname==="/rest/v1/meeting_attendance"){
   if(request.method==="GET")return Response.json(row);
   writes++; const values=await request.json();
   if(request.method==="POST"&&row)return Response.json({code:"23505",message:"Duplicate"},{status:409});
   if(request.method==="PATCH") {expect(url.searchParams.get("meeting_id")).toBe("eq.7");expect(url.searchParams.get("profile_id")).toBe("eq.synthetic-profile");if(url.searchParams.get("updated_at")!==`eq.${row?.updated_at}`)return Response.json(null);}
   row={id:8,created_at:"2026-10-28T00:00:00Z",...row,...values};return writeFailure?Response.json({message:"Write confirmation lost"},{status:503}):Response.json(row);
  }
  if(url.pathname==="/rest/v1/profiles")return Response.json([{id:"lead"}]);
  if(url.pathname==="/rest/v1/notification_events")return Response.json([],{status:201});
  if(url.pathname==="/rest/v1/audit_log"){audits++;return auditFailure?Response.json({message:"Audit unavailable"},{status:503}):Response.json([],{status:201});}
  return fallback(request);
 });
 const route=await importTestModule("src/app/api/meetings/[id]/attendance/route.ts",{"server-only":{}});
 const post=payload=>route.POST(auth.request("/api/meetings/7/attendance","POST",{profileId:"synthetic-profile",status:"present",...payload}),{params:Promise.resolve({id:"7"})});
 return {post,get:profile=>route.GET(auth.request(`/api/meetings/7/attendance?profileId=${profile}`),{params:Promise.resolve({id:"7"})}),auth,state:()=>({row,writes,audits})};
}
test("attendance requires an explicit absent/version basis, rejects stale writes and never audits a conflict",async()=>{
 const p=await protocol();expect((await p.post({})).status).toBe(400);expect(p.state().writes).toBe(0);
 const first=await p.post({expectedUpdatedAt:null});expect(first.status).toBe(200);const body=await first.json();expect(body.attendance.points).toBe(2);
 const conflict=await p.post({expectedUpdatedAt:null,writtenUpdate:"Must not replace"});expect(conflict.status).toBe(409);expect(await conflict.json()).toMatchObject({code:"attendance_revision_conflict"});expect(p.state().audits).toBe(1);
 expect((await p.post({expectedUpdatedAt:"2020-01-01T00:00:00Z"})).status).toBe(409);expect(p.state().row.written_update).toBe("");
 expect((await p.post({expectedUpdatedAt:body.attendance.updatedAt,writtenUpdate:"Accepted"})).status).toBe(200);expect(p.state().row.written_update).toBe("Accepted");
});
test("persisted attendance survives later audit failure as an explicit partial receipt",async()=>{
 const p=await protocol({auditFailure:true});const response=await p.post({expectedUpdatedAt:null});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({attendance:{id:8,points:2},effects:"unconfirmed",code:"attendance_saved_effects_unconfirmed"});
});
test("the exact attendance pair read retains own-founder and lead authority",async()=>{
 const p=await protocol({role:"founder"});expect((await p.get("foreign")).status).toBe(403);expect((await p.get("synthetic-profile")).status).toBe(200);expect(p.state().writes).toBe(0);
 expect((await p.post({expectedUpdatedAt:null,status:"excused",absenceReason:"Appointment",points:2,reasonAccepted:true})).status).toBe(200);expect(p.state().row).toMatchObject({points:0,reason_accepted:false});
});
test("attendance version advances even when Postgres spelling differs at the same frozen instant",async()=>{
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-28T00:00:00Z"));const p=await protocol();const first=await p.post({expectedUpdatedAt:null});const record=(await first.json()).attendance;
 const stored=p.state().row;stored.updated_at=record.updatedAt.replace("Z","+00:00");const previous=stored.updated_at;
 expect((await p.post({expectedUpdatedAt:previous,writtenUpdate:"Next"})).status).toBe(200);expect(Date.parse(p.state().row.updated_at)).toBeGreaterThan(Date.parse(previous));
 const second=p.state().row.updated_at;
 expect((await p.post({expectedUpdatedAt:second,writtenUpdate:"Third"})).status).toBe(200);
 expect(Date.parse(p.state().row.updated_at)).toBeGreaterThan(Date.parse(second));
 expect((await p.post({expectedUpdatedAt:previous,writtenUpdate:"Stale ABA"})).status).toBe(409);
});

test("an applied write with lost database confirmation returns no invented attendance receipt and GET never repeats it",async()=>{
 const p=await protocol({writeFailure:true});const response=await p.post({expectedUpdatedAt:null,writtenUpdate:"Applied remotely"});expect(response.status).toBe(500);expect(await response.json()).not.toHaveProperty("attendance");
 const checked=await p.get("synthetic-profile");expect(checked.status).toBe(200);expect(await checked.json()).toMatchObject({attendance:{writtenUpdate:"Applied remotely"}});expect(p.state().writes).toBe(1);expect(p.state().audits).toBe(0);
});
