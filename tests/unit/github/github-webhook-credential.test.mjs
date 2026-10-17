import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {createHmac} from "node:crypto";
import {githubWebhookProtocol,webhookPayload,webhookSecret} from "../../helpers/github-webhook-protocol.mjs";
let fixture;
beforeEach(()=>{vi.resetModules();fixture=githubWebhookProtocol();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
test("secret rotation while the signed request body waits prevents a new persisted delivery",async()=>{
 const raw=fixture.raw();let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
 const stream=new ReadableStream({async pull(controller){started();await gate;controller.enqueue(raw);controller.close();}});
 const request=new Request("https://app.example.test/api/github/webhooks",{method:"POST",duplex:"half",headers:{"content-type":"application/json","x-github-delivery":"synthetic-held-delivery","x-github-event":"issues","x-hub-signature-256":`sha256=${createHmac("sha256",webhookSecret).update(raw).digest("hex")}`},body:stream});
 const route=await fixture.route();const pending=route.POST(request);await entered;vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET","rotated-synthetic-secret");release();const response=await pending;
 expect(fixture.state.rows.size).toBe(0);expect(response.status).toBe(503);expect(fixture.state.after).toHaveLength(0);
});

test("valid signed intake reaches the real public seam and defers its exact persisted job",async()=>{
 const route=await fixture.route();const response=await route.POST(fixture.request());expect(response.status).toBe(202);expect(await response.json()).toEqual({ok:true,accepted:true});expect(fixture.state.rows.size).toBe(1);expect(fixture.state.after).toHaveLength(1);expect(fixture.state.calls.some(call=>call.path.startsWith("claim_"))).toBe(false);
 await fixture.state.after.shift()();expect(fixture.state.calls.find(call=>call.path.startsWith("claim_"))).toMatchObject({path:"claim_github_planning_webhook_delivery",body:{p_delivery_id:"synthetic-delivery",p_lease_seconds:120}});
});
test.each(["secret","installation","storage-key","storage-url"])("missing %s configuration cannot admit a delivery",async mode=>{
 const names=mode==="secret"?["GITHUB_APP_WEBHOOK_SECRET"]:mode==="installation"?["GITHUB_APP_INSTALLATION_ID"]:mode==="storage-key"?["SUPABASE_SERVICE_ROLE_KEY","SUPABASE_SECRET_KEY"]:["NEXT_PUBLIC_SUPABASE_URL","SUPABASE_URL"];for(const name of names)vi.stubEnv(name,"");const route=await fixture.route();const response=await route.POST(fixture.request());expect(response.status).toBe(503);expect(fixture.state.calls).toHaveLength(0);expect(fixture.state.after).toHaveLength(0);
});
test.each([["x-hub-signature-256",401],["x-github-event",400],["x-github-delivery",400]])("missing %s header retains its denial contract",async(name,status)=>{
 const request=fixture.request();request.headers.delete(name);const route=await fixture.route();const response=await route.POST(request);expect(response.status).toBe(status);expect(fixture.state.rows.size).toBe(0);
});
test("a prior authentic payload cannot authorize modified bytes or a wrong signature",async()=>{
 const route=await fixture.route();const original=fixture.request();expect((await route.POST(original)).status).toBe(202);
 const wrong=fixture.request(webhookPayload(),{"x-github-delivery":"forged-delivery","x-hub-signature-256":"sha256="+"0".repeat(64)});expect((await route.POST(wrong)).status).toBe(401);
 const changed=new Request("https://app.example.test/api/github/webhooks",{method:"POST",headers:original.headers,body:fixture.raw().toString()+" "});const response=await route.POST(changed);expect(response.status).toBe(401);expect(fixture.state.rows.size).toBe(1);expect(fixture.state.after).toHaveLength(1);
});
test("signature verification precedes JSON parsing",async()=>{
 const route=await fixture.route();const invalid=await route.POST(fixture.request("not-json",{"x-hub-signature-256":"sha256="+"0".repeat(64)}));expect(invalid.status).toBe(401);expect(await invalid.json()).toMatchObject({code:"github_webhook_unauthorized"});const signed=await route.POST(fixture.request("not-json"));expect(signed.status).toBe(400);expect(fixture.state.rows.size).toBe(0);
});
test.each([[{zen:"Synthetic ping"},"ping",200],["not-json","pull_request",204]])("ping and unsupported signed event preserve their inert response",async(payload,event,status)=>{
 const route=await fixture.route();const response=await route.POST(fixture.request(payload,{"x-github-event":event}));expect(response.status).toBe(status);expect(fixture.state.calls).toHaveLength(0);expect(fixture.state.after).toHaveLength(0);
});
test.each(["installation","repository","organization"])("a forbidden %s cannot inherit a prior accepted signature decision",async target=>{
 const route=await fixture.route();expect((await route.POST(fixture.request())).status).toBe(202);
 const payload=target==="installation"?webhookPayload({installation:{id:43}}):target==="repository"?webhookPayload({repository:{id:999,full_name:"outside/forbidden"}}):{action:"created",organization:{id:607,login:"synthetic-org"},installation:{id:42},projects_v2_item:{node_id:"PVTI_synthetic",project_node_id:"PVT_synthetic",content_node_id:"I_synthetic",content_type:"Issue",updated_at:"2026-10-17T10:00:00Z"}};
 const response=await route.POST(fixture.request(payload,{"x-github-delivery":"forbidden-delivery","x-github-event":target==="organization"?"projects_v2_item":"issues"}));expect(response.status).toBe(403);expect(fixture.state.rows.size).toBe(1);expect(fixture.state.after).toHaveLength(1);
});
test.each([["text/plain",415],["text/application/json-evil",415]])("unsupported %s content type is rejected before persistence",async(type,status)=>{
 const route=await fixture.route();const response=await route.POST(fixture.request(webhookPayload(),{"content-type":type}));expect(response.status).toBe(status);expect(fixture.state.calls).toHaveLength(0);
});
test.each([["invalid",400],["2097153",413]])("declared length %s is rejected before persistence",async(length,status)=>{
 const route=await fixture.route();const response=await route.POST(fixture.request(webhookPayload(),{"content-length":length}));expect(response.status).toBe(status);expect(fixture.state.calls).toHaveLength(0);
});
test("an oversized undeclared stream remains bounded",async()=>{
 const route=await fixture.route();const response=await route.POST(fixture.request("x".repeat(2097153)));expect(response.status).toBe(413);expect(fixture.state.calls).toHaveLength(0);
});
test("unreadable streams retain the safe invalid-payload response",async()=>{
 const request=new Request("https://app.example.test/api/github/webhooks",{method:"POST",duplex:"half",headers:{"content-type":"application/json"},body:new ReadableStream({start(controller){controller.error(new Error("Sensitive stream detail"));}})});const route=await fixture.route();const response=await route.POST(request);expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:"github_webhook_invalid_payload"});expect(fixture.state.calls).toHaveLength(0);
});
test("captured event headers cannot be rebound while the request body waits",async()=>{
 const raw=fixture.raw();let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
 const request=fixture.request();const headers=new Headers(request.headers);const held=new Request(request.url,{method:"POST",duplex:"half",headers,body:new ReadableStream({async pull(controller){started();await gate;controller.enqueue(raw);controller.close();}})});
 const route=await fixture.route();const pending=route.POST(held);await entered;held.headers.set("x-github-delivery","mutated-delivery");held.headers.set("x-github-event","issue_comment");held.headers.set("x-hub-signature-256","sha256="+"0".repeat(64));release();const response=await pending;expect(response.status).toBe(202);expect([...fixture.state.rows.values()][0]).toMatchObject({delivery_id:"synthetic-delivery",event_name:"issues"});expect(fixture.state.rows.has("github_webhook_deliveries:mutated-delivery")).toBe(false);
});
test.each([["GITHUB_APP_INSTALLATION_ID","43"],["GITHUB_WEBHOOK_ORGANIZATION_ID","607"],["SUPABASE_SERVICE_ROLE_KEY","changed-synthetic-service"],["NEXT_PUBLIC_SUPABASE_URL","https://changed-storage.example.test"]])("a late %s change cannot authorize a new receipt",async(name,value)=>{
 const raw=fixture.raw();let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});const original=fixture.request();const request=new Request(original.url,{method:"POST",duplex:"half",headers:original.headers,body:new ReadableStream({async pull(controller){started();await gate;controller.enqueue(raw);controller.close();}})});
 const route=await fixture.route();const pending=route.POST(request);await entered;vi.stubEnv(name,value);release();const response=await pending;expect(response.status).toBe(503);expect(fixture.state.rows.size).toBe(0);expect(fixture.state.after).toHaveLength(0);
});
test("already persisted acceptance retains its independent exact job after secret rotation",async()=>{
 fixture.state.claim=true;fixture.state.afterInsert=async()=>vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET","rotated-after-persist");const route=await fixture.route();const response=await route.POST(fixture.request());expect(response.status).toBe(202);await fixture.state.after.shift()();expect(fixture.state.finalized).toMatchObject([{p_delivery_id:"synthetic-delivery",p_status:"ignored",p_status_reason:"task_not_found"}]);
});
test("repeated accepted comment deliveries claim and apply the domain effect only once",async()=>{
 fixture.state.claim=true;fixture.state.taskMapping=true;const payload=webhookPayload({action:"deleted",comment:{id:404,node_id:"IC_synthetic",updated_at:"2026-10-17T10:01:00Z"}});const route=await fixture.route();expect((await route.POST(fixture.request(payload,{"x-github-event":"issue_comment"}))).status).toBe(202);await fixture.state.after.shift()();expect(fixture.state.applied).toMatchObject([{p_delivery_id:"synthetic-delivery",p_operation:"delete",p_task_id:"synthetic-task"}]);
 expect((await route.POST(fixture.request(payload,{"x-github-event":"issue_comment"}))).status).toBe(200);await fixture.state.after.shift()();expect(fixture.state.applied).toHaveLength(1);expect(fixture.state.finalized).toHaveLength(1);
});

