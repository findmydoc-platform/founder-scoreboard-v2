import {afterEach,beforeEach,expect,test,vi} from "vitest";
import {importTestModule} from "../../helpers/vitest-module.mjs";
import {notificationDeliveryProtocol} from "../../helpers/notification-delivery-protocol.mjs";
let fixture;
beforeEach(()=>{vi.resetModules();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));fixture=notificationDeliveryProtocol();});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
const route=()=>importTestModule("src/app/api/notifications/deliver/route.ts",{"server-only":{}});
const seam=()=>importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
test("invalid supplied delivery secret cannot fall back to an active administrator",async()=>{
 const api=await route();const response=await api.POST(fixture.request({}, {"x-founderops-delivery-secret":"wrong"}));
 expect(response.status).toBe(401);expect(fixture.delivery.messages).toHaveLength(0);expect(fixture.delivery.database).toHaveLength(0);
});
test("active administrator claims a normalized exact selection using the user credential",async()=>{
 fixture.delivery.emptyClaim=true;const api=await route();const response=await api.POST(fixture.request({eventIds:[7,7,"8",-1],limit:99}));
 expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true,sent:0,failed:0,skipped:0,results:[]});
 const claim=fixture.delivery.database.find(call=>call.path==="claim_notification_delivery");
 expect(claim.body).toEqual({p_event_ids:[7,8],p_limit:50,p_test_delivery:null,p_recipient_profile_id:null});expect(claim.authorization).not.toBe("Bearer synthetic-service");
});
test("pipeline claims the same bounded contract without session authority",async()=>{
 fixture.delivery.emptyClaim=true;const api=await route();const response=await api.POST(fixture.pipeline({eventIds:[11],limit:1}));
 expect(response.status).toBe(200);expect(fixture.delivery.database.find(call=>call.path==="claim_notification_delivery")).toMatchObject({authorization:"Bearer synthetic-service",body:{p_event_ids:[11],p_limit:1}});
});
test("active administrator delivers and finalizes its own exact claim",async()=>{
 const api=await route();const response=await api.POST(fixture.request());expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({sent:1,failed:0});expect(fixture.delivery.messages).toHaveLength(1);expect(fixture.delivery.finalized).toEqual([{p_claim_token:"synthetic-claim-1",p_event_ids:[7]}]);
});
test.each(["inactive","expired","ineligible"])("%s administrator cannot reserve or send",async mode=>{
 fixture.state.snapshot=mode==="ineligible"?{eligible:false,active:false,expiresAt:null}:{eligible:true,active:mode!=="inactive",expiresAt:mode==="expired"?new Date(Date.now()-1).toISOString():null};
 const api=await route();const response=await api.POST(fixture.request());expect(response.status).toBe(403);expect(fixture.delivery.messages).toHaveLength(0);expect(fixture.delivery.database.some(call=>call.path==="claim_notification_delivery")).toBe(false);
});
test("personal planning token cannot inherit administrator activation",async()=>{
 const api=await route();const response=await api.POST(fixture.request({}, {authorization:"Bearer fmd_pat_synthetic"}));expect(response.status).toBe(401);expect(fixture.delivery.messages).toHaveLength(0);
});
test("inspection accepts an active administrator but never a delivery secret alone",async()=>{
 const api=await route();const response=await api.GET(fixture.request());
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({pending:3});
 const denied=await api.GET(new Request("https://app.example.test/api/notifications/deliver",{headers:{"x-founderops-delivery-secret":"synthetic-delivery-secret"}}));expect(denied.status).toBe(401);
});
test.each(["expiry","ending"])("administrator %s during outgoing token acquisition stops the send",async mode=>{
 fixture.state.snapshot.expiresAt=new Date(Date.now()+1000).toISOString();fixture.delivery.delayToken=async()=>{if(mode==="expiry")vi.setSystemTime(Date.now()+1000);else fixture.state.snapshot={eligible:true,active:false,expiresAt:null};};
 const api=await route();const response=await api.POST(fixture.request());expect(response.status).toBe(403);expect(fixture.delivery.messages).toHaveLength(0);expect(await response.json()).toMatchObject({failed:1,code:"administrator_access_expired"});
});
test("a new activation cannot extend the original administrator deadline",async()=>{
 fixture.state.snapshot.expiresAt=new Date(Date.now()+1000).toISOString();fixture.delivery.delayToken=async()=>{vi.setSystemTime(Date.now()+1000);fixture.state.snapshot.expiresAt=new Date(Date.now()+3600000).toISOString();};
 const api=await route();const response=await api.POST(fixture.request());expect(response.status).toBe(403);expect(fixture.delivery.messages).toHaveLength(0);
});
test("confirmed provider success is recorded after the administrator ends access",async()=>{
 fixture.delivery.chatResponse=async()=>{fixture.state.snapshot={eligible:true,active:false,expiresAt:null};return Response.json({name:"spaces/synthetic/messages/synthetic"});};
 const api=await route();const response=await api.POST(fixture.request());expect(response.status).toBe(200);expect(fixture.delivery.records).toMatchObject([{event_id:7,status:"sent"}]);expect(fixture.delivery.finalized).toHaveLength(1);
});
test("terminally skipped events finalize the exact reservation",async()=>{
 fixture.delivery.events[0].type="in_app_only";const api=await route();const response=await api.POST(fixture.request());expect(response.status).toBe(200);expect(await response.json()).toMatchObject({sent:0,skipped:1});expect(fixture.delivery.finalized[0].p_event_ids).toEqual([7]);
});
test("event read failure releases the original claim before any provider send",async()=>{
 fixture.delivery.storageError="notification_events";const api=await route();const response=await api.POST(fixture.request());expect(response.status).toBe(500);expect(fixture.delivery.released).toEqual([{p_claim_token:"synthetic-claim-1"}]);expect(fixture.delivery.messages).toHaveLength(0);
});
test.each(["owner","token","expiry"])("foreign or expired %s claim prevents dispatch",async mode=>{
 fixture.delivery.beforeRest=async path=>{if(path!=="notification_delivery_claims")return;for(const claim of fixture.delivery.claims){if(mode==="owner")claim.claimed_by_profile_id="foreign-profile";if(mode==="token")claim.claim_token="foreign-token";if(mode==="expiry")claim.expires_at=new Date(Date.now()-1).toISOString();}};
 const api=await route();const response=await api.POST(fixture.request());expect(response.status).toBe(409);expect(fixture.delivery.messages).toHaveLength(0);expect(fixture.delivery.finalized).toHaveLength(0);
});
test("a mismatched finalization count is rejected without replaying the confirmed message",async()=>{
 fixture.delivery.finalizeCount=0;const api=await route();const response=await api.POST(fixture.request());expect(response.status).toBe(409);expect(fixture.delivery.messages).toHaveLength(1);expect(fixture.delivery.finalized[0].p_event_ids).toEqual([7]);
});
test("a bound delivery capability cannot replay or substitute event IDs",async()=>{
 const {authorizeCredentialAction}=await seam();const selected={eventIds:[7]};const permission=await authorizeCredentialAction({credential:{kind:"notification-delivery-request",request:fixture.request()},action:"notifications.delivery.run",selection:selected});selected.eventIds=[99];
 const reservation=await permission.delivery.reserve();expect(await permission.delivery.reserve()).toBe(reservation);const claim=reservation.claim;await claim.load();
 await expect(claim.send("direct_dm","spaces/synthetic-dm",[99],{text:"Forbidden"})).rejects.toMatchObject({status:409});
 await claim.send("direct_dm","spaces/synthetic-dm",[7],{text:"Synthetic confirmed send"});await expect(claim.send("direct_dm","spaces/synthetic-dm",[7],{text:"Forbidden replay"})).rejects.toMatchObject({status:409});expect(fixture.delivery.messages).toHaveLength(1);
});
test("target changes while Chat token issuance waits cannot redirect the claimed event",async()=>{
 fixture.delivery.delayToken=async()=>{fixture.delivery.profiles[0].google_chat_dm_space="spaces/changed";};const api=await route();const response=await api.POST(fixture.request());expect(response.status).toBe(409);expect(fixture.delivery.messages).toHaveLength(0);
});

