import {generateKeyPairSync} from "node:crypto";
import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {cronWebhookProtocol} from "../../helpers/cron-webhook-protocol.mjs";
let fixture;
beforeEach(()=>{vi.resetModules();fixture=cronWebhookProtocol();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});

test("a changed Cron secret during queue acquisition cannot authorize another job claim",async()=>{
 let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});fixture.state.beforeProjectionClaim=async()=>{started();await gate;};
 const route=await fixture.route();const pending=route.GET(fixture.request());await entered;vi.stubEnv("CRON_SECRET","rotated-synthetic-cron-secret");release();const response=await pending;
 expect(fixture.state.calls.filter(call=>call.path==="claim_github_issue_comment_webhook_delivery")).toHaveLength(0);expect(response.status).toBe(500);
});

test("a confirmed claim effect retains exact finalization after the Cron secret changes",async()=>{
 fixture.state.commentClaim=true;fixture.state.afterApply=async()=>vi.stubEnv("CRON_SECRET","changed-after-confirmed-effect");const route=await fixture.route();const response=await route.GET(fixture.request());
 expect(fixture.state.applied).toHaveLength(1);expect(fixture.state.finalized).toMatchObject([{p_delivery_id:"synthetic-comment-ready",p_lock_token:fixture.state.applied[0].p_lock_token,p_status:"processed",p_status_reason:"comment_removed"}]);expect(response.status).toBe(500);
});

test("Cron admission remains binding after held installation-token issuance before a real resource attempt",async()=>{
 const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});vi.stubEnv("GITHUB_APP_ID","123");vi.stubEnv("GITHUB_APP_INSTALLATION_ID","42");vi.stubEnv("GITHUB_APP_PRIVATE_KEY",privateKey.export({type:"pkcs8",format:"pem"}));fixture.state.commentClaim=true;fixture.state.commentAction="edited";
 let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});fixture.state.beforeToken=async()=>{started();await gate;};const route=await fixture.route();const pending=route.GET(fixture.request());await entered;vi.stubEnv("CRON_SECRET","rotated-during-token-issuance");release();const response=await pending;
 expect(fixture.state.providerRequests).toHaveLength(0);expect(fixture.state.finalized).toMatchObject([{p_delivery_id:"synthetic-comment-ready",p_status:"retry_scheduled"}]);expect(response.status).toBe(500);
});

test("coalesced installation access cannot transfer an independent current Cron admission to a revoked caller",async()=>{
 const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});vi.stubEnv("GITHUB_APP_ID","123");vi.stubEnv("GITHUB_APP_INSTALLATION_ID","42");vi.stubEnv("GITHUB_APP_PRIVATE_KEY",privateKey.export({type:"pkcs8",format:"pem"}));fixture.state.commentClaim=true;fixture.state.commentAction="edited";fixture.state.queueIds=["old-caller-job"];
 let release,started,secondResolved;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;}),second=new Promise(resolve=>{secondResolved=resolve;});fixture.state.beforeToken=async()=>{started();await gate;};let mappings=0;fixture.state.afterResolveTask=async()=>{if(++mappings===2)secondResolved();};
 const route=await fixture.route();const old=route.GET(fixture.request());await entered;vi.stubEnv("CRON_SECRET","new-independent-cron");fixture.state.queueIds=["new-caller-job"];const current=route.GET(fixture.request({authorization:"Bearer new-independent-cron"}));await second;await new Promise(resolve=>setImmediate(resolve));release();
 expect((await old).status).toBe(500);expect((await current).status).toBe(200);expect(fixture.state.tokenRequests).toBe(1);expect(fixture.state.providerRequests).toHaveLength(1);expect(fixture.state.finalized).toEqual(expect.arrayContaining([expect.objectContaining({p_delivery_id:"old-caller-job",p_status:"retry_scheduled"}),expect.objectContaining({p_delivery_id:"new-caller-job",p_status:"ignored",p_status_reason:"app_mirrored_comment"})]));
 const {importTestModule}=await import("../../helpers/vitest-module.mjs");const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});const {getGitHubIssueComment}=await importTestModule("src/lib/github.ts");const {github}=await authorizeCredentialAction({credential:{kind:"github-installation"},action:"github.issue.read",target:{repositories:["findmydoc-platform/management"]}});await getGitHubIssueComment(404,github,"findmydoc-platform/management");expect(fixture.state.providerRequests).toHaveLength(2);expect(fixture.state.tokenRequests).toBe(1);
});