test("stream chunks are copied before a later read can mutate their backing buffer",async()=>{
 const original=fixture.raw(),first=Buffer.from(original.subarray(0,20)),second=Buffer.from(original.subarray(20));let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});let reads=0;
 const signed=fixture.request();const request=new Request(signed.url,{method:"POST",duplex:"half",headers:signed.headers,body:new ReadableStream({async pull(controller){if(reads++===0){controller.enqueue(first);return;}started();await gate;controller.enqueue(second);controller.close();}},{highWaterMark:0})});
 const route=await fixture.route();const pending=route.POST(request);await entered;first.fill(32);release();const response=await pending;expect(response.status).toBe(202);expect([...fixture.state.rows.values()][0]).toMatchObject({delivery_id:"synthetic-delivery",action:"edited"});
});
test("the public accepted capability dispatches only its original persisted identity once",async()=>{
 const {importTestModule}=await import("../../helpers/vitest-module.mjs");const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});const input={credential:{kind:"github-webhook-request",request:fixture.request()},action:"github.webhook.accept"};const accepted=await authorizeCredentialAction(input);expect(accepted.kind).toBe("accepted");accepted.delivery.deliveryId="forged-followup";accepted.delivery.eventName="issue_comment";await Promise.all([accepted.dispatch(),accepted.dispatch()]);
 expect(fixture.state.calls.filter(call=>call.path.startsWith("claim_"))).toMatchObject([{path:"claim_github_planning_webhook_delivery",body:{p_delivery_id:"synthetic-delivery"}}]);expect(JSON.stringify(accepted)).not.toMatch(/synthetic-service|synthetic-webhook-secret|sha256=/);
});
test("a human credential cannot select technical webhook admission",async()=>{
 const {importTestModule}=await import("../../helpers/vitest-module.mjs");const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});expect(await authorizeCredentialAction({credential:{kind:"session-request",request:fixture.request()},action:"github.webhook.accept"})).toMatchObject({kind:"rejected",status:403});expect(fixture.state.rows.size).toBe(0);
});

test("a live secret change during the duplicate response prevents a further storage request",async()=>{
 const route=await fixture.route();expect((await route.POST(fixture.request())).status).toBe(202);fixture.state.after.length=0;fixture.state.calls.length=0;fixture.state.beforeDuplicate=async()=>vi.stubEnv("GITHUB_APP_WEBHOOK_SECRET","changed-during-reconciliation");
 const response=await route.POST(fixture.request());expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:"github_webhook_unavailable"});expect(fixture.state.calls).toHaveLength(1);expect(fixture.state.calls[0].method).toBe("POST");expect(fixture.state.rows.size).toBe(1);expect(fixture.state.after).toHaveLength(0);
});