test("concurrent triggers cannot borrow another request's live admission or leak it to a later delivery",async()=>{
 const api=await route();fixture.delivery.events.push({...fixture.delivery.events[0],id:8});
 let release;const gate=new Promise(resolve=>{release=resolve;});fixture.delivery.delayToken=()=>gate;
 const old=api.POST(fixture.pipeline({eventIds:[7]}));
 for(let n=0;n<200&&fixture.delivery.tokens===0;n++)await new Promise(resolve=>setImmediate(resolve));
 expect(fixture.delivery.tokens).toBe(1);vi.stubEnv("FOUNDEROPS_DELIVERY_SECRET","rotated-secret");
 const current=api.POST(fixture.pipeline({eventIds:[8]},"rotated-secret"));
 for(let n=0;n<200&&fixture.delivery.claims.length<2;n++)await new Promise(resolve=>setImmediate(resolve));
 expect(fixture.delivery.claims).toHaveLength(2);release();
 const [expired,valid]=await Promise.all([old,current]);expect(expired.status).toBe(401);expect(valid.status).toBe(200);expect(fixture.delivery.messages).toHaveLength(1);
 const {authorizeCredentialAction}=await seam();const unscoped=await authorizeCredentialAction({credential:{kind:"google-chat-bot"},action:"google-chat.space.deliver",target:"spaces/later-job"});await unscoped.chat.send({text:"Independent job"});expect(fixture.delivery.messages).toHaveLength(2);
});

