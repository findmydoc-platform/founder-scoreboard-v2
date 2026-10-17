import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {cronWebhookProtocol,cronSecret} from "../../helpers/cron-webhook-protocol.mjs";
import {importTestModule} from "../../helpers/vitest-module.mjs";
let fixture;
beforeEach(()=>{vi.resetModules();fixture=cronWebhookProtocol();vi.spyOn(console,"error").mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
const failures=(reasons,extra={})=>reasons.map(status_reason=>({status:"failed",status_reason,archived_at:null,event_name:"issue_comment",source_kind:"github_webhook",...extra}));
const pending=(count,status="received")=>Array.from({length:count},()=>({status,event_name:"issue_comment",source_kind:"github_webhook"}));

test("Cron drains ready and stale deliveries through the real processors without repeating a pending identity",async()=>{
 fixture.state.planningQueue=["planning-ready"];fixture.state.planningStaleQueue=["planning-ready","planning-stale"];fixture.state.planningClaim=true;fixture.state.queueIds=["comment-ready"];fixture.state.commentStaleQueue=["comment-ready"];fixture.state.commentClaim=true;
 const route=await fixture.route();const response=await route.GET(fixture.request());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({projection:{claimed:0,completed:0,retryScheduled:0,failed:0},planning:{claimed:2,processed:0,ignored:2,retryScheduled:0,failed:0,skipped:0},comments:{claimed:1,processed:1,ignored:0,retryScheduled:0,failed:0,skipped:0}});
 expect(fixture.state.calls.filter(call=>call.path==="claim_github_planning_webhook_delivery").map(call=>call.body.p_delivery_id)).toEqual(["planning-ready","planning-stale"]);expect(fixture.state.applied).toHaveLength(1);
});

test.each([`Bearer ${cronSecret}`,`bearer ${cronSecret}`,`  BEARER   ${cronSecret}  `])("Cron accepts its configured bearer syntax %s",async authorization=>{
 const route=await fixture.route();const response=await route.GET(fixture.request({authorization}));expect(response.status).toBe(200);expect(fixture.state.calls[0]).toMatchObject({path:"claim_planning_github_projection_requests",body:{p_limit:25,p_lease_seconds:120,p_operation_id:null}});
});

test.each([{}, {authorization:"wrong"},{authorization:cronSecret},{authorization:"Bearer synthetic-maintenance-secret"},{authorization:"Bearer synthetic-delivery-secret"},{authorization:"Bearer synthetic-release-secret"},{authorization:"Bearer synthetic-user-session"},{"x-founderops-maintenance-secret":"synthetic-maintenance-secret"},{"x-founderops-delivery-secret":"synthetic-delivery-secret"}])("foreign or missing technical proof cannot substitute for Cron: %j",async headers=>{
 const route=await fixture.route();const response=await route.GET(fixture.request(headers));expect(response.status).toBe(401);expect(await response.json()).toEqual({error:"Ungültiger Cron-Secret."});expect(fixture.state.calls).toHaveLength(0);
});

test("Cron missing configuration retains its unavailable response before data access",async()=>{
 vi.stubEnv("CRON_SECRET","");const route=await fixture.route();const response=await route.GET(fixture.request());expect(response.status).toBe(503);expect(await response.json()).toEqual({error:"GitHub-Webhook-Cron ist nicht konfiguriert."});expect(fixture.state.calls).toHaveLength(0);
});
test.each(["url","key"])("Cron missing database %s retains its existing response",async field=>{
 for(const name of field==="url"?["NEXT_PUBLIC_SUPABASE_URL","SUPABASE_URL"]:["SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEY"])vi.stubEnv(name,"");const route=await fixture.route();const response=await route.GET(fixture.request());expect(response.status).toBe(501);expect(await response.json()).toEqual({error:"Supabase env is not configured."});expect(fixture.state.calls).toHaveLength(0);
});

test("Cron exposes only grouped current terminal failures and separately retained archived reasons",async()=>{
 fixture.state.healthRows.planning=[...failures(["ambiguous_task_mapping"]),...failures([null],{archived_at:"2026-08-18T09:00:00Z",archive_reason:"superseded_test_failure_task_links_fixed"}),...pending(2)];
 fixture.state.healthRows.comments=[...failures(["processing_error","processing_error","source_record_missing"]),...failures([null],{archived_at:"2026-08-18T09:00:00Z",archive_reason:"source_comment_unavailable_without_projection"}),...pending(4),...failures(["unrelated_issues_failure"],{event_name:"issues"})];
 fixture.state.healthRows.projection=[...failures(["github_sync_unavailable","github_sync_unavailable","github_sync_unavailable","processing_error","processing_error"]),...pending(6,"pending"),...failures(["unrelated_personal_failure"],{source_kind:"personal_api"})];
 const route=await fixture.route();const response=await route.GET(fixture.request());expect(response.status).toBe(503);const body=await response.json();expect(body).toMatchObject({ok:false,projectionTerminalFailed:5,projectionDispatchFailed:0,projectionOutstanding:6,terminalFailed:9,archivedTerminalFailed:2,outstanding:12});
 expect(body.terminalFailureReasons).toEqual({planning:[{reason:"ambiguous_task_mapping",count:1}],comments:[{reason:"processing_error",count:2},{reason:"source_record_missing",count:1}],projection:[{reason:"github_sync_unavailable",count:3},{reason:"processing_error",count:2}]});expect(body.archivedTerminalFailureReasons).toEqual({planning:[{reason:"superseded_test_failure_task_links_fixed",count:1}],comments:[{reason:"source_comment_unavailable_without_projection",count:1}],projection:[]});expect(JSON.stringify(body)).not.toContain("unrelated_");
});

test("archived failures remain visible without making the current queue unhealthy",async()=>{
 fixture.state.healthRows.planning=failures([null,null],{archived_at:"2026-08-18T09:00:00Z",archive_reason:"superseded_test_failure_task_links_fixed"});fixture.state.healthRows.comments=failures([null],{archived_at:"2026-08-18T09:00:00Z",archive_reason:"source_comment_unavailable_without_projection"});
 const route=await fixture.route();const response=await route.GET(fixture.request());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true,terminalFailed:0,archivedTerminalFailed:3,archivedTerminalFailureReasons:{planning:[{reason:"superseded_test_failure_task_links_fixed",count:2}],comments:[{reason:"source_comment_unavailable_without_projection",count:1}],projection:[]}});
});

