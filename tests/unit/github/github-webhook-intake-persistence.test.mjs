import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {createHash} from "node:crypto";
import {githubWebhookProtocol,webhookPayload} from "../../helpers/github-webhook-protocol.mjs";
let fixture;
beforeEach(()=>{vi.resetModules();fixture=githubWebhookProtocol();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
test("actual intake stores only normalized Issue metadata",async()=>{
 const route=await fixture.route();const payload=webhookPayload();payload.issue.title="Sensitive source title";payload.issue.body="Sensitive source body";const response=await route.POST(fixture.request(payload));expect(response.status).toBe(202);
 const row=[...fixture.state.rows.values()][0];expect(row).toMatchObject({delivery_id:"synthetic-delivery",event_name:"issues",installation_id:42,repository_id:101,repository_full_name:"findmydoc-platform/management",issue_id:202,issue_node_id:"I_synthetic",issue_number:17,payload_sha256:createHash("sha256").update(fixture.raw(payload)).digest("hex")});
 expect(JSON.stringify(row)).not.toMatch(/Sensitive source|sha256=|synthetic-webhook-secret/);for(const key of ["payload","title","body","signature","comment_id","comment_node_id","comment_updated_at"])expect(row).not.toHaveProperty(key);
});
test("actual comment intake preserves comment identities without content",async()=>{
 const payload=webhookPayload({action:"created",comment:{id:404,node_id:"IC_synthetic",updated_at:"2026-10-17T10:01:00Z",body:"Sensitive comment content"}});const route=await fixture.route();const response=await route.POST(fixture.request(payload,{"x-github-event":"issue_comment"}));expect(response.status).toBe(202);
 const call=fixture.state.calls.find(call=>call.method==="POST");expect(call.path).toBe("github_webhook_deliveries");expect(call.body).toMatchObject({event_name:"issue_comment",comment_id:404,comment_node_id:"IC_synthetic",comment_updated_at:"2026-10-17T10:01:00Z"});expect(JSON.stringify(call.body)).not.toContain("Sensitive comment content");
});
test("persisted intake distinguishes exact replay from a delivery-ID payload conflict",async()=>{
 const route=await fixture.route();expect((await route.POST(fixture.request())).status).toBe(202);
 const duplicate=await route.POST(fixture.request());expect(duplicate.status).toBe(200);expect(await duplicate.json()).toEqual({ok:true,accepted:true,duplicate:true});
 const conflicting=webhookPayload({issue:{...webhookPayload().issue,updated_at:"2026-10-17T10:01:00Z"}});const conflict=await route.POST(fixture.request(conflicting));expect(conflict.status).toBe(409);expect(await conflict.json()).toMatchObject({code:"github_webhook_delivery_conflict"});expect(fixture.state.rows.size).toBe(1);expect(fixture.state.after).toHaveLength(2);
});
test.each(["insert","read","missing"])('receipt storage %s failure remains safe and unavailable',async mode=>{
 const route=await fixture.route();if(mode!=="insert")await route.POST(fixture.request());fixture.state.after=[];if(mode==="missing")fixture.state.rows.set("github_planning_webhook_deliveries:synthetic-delivery",null);else fixture.state.storageError=mode;
 const response=await route.POST(fixture.request());expect(response.status).toBe(503);expect(await response.json()).toEqual({ok:false,code:"github_webhook_storage_unavailable",error:"GitHub webhook delivery could not be stored."});expect(fixture.state.after).toHaveLength(0);
});
test("a lost receipt response is reconciled only by the next independently verified request",async()=>{
 const route=await fixture.route();fixture.state.afterInsert=async()=>{throw new Error("Sensitive uncertain response");};const unknown=await route.POST(fixture.request());expect(unknown.status).toBe(503);expect(fixture.state.calls.filter(call=>call.method==="POST")).toHaveLength(1);expect(fixture.state.rows.size).toBe(1);expect(fixture.state.after).toHaveLength(0);
 fixture.state.afterInsert=null;const repeated=await route.POST(fixture.request());expect(repeated.status).toBe(200);expect(await repeated.json()).toMatchObject({duplicate:true});expect(fixture.state.rows.size).toBe(1);expect(fixture.state.after).toHaveLength(1);
});