test("original administrator expiry reached during final claim-session validation prevents a new claim",async()=>{
 fixture.state.snapshot.expiresAt=new Date(Date.now()+1000).toISOString();const {authorizeCredentialAction}=await seam();
 const permission=await authorizeCredentialAction({credential:{kind:"notification-delivery-request",request:fixture.request()},action:"notifications.delivery.run",selection:{eventIds:[7]}});
 expect(permission.ok).toBe(true);fixture.delivery.beforeRest=async path=>{if(path==="administrator_access_snapshot")fixture.delivery.afterAuth=async()=>vi.setSystemTime(Date.now()+1000);};
 await expect(permission.delivery.reserve()).rejects.toMatchObject({status:403,code:"administrator_access_expired"});expect(fixture.delivery.database.some(call=>call.path==="claim_notification_delivery")).toBe(false);
});
test("an expired lease cannot acquire a new deadline while outgoing token issuance waits",async()=>{
 fixture.delivery.delayToken=async()=>{vi.setSystemTime(Date.now()+600000);for(const row of fixture.delivery.claims)row.expires_at=new Date(Date.now()+3600000).toISOString();};
 const api=await route();const response=await api.POST(fixture.pipeline());expect(response.status).toBe(409);expect(fixture.delivery.messages).toHaveLength(0);
});
test("confirmed delivery bookkeeping survives its lease deadline without granting a new send",async()=>{
 fixture.delivery.chatResponse=async()=>{vi.setSystemTime(Date.now()+600000);return Response.json({name:"spaces/synthetic/messages/synthetic"});};
 const api=await route();const response=await api.POST(fixture.pipeline());expect(response.status).toBe(200);expect(fixture.delivery.records).toMatchObject([{event_id:7,status:"sent"}]);expect(fixture.delivery.finalized).toHaveLength(1);expect(fixture.delivery.messages).toHaveLength(1);
});
test("storage failure after confirmed send cannot retry the provider mutation",async()=>{
 fixture.delivery.storageError="notification_deliveries";let reads=0;fixture.delivery.beforeRest=async path=>{if(path==="notification_deliveries"&&++reads===1)fixture.delivery.storageError=null;};
 fixture.delivery.chatResponse=async()=>{fixture.delivery.storageError="notification_deliveries";return Response.json({name:"spaces/synthetic/messages/synthetic"});};
 const api=await route();const response=await api.POST(fixture.pipeline());expect(response.status).toBe(500);expect(fixture.delivery.messages).toHaveLength(1);expect(fixture.delivery.finalized).toHaveLength(0);expect(JSON.stringify(await response.json())).not.toContain("Sensitive database detail");
});