test("Cron reports a projection dispatch that cannot finalize even without prior terminal failures",async()=>{
 fixture.state.projectionRows=[{id:"synthetic-projection-job",planning_operation_id:"synthetic-operation",task_id:"missing-synthetic-task",actor_profile_id:null,create_if_missing:false,status:"processing",result:null}];fixture.state.projectionFinalizeError=true;fixture.state.healthRows.projection=pending(1,"pending");
 const route=await fixture.route();const response=await route.GET(fixture.request());expect(response.status).toBe(503);expect(await response.json()).toMatchObject({ok:false,terminalFailed:0,archivedTerminalFailed:0,projectionDispatchFailed:1,projectionOutstanding:1,terminalFailureReasons:{planning:[],comments:[],projection:[]},archivedTerminalFailureReasons:{planning:[],comments:[],projection:[]}});expect(fixture.state.finalized).toHaveLength(1);
});

test.each(["queue","health","count"])("a failed %s dependency retains the safe maintenance error",async mode=>{
 fixture.state.queryFailure=mode;const route=await fixture.route();const response=await route.GET(fixture.request());expect(response.status).toBe(500);expect(await response.json()).toEqual({error:"GitHub-Webhook-Ereignisse konnten nicht verarbeitet werden."});
});
test("invalid outstanding counts cannot report a healthy drain",async()=>{
 fixture.state.invalidCount=true;const route=await fixture.route();const response=await route.GET(fixture.request());expect(response.status).toBe(500);
});

test("a foreign returned claim identity never authorizes projection or finalization",async()=>{
 fixture.state.commentClaim=true;fixture.state.commentClaimId="foreign-claimed-job";const route=await fixture.route();const response=await route.GET(fixture.request());expect(response.status).toBe(500);expect(fixture.state.applied).toHaveLength(0);expect(fixture.state.finalized).toHaveLength(0);
});
test("an unavailable or foreign lease is skipped without applying or finalizing its work",async()=>{
 fixture.state.commentClaim=false;const route=await fixture.route();const response=await route.GET(fixture.request());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({comments:{claimed:0,skipped:1}});expect(fixture.state.applied).toHaveLength(0);expect(fixture.state.finalized).toHaveLength(0);
});
test("lost exact finalization ownership cannot replay an already applied effect",async()=>{
 fixture.state.commentClaim=true;fixture.state.finalizeDenied=true;const route=await fixture.route();const response=await route.GET(fixture.request());expect(response.status).toBe(500);expect(fixture.state.applied).toHaveLength(1);expect(fixture.state.finalized).toHaveLength(1);expect(fixture.state.calls.filter(call=>call.path==="claim_github_issue_comment_webhook_delivery")).toHaveLength(1);
});

test("the public Cron capability fixes the drain bound and shares no raw service client",async()=>{
 fixture.state.queueIds=Array.from({length:35},(_,index)=>`bounded-job-${index}`);const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});const admission=await authorizeCredentialAction({credential:{kind:"cron-request",request:fixture.request()},action:"github.webhooks.drain"});expect(admission.ok).toBe(true);expect(admission.webhookDrain.from).toBeUndefined();expect(admission.webhookDrain.rpc).toBeUndefined();await Promise.all([admission.webhookDrain.run(),admission.webhookDrain.run()]);expect(fixture.state.calls.filter(call=>call.path==="claim_github_issue_comment_webhook_delivery")).toHaveLength(25);expect(fixture.state.calls.filter(call=>call.path==="claim_planning_github_projection_requests")).toHaveLength(1);expect(fixture.state.calls.filter(call=>call.url.searchParams.get("select")==="delivery_id,received_at").every(call=>call.url.searchParams.get("limit")==="25")).toBe(true);
});
test.each(["session-request","github-installation","maintenance-request"])("the public Cron action rejects the %s credential class",async kind=>{
 const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});expect(await authorizeCredentialAction({credential:{kind,request:fixture.request()},action:"github.webhooks.drain"})).toEqual({ok:false,status:401,error:"Ungültiger Cron-Secret."});expect(fixture.state.calls).toHaveLength(0);
});
