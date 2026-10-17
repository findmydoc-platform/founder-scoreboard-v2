import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {importTestModule} from "../../helpers/vitest-module.mjs";
import {notificationDeliveryProtocol} from "../../helpers/notification-delivery-protocol.mjs";
let fixture;
beforeEach(()=>{vi.resetModules();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));fixture=notificationDeliveryProtocol();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
const digest=()=>importTestModule("src/app/api/notifications/generate-digest/route.ts",{"server-only":{}});
const reconciliation=()=>importTestModule("src/app/api/github-comments/reconcile/route.ts",{"server-only":{}});
const request=(path,body={},secret)=>fixture.request(body,secret?{"x-founderops-delivery-secret":secret}:{});
test.each(["ceo","deputy"])("digest generation retains the %s role alternative",async role=>{
 fixture.state.role=role;fixture.state.snapshot={eligible:false,active:false,expiresAt:null};const api=await digest();const response=await api.POST(request("generate-digest"));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true,created:0});
});
test("digest generation does not substitute active administrator for operational lead",async()=>{
 const api=await digest();const response=await api.POST(request("generate-digest"));expect(response.status).toBe(403);expect(fixture.delivery.created).toBeUndefined();
});
test("a delivery secret can generate a bounded reminder without a human session",async()=>{
 fixture.delivery.tasks=[{id:"synthetic-task",title:"Synthetic deliverable",description:null,status:"Offen",priority:null,assignee:"synthetic-recipient",owner:null,fixed_date:"2026-10-16",review_status:null,review_owner_profile_id:null,task_type:"deliverable",score_relevant:true,score_final:false,approval_status:"approved"}];
 const api=await digest();const response=await api.POST(request("generate-digest",{limit:1},"synthetic-delivery-secret"));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({considered:1,created:1});expect(fixture.delivery.created).toMatchObject([{type:"task.deadline_overdue",entity_id:"synthetic-task",recipient_profile_id:"synthetic-recipient"}]);
});
test("digest dry run cannot create or mark reminders",async()=>{
 fixture.delivery.tasks=[{id:"synthetic-task",title:"Synthetic",status:"Offen",assignee:"synthetic-recipient",task_type:"deliverable",fixed_date:"2026-10-16"}];
 const api=await digest();const response=await api.POST(request("generate-digest",{dryRun:true},"synthetic-delivery-secret"));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({dryRun:true,created:0,considered:1});expect(fixture.delivery.created).toBeUndefined();expect(fixture.delivery.marked).toBeUndefined();
});
test("changing the delivery secret during digest reads prevents the later insert",async()=>{
 fixture.delivery.tasks=[{id:"synthetic-task",title:"Synthetic",status:"Offen",assignee:"synthetic-recipient",task_type:"deliverable",fixed_date:"2026-10-16"}];
 fixture.delivery.beforeRest=async path=>{if(path==="active_tasks")vi.stubEnv("FOUNDEROPS_DELIVERY_SECRET","rotated-secret");};
 const api=await digest();const response=await api.POST(request("generate-digest",{},"synthetic-delivery-secret"));expect(response.status).toBe(401);expect(fixture.delivery.created).toBeUndefined();
});
test.each(["GET","POST"])("GitHub reconciliation %s accepts its delivery secret with fixed limits",async method=>{
 const api=await reconciliation();const response=await api[method](request("reconcile",{},"synthetic-delivery-secret"));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true});
 if(method==="POST")expect(fixture.delivery.database.filter(call=>call.path.startsWith("claim_task_")).map(call=>call.body)).toMatchObject([{p_limit:100,p_task_id:null,p_author_profile_id:null},{p_limit:100,p_task_id:null,p_author_profile_id:null}]);
});
test.each(["ceo","deputy"])("GitHub reconciliation retains %s without administrator activation",async role=>{
 fixture.state.role=role;fixture.state.snapshot={eligible:false,active:false,expiresAt:null};const api=await reconciliation();const response=await api.POST(request("reconcile"));expect(response.status).toBe(200);
});
test("GitHub reconciliation denies founder despite active administrator access",async()=>{
 const api=await reconciliation();const response=await api.POST(request("reconcile"));expect(response.status).toBe(403);expect(fixture.delivery.database.some(call=>call.path.startsWith("claim_task_"))).toBe(false);
});
test("a changed reconciliation trigger cannot start the next review claim",async()=>{
 fixture.delivery.beforeRest=async path=>{if(path==="claim_task_comment_github_deliveries")vi.stubEnv("FOUNDEROPS_DELIVERY_SECRET","rotated-secret");};
 const api=await reconciliation();const response=await api.POST(request("reconcile",{},"synthetic-delivery-secret"));expect(response.status).toBe(401);expect(fixture.delivery.database.filter(call=>call.path.startsWith("claim_task_")).map(call=>call.path)).toEqual(["claim_task_comment_github_deliveries"]);
});

test("GitHub preview cannot be rebound to a claim-producing action during admission",async()=>{
 const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
 const input={credential:{kind:"notification-delivery-request",request:fixture.pipeline()},action:"github.reconciliation.preview"};
 const pending=authorizeCredentialAction(input);input.action="github.reconciliation.deliver";const permission=await pending;
 expect(permission.reconciliation).toHaveProperty("preview");expect(permission.reconciliation).not.toHaveProperty("comments");
});

test("the bounded digest storage capability cannot publish a different notification family",async()=>{
 fixture.delivery.tasks=[{id:"synthetic-task",title:"Synthetic",assignee:"synthetic-recipient"}];const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
 const permission=await authorizeCredentialAction({credential:{kind:"notification-delivery-request",request:fixture.pipeline()},action:"notifications.digest.generate",dryRun:false,limit:1});await permission.digest.sources();await permission.digest.existing(["synthetic-key"]);
 await expect(permission.digest.create([{type:"platform_release.published",actorProfileId:null,recipientProfileId:null,entityType:"task",entityId:"synthetic-task",title:"Forbidden",body:"Forbidden",dedupeKey:"synthetic-key"}])).rejects.toMatchObject({status:403});expect(fixture.delivery.created).toBeUndefined();
});