test("technical delivery credentials cannot authorize human administrator actions",async()=>{
 const {authorizeCredentialAction}=await seam();
 expect(await authorizeCredentialAction({credential:{kind:"notification-delivery-request",request:fixture.pipeline()},action:"administration.technical"})).toMatchObject({ok:false,status:403});
 expect(await authorizeCredentialAction({credential:{kind:"google-chat-bot"},action:"notifications.delivery.run",selection:{eventIds:[7]}})).toMatchObject({ok:false,status:403});expect(fixture.delivery.messages).toHaveLength(0);
});

test("inspection cannot be rebound to delivery while session admission waits",async()=>{
 const {authorizeCredentialAction}=await seam();const input={credential:{kind:"notification-delivery-request",request:fixture.request()},action:"notifications.delivery.inspect"};
 const pending=authorizeCredentialAction(input);input.action="notifications.delivery.run";input.selection={eventIds:[7]};
 const permission=await pending;expect(permission.ok).toBe(true);expect(permission).toHaveProperty("inspection");expect(permission).not.toHaveProperty("delivery");expect(fixture.delivery.database.some(call=>call.path==="claim_notification_delivery")).toBe(false);
});

test.each([["22023",400],["P0001",409]])("claim validation %s preserves its safe response status",async(code,status)=>{
 fixture.delivery.claimError={code,message:code==="22023"?"unsupported test delivery":"Sensitive database detail"};const api=await route();const response=await api.POST(fixture.request({testDelivery:"unsupported"}));expect(response.status).toBe(status);expect(fixture.delivery.messages).toHaveLength(0);expect(JSON.stringify(await response.json())).not.toContain("Sensitive database detail");
});
test("an atomic administrator claim rejection reports the live expired-access contract",async()=>{
 fixture.delivery.beforeRest=async path=>{if(path==="claim_notification_delivery"){fixture.state.snapshot={eligible:true,active:false,expiresAt:null};fixture.delivery.claimError={code:"42501",message:"active administrator access required"};}};
 const api=await route();const response=await api.POST(fixture.request());expect(response.status).toBe(403);expect(await response.json()).toEqual({error:"Der Adminzugang ist abgelaufen.",code:"administrator_access_expired"});expect(fixture.delivery.messages).toHaveLength(0);
});

test("a malformed reservation response cannot broaden the accepted event selection",async()=>{
 fixture.delivery.claimIds=[99];const api=await route();const response=await api.POST(fixture.pipeline({eventIds:[7]}));expect(response.status).toBe(409);expect(fixture.delivery.messages).toHaveLength(0);expect(fixture.delivery.finalized).toHaveLength(0);
});
test("confirmed delivery metadata is snapshotted before the claim-binding await",async()=>{
 const {authorizeCredentialAction}=await seam();const permission=await authorizeCredentialAction({credential:{kind:"notification-delivery-request",request:fixture.pipeline()},action:"notifications.delivery.run",selection:{eventIds:[7]}});
 const reservation=await permission.delivery.reserve(),claim=reservation.claim;const loaded=await claim.load();await claim.send("direct_dm","spaces/synthetic-dm",[7],{text:"Synthetic send"});
 let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});fixture.delivery.beforeRest=async path=>{if(path==="notification_delivery_claims"){entered();await gate;}};
 const extras={deliveryMode:"direct_dm",deliveredAt:"2026-10-17T10:00:00.000Z"};const pending=claim.record([{row:loaded.events[0],target:"spaces/synthetic-dm",payload:{id:7,title:"Synthetic event"}}],"sent",1,extras);await started;extras.deliveredAt="2099-01-01T00:00:00.000Z";extras.deliveryMode="webhook_digest";release();await pending;
 expect(fixture.delivery.records).toMatchObject([{delivered_at:"2026-10-17T10:00:00.000Z",payload:{deliveryMode:"direct_dm"}}]);
});
