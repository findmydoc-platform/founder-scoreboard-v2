import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { planningRouteProtocol } from "../../helpers/planning-route-protocol.mjs";
const { PATCH, POST } = await importTestModule("src/app/api/sprints/[id]/score-objections/route.ts", { "server-only": {} });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const shown = { id: 10, sprint_id: "sprint", profile_id: "founder", founder_sprint_score_id: null, status: "open", comment: "Shown", resolution_comment: null, reviewed_by: null, reviewed_at: null, resolved_delivery_points: null, resolved_form_points: null, resolved_weekly_points: null, second_reviewer_profile_id: null, second_review_decision: null, second_reviewed_at: null, created_at: "2026-10-27T12:00:00Z" };
const input = { objectionId:10,action:"resolve",status:"accepted",resolutionComment:"Checked",deliveryPoints:10,formPoints:3,weeklyPoints:4,expectedObjection:shown,expectedScore:null };
const context = { params:Promise.resolve({id:"sprint"}) };
test("the public decision passes its original raw nullable tuple and verified absent score to the atomic service wrapper",async()=>{
 const p=planningRouteProtocol({role:"ceo",responses:{process_score_objection_with_basis_transaction:body=>{expect(body.p_expected_objection).toEqual(shown);expect(body.p_expected_score).toBeNull();return Response.json({objection:{...shown,status:"accepted"},score:null});}}});
 const response=await PATCH(p.request("/api/sprints/sprint/score-objections","PATCH",input),context);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({objection:{status:"accepted"},score:null});expect(p.calls.filter(call=>call.name==="process_score_objection_with_basis_transaction")).toHaveLength(1);
});
test.each(["P0003","P0004","P0005","P0006","P0007","session_superseded"])("only a genuine original-basis error receives the comparison code: %s",async code=>{
 const p=planningRouteProtocol({role:"ceo",responses:{process_score_objection_with_basis_transaction:()=>Response.json({code,message:"Protected"},{status:400})}});
 const response=await PATCH(p.request("/api/sprints/sprint/score-objections","PATCH",input),context);const body=await response.json();if(code==="P0007"){expect(response.status).toBe(409);expect(body.code).toBe("score_objection_basis_conflict");}else expect(body.code).not.toBe("score_objection_basis_conflict");
});
test.each([{...input,expectedObjection:undefined},{...input,expectedScore:undefined},{...input,expectedObjection:{...shown,id:99}},{...input,expectedObjection:{...shown,sprint_id:"elsewhere"}}])("missing or mismatched displayed bases do not reach the decision transaction",async payload=>{
 const p=planningRouteProtocol({role:"ceo"});expect((await PATCH(p.request("/api/sprints/sprint/score-objections","PATCH",payload),context)).status).toBe(400);expect(p.calls.some(call=>call.name.includes("process_score_objection"))).toBe(false);
});
test("ordinary creation remains a single authorized creation with the exact server receipt",async()=>{const p=planningRouteProtocol({role:"founder",responses:{create_score_objection_transaction:()=>Response.json(shown)}});const response=await POST(p.request("/api/sprints/sprint/score-objections","POST",{comment:"Shown"}),context);expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,objection:shown});});

test.each([["42501",403],["session_superseded",409]])("credential failure %s retains its actual category and never becomes a version comparison",async(code,status)=>{
 const p=planningRouteProtocol({role:"ceo",responses:{process_score_objection_with_basis_transaction:()=>Response.json({code,message:"Credential ended"},{status:400})}});const response=await PATCH(p.request("/api/sprints/sprint/score-objections","PATCH",input),context);expect(response.status).toBe(status);const body=await response.json();if(code==="session_superseded")expect(body.code).toBe(code);expect(body.code).not.toBe("score_objection_basis_conflict");
});