test("nested Cron work cannot discard an outer restriction and neither scope leaks into a later request",async()=>{
 const route=await fixture.route();let nested;fixture.state.beforeProjectionClaim=async()=>{vi.stubEnv("CRON_SECRET","nested-current-cron");nested=await route.GET(fixture.request({authorization:"Bearer nested-current-cron"}));};
 const outer=await route.GET(fixture.request());expect(outer.status).toBe(500);expect(nested.status).toBe(500);expect(fixture.state.calls.filter(call=>call.path==="claim_planning_github_projection_requests")).toHaveLength(1);
 fixture.state.beforeProjectionClaim=null;const later=await route.GET(fixture.request({authorization:"Bearer nested-current-cron"}));expect(later.status).toBe(200);expect(fixture.state.calls.filter(call=>call.path==="claim_planning_github_projection_requests")).toHaveLength(2);
});

test.each(["planning","projection"])("an accepted %s claim retains only its exact finalization when the Cron changes",async family=>{
 if(family==="planning"){fixture.state.planningQueue=["synthetic-planning-job"];fixture.state.planningClaim=true;fixture.state.afterPlanningClaim=async()=>vi.stubEnv("CRON_SECRET","changed-after-planning-claim");}
 else {fixture.state.projectionRows=[{id:"synthetic-projection-job",planning_operation_id:"synthetic-operation",task_id:"missing-synthetic-task",actor_profile_id:null,create_if_missing:false,status:"processing",result:null}];fixture.state.afterTaskRead=async()=>vi.stubEnv("CRON_SECRET","changed-after-projection-work");}
 const route=await fixture.route();const response=await route.GET(fixture.request());const claim=fixture.state.calls.find(call=>call.path===(family==="planning"?"claim_github_planning_webhook_delivery":"claim_planning_github_projection_requests"));
 expect(fixture.state.finalized).toHaveLength(1);expect(fixture.state.finalized[0]).toMatchObject(family==="planning"?{p_delivery_id:"synthetic-planning-job",p_lock_token:claim.body.p_lock_token,p_status:"ignored",p_status_reason:"app_projection"}:{p_request_id:"synthetic-projection-job",p_lock_token:claim.body.p_lock_token,p_succeeded:true});expect(response.status).toBe(500);
});

test.each([["SUPABASE_SERVICE_ROLE_KEY","changed-synthetic-service"],["NEXT_PUBLIC_SUPABASE_URL","https://changed-storage.example.test"]])("confirmed claim bookkeeping cannot dispatch old credentials after a %s change",async(name,value)=>{
 fixture.state.commentClaim=true;fixture.state.afterApply=async()=>vi.stubEnv(name,value);const route=await fixture.route();const response=await route.GET(fixture.request());
 expect(fixture.state.applied).toHaveLength(1);expect(fixture.state.finalized).toHaveLength(0);expect(response.status).toBe(500);expect(await response.json()).toEqual({error:"GitHub-Webhook-Ereignisse konnten nicht verarbeitet werden."});
});

test("late installation access cannot renew the original known claim deadline",async()=>{
 vi.useFakeTimers();const now=new Date("2026-10-17T10:00:00Z").getTime();vi.setSystemTime(now);const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});vi.stubEnv("GITHUB_APP_ID","123");vi.stubEnv("GITHUB_APP_INSTALLATION_ID","42");vi.stubEnv("GITHUB_APP_PRIVATE_KEY",privateKey.export({type:"pkcs8",format:"pem"}));fixture.state.commentClaim=true;fixture.state.commentAction="edited";fixture.state.beforeToken=async()=>vi.setSystemTime(now+120000);
 const route=await fixture.route();const response=await route.GET(fixture.request());expect(fixture.state.providerRequests).toHaveLength(0);expect(fixture.state.finalized).toMatchObject([{p_delivery_id:"synthetic-comment-ready",p_status:"retry_scheduled"}]);expect(response.status).toBe(200);
});


test.each(["begin","provider"])("Cron replacement after confirmed projection %s retains exact task bookkeeping",async(stage)=>{
 const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});vi.stubEnv("GITHUB_APP_ID","123");vi.stubEnv("GITHUB_APP_INSTALLATION_ID","42");vi.stubEnv("GITHUB_APP_PRIVATE_KEY",privateKey.export({type:"pkcs8",format:"pem"}));
 fixture.state.fullProjection=true;fixture.state.queueIds=[];fixture.state.rotateAfterProjectionBegin=stage==="begin";fixture.state.rotateAfterProjectionProvider=stage==="provider";
 fixture.state.projectionRows=[{id:"b1111111-1111-4111-8111-111111111111",task_id:"projection-task",status:"processing",actor_profile_id:"actor-1",create_if_missing:false}];
 const route=await fixture.route();const response=await route.GET(fixture.request());
 expect(fixture.state.calls.filter(call=>call.path==="begin_github_issue_sync_transaction_v2")).toHaveLength(1);
 expect(fixture.state.calls.filter(call=>call.path==="release_github_issue_sync_lock").map(call=>call.body)).toEqual([{p_resource_key:"github:findmydoc-platform/management#7",p_lock_token:"confirmed-task-lock"}]);
 if(stage==="begin")expect(fixture.state.providerRequests).toEqual([]);
 else {expect(fixture.state.providerRequests.filter(call=>call.method==="PATCH")).toHaveLength(1);expect(fixture.state.projectionProviderConfirmed).toBe(true);expect(fixture.state.calls.filter(call=>call.path==="finalize_github_issue_sync_with_pull_requests_v1").map(call=>call.body)).toEqual([expect.objectContaining({p_task_id:"projection-task",p_expected_updated_at:"confirmed-pending-revision"})]);}
 expect(response.status).toBe(500);
});


test("an unrelated reclaimed batch member cannot block the independently valid current projection",async()=>{
 const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});vi.stubEnv("GITHUB_APP_ID","123");vi.stubEnv("GITHUB_APP_INSTALLATION_ID","42");vi.stubEnv("GITHUB_APP_PRIVATE_KEY",privateKey.export({type:"pkcs8",format:"pem"}));fixture.state.fullProjection=true;fixture.state.queueIds=[];
 const first="b1111111-1111-4111-8111-111111111111",other="b2222222-2222-4222-8222-222222222222";fixture.state.projectionRows=[first,other].map(id=>({id,task_id:"projection-task",status:"processing",actor_profile_id:"actor-1",create_if_missing:false}));
 fixture.state.beforeToken=async()=>fixture.state.liveClaims.delete("planning_github_projection_outbox:"+other);
 const route=await fixture.route();await route.GET(fixture.request());expect(fixture.state.providerRequests.filter(call=>call.method==="PATCH")).toHaveLength(1);expect(fixture.state.finalized).toEqual(expect.arrayContaining([expect.objectContaining({p_request_id:first,p_succeeded:true}),expect.objectContaining({p_request_id:other,p_succeeded:false})]));
});

test("a slow claim response cannot renew the Cron-observed original job lease",async()=>{
 vi.useFakeTimers();const now=new Date("2026-10-17T10:00:00Z").getTime();vi.setSystemTime(now);const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});vi.stubEnv("GITHUB_APP_ID","123");vi.stubEnv("GITHUB_APP_INSTALLATION_ID","42");vi.stubEnv("GITHUB_APP_PRIVATE_KEY",privateKey.export({type:"pkcs8",format:"pem"}));fixture.state.commentClaim=true;fixture.state.commentAction="edited";
 fixture.state.afterCommentClaim=async()=>{vi.setSystemTime(now+119000);fixture.state.liveClaims.get("github_webhook_deliveries:synthetic-comment-ready").locked_at=new Date().toISOString();};fixture.state.beforeToken=async()=>vi.setSystemTime(now+120000);
 const route=await fixture.route();await route.GET(fixture.request());expect(fixture.state.providerRequests).toHaveLength(0);expect(fixture.state.finalized).toMatchObject([{p_delivery_id:"synthetic-comment-ready",p_status:"retry_scheduled"}]);
});


test.each([["SUPABASE_SERVICE_ROLE_KEY","replacement-synthetic-service"],["NEXT_PUBLIC_SUPABASE_URL","https://replacement-storage.example.test"]])("confirmed projection bookkeeping retains database binding after %s replacement",async(name,value)=>{
 const {privateKey}=generateKeyPairSync("rsa",{modulusLength:2048});vi.stubEnv("GITHUB_APP_ID","123");vi.stubEnv("GITHUB_APP_INSTALLATION_ID","42");vi.stubEnv("GITHUB_APP_PRIVATE_KEY",privateKey.export({type:"pkcs8",format:"pem"}));fixture.state.fullProjection=true;fixture.state.queueIds=[];fixture.state.afterProjectionProvider=async()=>vi.stubEnv(name,value);
 fixture.state.projectionRows=[{id:"b1111111-1111-4111-8111-111111111111",task_id:"projection-task",status:"processing",actor_profile_id:"actor-1",create_if_missing:false}];const route=await fixture.route();const response=await route.GET(fixture.request());
 expect(fixture.state.projectionProviderConfirmed).toBe(true);expect(fixture.state.providerRequests.filter(call=>call.method==="PATCH")).toHaveLength(1);expect(fixture.state.calls.filter(call=>["finalize_github_issue_sync_with_pull_requests_v1","release_github_issue_sync_lock","finalize_planning_github_projection_request"].includes(call.path))).toEqual([]);expect(response.status).toBe(500);
});
