import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { generateKeyPairSync, verify } from "node:crypto";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const origin = "https://chat-delivery-db.example.test";
const { privateKey, publicKey } = generateKeyPairSync("rsa", {modulusLength:2048});
const key = privateKey.export({type:"pkcs8",format:"pem"}).toString();
const event = {id:7,type:"task.mention",title:"Synthetic notification",body:"Synthetic body",entityType:"task",entityId:"synthetic-task",createdAt:"2026-10-17T10:00:00Z"};
let messageResponse, tokenStatus, chatStatus, unknownDelivery, lifetime, tokenResponse, exchanges, messages, assertions, delayToken, routeRows, profiles, deliveryRecords, databaseCalls, claimAvailable, existingDeliveries;

async function protocol(input, init) {
  const request = new Request(input,init);
  const url = new URL(request.url);
  if (url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") {
    exchanges++;
    const body = new URLSearchParams(await request.text());
    const assertion = body.get("assertion");
    const [header,payload,signature] = assertion.split(".");
    expect(verify("RSA-SHA256",Buffer.from(`${header}.${payload}`),publicKey,Buffer.from(signature,"base64url"))).toBe(true);
    assertions.push(JSON.parse(Buffer.from(payload,"base64url").toString()));
    if (delayToken) await delayToken();
    if (tokenStatus !== 200) return Response.json({error:"sensitive-token-detail"},{status:tokenStatus});
    return Response.json(tokenResponse === undefined ? {access_token:"synthetic-chat-token",expires_in:lifetime} : tokenResponse);
  }
  if (url.origin === "https://chat.googleapis.com") {
    messages.push({url,headers:request.headers,body:await request.json()});
    if (messageResponse) return messageResponse(messages.length);
    if (unknownDelivery) throw new Error("sensitive-webhook-token uncertain provider response");
    return chatStatus === 200 ? Response.json({name:"spaces/synthetic/messages/synthetic"}) : Response.json({error:"sensitive-token-detail"},{status:chatStatus});
  }
  if (url.origin === origin) {
    const body = request.method === "POST" ? await request.json() : null;
    databaseCalls.push({path:url.pathname,body});
    if (url.pathname.endsWith("/rpc/claim_notification_delivery")) return Response.json({claimToken:"synthetic-claim",eventIds:claimAvailable?routeRows.map(row=>row.id):[]});
    if (url.pathname.endsWith("/rpc/finalize_notification_delivery_claim")) {claimAvailable=false;return Response.json(body.p_event_ids.length);}
    if (url.pathname.endsWith("/rpc/release_notification_delivery_claim")) return new Response(null,{status:204});
    if (url.pathname.endsWith("/notification_delivery_claims")) return Response.json(routeRows.map(row=>({event_id:row.id,claim_token:"synthetic-claim",claimed_by_profile_id:null,claim_authority:"pipeline",expires_at:new Date(Date.now()+600000).toISOString()})));
    if (url.pathname.endsWith("/notification_events")) return Response.json(url.searchParams.get("select").includes("actor_label")?[]:routeRows);
    if (url.pathname.endsWith("/profiles")) return Response.json(profiles);
    if (url.pathname.endsWith("/notification_preferences")) return Response.json([]);
    if (url.pathname.endsWith("/notification_deliveries")) {
      if (body) {deliveryRecords.push(...body);return new Response(null,{status:201});}
      return Response.json(existingDeliveries);
    }
  }
  throw new Error("Unexpected external protocol in synthetic Chat test");
}

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers({toFake:["Date"]}); vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
  for (const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:origin,SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:"synthetic-anon",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",SUPABASE_ANON_KEY:"synthetic-anon",SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",SUPABASE_SECRET_KEY:"synthetic-service",GOOGLE_CHAT_DELIVERY_ENABLED:"true",GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL:"synthetic-chat@example.test",GOOGLE_CHAT_PRIVATE_KEY:key,GOOGLE_CHAT_WEBHOOK_URL:"https://chat.googleapis.com/v1/spaces/synthetic-webhook/messages?key=synthetic-key&token=synthetic-webhook-token",FOUNDEROPS_DELIVERY_SECRET:"synthetic-delivery-secret",APP_URL:"https://app.example.test"})) vi.stubEnv(name,value);
  messageResponse=null;tokenStatus=200;chatStatus=200;unknownDelivery=false;lifetime=3600;tokenResponse=undefined;
  exchanges=0; messages=[]; assertions=[]; delayToken=null;
  routeRows=[{id:7,type:"task.mention",actor_profile_id:null,recipient_profile_id:"synthetic-recipient",entity_type:"task",entity_id:"synthetic-task",title:event.title,body:event.body,created_at:event.createdAt}];
  profiles=[{id:"synthetic-recipient",name:"Synthetic Recipient",google_chat_dm_space:"spaces/synthetic-dm",google_chat_user_id:null,notifications_enabled:true}];
  deliveryRecords=[];databaseCalls=[];claimAvailable=true;existingDeliveries=[];
  vi.stubGlobal("fetch",protocol);
});
afterEach(() => {vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});

const delivery = () => importTestModule("src/lib/google-chat.ts",{"server-only":{}});

test("concurrent direct Chat deliveries share token issuance and keep their exact spaces",async()=>{
  const chat=await delivery();
  let release; const gate=new Promise(resolve=>{release=resolve;}); delayToken=()=>gate;
  const calls=[chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test"),chat.sendGoogleChatSpaceDigest("spaces/synthetic-b",[event],"https://app.example.test")];
  for(let attempt=0;attempt<100&&exchanges===0;attempt++)await new Promise(resolve=>setImmediate(resolve));
  delayToken=null; release();
  await Promise.all(calls);
  expect(exchanges).toBe(1);
  expect(messages.map(message=>message.url.pathname).sort()).toEqual(["/v1/spaces/synthetic-a/messages","/v1/spaces/synthetic-b/messages"]);
  expect(messages.every(message=>message.headers.get("authorization")==="Bearer synthetic-chat-token")).toBe(true);
  expect(assertions[0]).toMatchObject({iss:"synthetic-chat@example.test",aud:"https://oauth2.googleapis.com/token",scope:"https://www.googleapis.com/auth/chat.bot"});
});


const route = () => importTestModule("src/app/api/notifications/deliver/route.ts",{"server-only":{}});
const trigger = (secret="synthetic-delivery-secret") => new Request("https://app.example.test/api/notifications/deliver",{method:"POST",headers:{"x-founderops-delivery-secret":secret},body:JSON.stringify({eventIds:[7]})});

test("actual notification route delivers a claimed DM through central Chat credentials",async()=>{
  const api=await route();const response=await api.POST(trigger());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({sent:1,failed:0});
  expect(messages).toHaveLength(1);
  expect(messages[0].url.pathname).toBe("/v1/spaces/synthetic-dm/messages");
  expect(messages[0].body.cardsV2[0].card.header.title).toBe("FounderOps: Fokus-Digest");
  expect(deliveryRecords).toMatchObject([{event_id:7,status:"sent",attempts:1,payload:{deliveryMode:"direct_dm"}}]);
  expect(databaseCalls.filter(call=>call.path.endsWith("/rpc/finalize_notification_delivery_claim"))).toHaveLength(1);
  const repeated=await api.POST(trigger());
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toMatchObject({sent:0});
  expect(messages).toHaveLength(1);
  expect(databaseCalls.filter(call=>call.path.endsWith("/rpc/claim_notification_delivery"))).toHaveLength(2);
});


test("actual notification route keeps webhook digest mode and finalizes its claim",async()=>{
  routeRows=[{...routeRows[0],type:"task.review_completed",recipient_profile_id:null}];
  vi.stubEnv("GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL","");vi.stubEnv("GOOGLE_CHAT_PRIVATE_KEY","");
  const api=await route();const response=await api.POST(trigger());
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({sent:1});
  expect(exchanges).toBe(0);expect(messages).toHaveLength(1);
  expect(messages[0].url.pathname).toBe("/v1/spaces/synthetic-webhook/messages");
  expect(messages[0].headers.has("authorization")).toBe(false);
  expect(deliveryRecords[0]).toMatchObject({status:"sent",payload:{deliveryMode:"webhook_digest"}});
});

test.each(["disabled","missing"])("actual notification route does not claim or dispatch when configuration is %s",async mode=>{
  if(mode==="disabled")vi.stubEnv("GOOGLE_CHAT_DELIVERY_ENABLED","false");
  else for(const name of ["GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL","GOOGLE_CHAT_PRIVATE_KEY","GOOGLE_CHAT_WEBHOOK_URL"])vi.stubEnv(name,"");
  const api=await route();const response=await api.POST(trigger());
  expect(response.status).toBe(424);expect(messages).toHaveLength(0);expect(exchanges).toBe(0);expect(databaseCalls).toHaveLength(0);
  expect(JSON.stringify(await response.json())).not.toMatch(/synthetic-webhook-token|PRIVATE KEY/);
});

test("plain webhook entry retains the established notification text",async()=>{
  const chat=await delivery();await chat.sendGoogleChatWebhook(event);
  expect(messages).toHaveLength(1);expect(exchanges).toBe(0);
  expect(messages[0].body).toEqual({text:"*Synthetic notification*\nSynthetic body\nTyp: task.mention\ntask: synthetic-task"});
});

test("cached bot credentials remain separate from enabled state",async()=>{
  const chat=await delivery();await chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test");
  vi.stubEnv("GOOGLE_CHAT_DELIVERY_ENABLED","false");
  await expect(chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test")).rejects.toMatchObject({name:"GoogleChatDeliveryDisabled"});
  expect(exchanges).toBe(1);expect(messages).toHaveLength(1);
});

test("disabling delivery while token issuance waits prevents dispatch",async()=>{
  delayToken=async()=>vi.stubEnv("GOOGLE_CHAT_DELIVERY_ENABLED","false");
  const chat=await delivery();
  await expect(chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test")).rejects.toMatchObject({name:"GoogleChatDeliveryDisabled"});
  expect(messages).toHaveLength(0);
  delayToken=null;vi.stubEnv("GOOGLE_CHAT_DELIVERY_ENABLED","true");
  await chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test");
  expect(exchanges).toBe(2);expect(messages).toHaveLength(1);
});

test("a changed service account during issuance cannot dispatch the old account token",async()=>{
  delayToken=async()=>vi.stubEnv("GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL","changed-chat@example.test");
  const chat=await delivery();
  await expect(chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test")).rejects.toMatchObject({name:"GoogleChatConfigurationChanged"});
  expect(messages).toHaveLength(0);
  delayToken=null;
  await chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test");
  expect(assertions.map(assertion=>assertion.iss)).toEqual(["synthetic-chat@example.test","changed-chat@example.test"]);
});

test("bot token renewal obeys provider expiry and does not renew on cache reads",async()=>{
  const chat=await delivery();const start=Date.now();
  for(const elapsed of [0,1000000,2000000,3539999]) {vi.setSystemTime(start+elapsed);await chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test");}
  expect(exchanges).toBe(1);
  vi.setSystemTime(start+3540000);await chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test");
  expect(exchanges).toBe(2);
});

test("slow issuance cannot extend a known provider deadline",async()=>{
  lifetime=1;delayToken=async()=>vi.setSystemTime(Date.now()+1000);
  const chat=await delivery();
  await expect(chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test")).rejects.toMatchObject({name:"GoogleChatCredentialExpired"});
  expect(messages).toHaveLength(0);
});

test.each(["token","delivery","unknown"])("provider %s failure is safe and never replays the message",async failure=>{
  if(failure==="token")tokenStatus=503;else if(failure==="delivery")chatStatus=503;else unknownDelivery=true;
  const api=await route();const response=await api.POST(trigger());
  expect(response.status).toBe(502);const body=await response.json();expect(body).toMatchObject({sent:0,failed:1});
  expect(JSON.stringify(body)).not.toMatch(/sensitive-token-detail|sensitive-webhook-token|synthetic-chat-token|PRIVATE KEY/);
  expect(messages).toHaveLength(failure==="token"?0:1);expect(exchanges).toBe(1);
  expect(deliveryRecords[0]).toMatchObject({status:"failed",attempts:1});
  expect(databaseCalls.filter(call=>call.path.endsWith("/rpc/finalize_notification_delivery_claim"))).toHaveLength(1);
});

test("a finalized notification is skipped despite a usable cached bot credential",async()=>{
  existingDeliveries=[{event_id:7,status:"sent"}];
  const api=await route();const response=await api.POST(trigger());
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({sent:0,skipped:1});
  expect(messages).toHaveLength(0);expect(exchanges).toBe(0);
});

const seam = () => importTestModule("src/lib/credentials/index.ts",{"server-only":{}});

test("late disable after a cached token lookup still blocks the actual dispatch",async()=>{
  const {authorizeCredentialAction}=await seam();
  const permission=await authorizeCredentialAction({credential:{kind:"google-chat-bot"},action:"google-chat.space.deliver",target:"spaces/synthetic-a"});
  await permission.chat.send({text:"Warm token"});
  const sending=permission.chat.send({text:"Must not send"});
  vi.stubEnv("GOOGLE_CHAT_DELIVERY_ENABLED","false");
  await expect(sending).rejects.toMatchObject({name:"GoogleChatDeliveryDisabled"});
  expect(messages).toHaveLength(1);expect(exchanges).toBe(1);
});

test("a fixed space capability cannot follow a mutated caller target",async()=>{
  const {authorizeCredentialAction}=await seam();
  const input={credential:{kind:"google-chat-bot"},action:"google-chat.space.deliver",target:"spaces/synthetic-a"};
  const permission=await authorizeCredentialAction(input);input.target="spaces/synthetic-b";
  await permission.chat.send({text:"Synthetic bound target"});
  expect(messages[0].url.pathname).toBe("/v1/spaces/synthetic-a/messages");
  expect(permission).not.toHaveProperty("token");expect(permission.chat).not.toHaveProperty("fetch");
});

test("a fixed webhook capability cannot follow changed configured target or secret",async()=>{
  const {authorizeCredentialAction}=await seam();
  const permission=await authorizeCredentialAction({credential:{kind:"google-chat-webhook"},action:"google-chat.webhook.deliver"});
  vi.stubEnv("GOOGLE_CHAT_WEBHOOK_URL","https://chat.googleapis.com/v1/spaces/synthetic-other/messages?key=changed-key&token=changed-token");
  await expect(permission.chat.send({text:"Must not send"})).rejects.toMatchObject({name:"GoogleChatConfigurationChanged"});
  expect(messages).toHaveLength(0);
});

test.each(["service-account","private-key"])("warm token cannot cross changed bot %s configuration",async change=>{
  const chat=await delivery();await chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test");
  if(change==="service-account")vi.stubEnv("GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL","changed-chat@example.test");
  else vi.stubEnv("GOOGLE_CHAT_PRIVATE_KEY",privateKey.export({type:"pkcs1",format:"pem"}).toString());
  await chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test");
  expect(exchanges).toBe(2);expect(messages).toHaveLength(2);
});

test.each(["users/synthetic","spaces/synthetic/messages","https://chat.googleapis.com/spaces/synthetic"])("invalid DM target is denied before token issuance: %s",async target=>{
  const chat=await delivery();await expect(chat.sendGoogleChatSpaceDigest(target,[event],"https://app.example.test")).rejects.toMatchObject({name:"GoogleChatTargetInvalid"});
  expect(exchanges).toBe(0);expect(messages).toHaveLength(0);
});

test("a personal DM without a configured space never falls back to the group webhook",async()=>{
  profiles[0].google_chat_dm_space=null;
  const api=await route();const response=await api.POST(trigger());
  expect(response.status).toBe(424);expect(await response.json()).toMatchObject({sent:0,failed:1});
  expect(messages).toHaveLength(0);expect(exchanges).toBe(0);
});

test("technical Chat credentials cannot supply human calendar authority",async()=>{
  const {authorizeCredentialAction}=await seam();
  expect(await authorizeCredentialAction({credential:{kind:"google-chat-bot"},action:"calendar.read"})).toMatchObject({ok:false,status:403});
  await expect(authorizeCredentialAction({credential:{kind:"session-request",request:new Request("https://app.example.test")},action:"google-chat.space.deliver",target:"spaces/synthetic"})).rejects.toMatchObject({name:"GoogleChatCredentialDenied"});
  expect(messages).toHaveLength(0);expect(exchanges).toBe(0);
});

test("the incoming Chat receiver remains inert for messages and unknown events",async()=>{
  const incoming=await importTestModule("src/app/api/google-chat/events/route.ts",{"server-only":{}});
  const message=await incoming.POST(new Request("https://app.example.test/api/google-chat/events",{method:"POST",body:JSON.stringify({type:"MESSAGE",message:{text:"activate administrator"}})}));
  expect(message.status).toBe(200);expect(await message.json()).toMatchObject({text:expect.stringContaining("nicht aktiviert")});
  const other=await incoming.POST(new Request("https://app.example.test/api/google-chat/events",{method:"POST",body:JSON.stringify({type:"UNKNOWN"})}));
  expect(other.status).toBe(200);expect(await other.json()).toMatchObject({handled:false,eventType:"UNKNOWN"});
  expect(messages).toHaveLength(0);expect(exchanges).toBe(0);expect(databaseCalls).toHaveLength(0);
});

test.each([null,{access_token:"synthetic-chat-token",expires_in:0},{access_token:"synthetic-chat-token",expires_in:30,token_type:"Different"},{access_token:"synthetic-chat-token",expires_in:30,scope:"unrelated-scope"}])("invalid token protocol response cannot produce a dispatch",async invalid=>{
  tokenResponse=invalid;
  const chat=await delivery();
  await expect(chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test")).rejects.toMatchObject({name:"GoogleChatCredentialInvalid",message:"Google Chat Token-Antwort ist ungültig."});
  expect(messages).toHaveLength(0);
});

test("a failed shared token issuance can recover without replaying a message",async()=>{
  tokenStatus=503;const chat=await delivery();
  const pending=await Promise.allSettled([chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test"),chat.sendGoogleChatSpaceDigest("spaces/synthetic-b",[event],"https://app.example.test")]);
  expect(pending.every(result=>result.status==="rejected")).toBe(true);expect(exchanges).toBe(1);expect(messages).toHaveLength(0);
  tokenStatus=200;await chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test");
  expect(exchanges).toBe(2);expect(messages).toHaveLength(1);
});

test("configured Chat credentials cannot replace the real delivery trigger secret",async()=>{
  const api=await route();const response=await api.POST(trigger("incorrect-synthetic-secret"));
  expect(response.status).toBe(401);expect(databaseCalls).toHaveLength(0);expect(exchanges).toBe(0);expect(messages).toHaveLength(0);
});

test("a provider-rejected bot token is replaced only for the next explicit delivery",async()=>{
  chatStatus=401;const chat=await delivery();
  await expect(chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test")).rejects.toMatchObject({name:"GoogleChatDeliveryFailed"});
  expect(messages).toHaveLength(1);expect(exchanges).toBe(1);
  chatStatus=200;
  await chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test");
  expect(messages).toHaveLength(2);expect(exchanges).toBe(2);
});


test("a late rejected dispatch cannot evict a concurrently replaced bot token",async()=>{
  let release;
  const firstResponse=new Promise(resolve=>{release=resolve;});
  messageResponse=async number=>number===1 ? firstResponse : Response.json({name:"spaces/synthetic/messages/synthetic"});
  const chat=await delivery();const start=Date.now();
  const first=chat.sendGoogleChatSpaceDigest("spaces/synthetic-a",[event],"https://app.example.test").then(()=>null,error=>error);
  for(let attempt=0;attempt<100&&messages.length===0;attempt++)await new Promise(resolve=>setImmediate(resolve));
  expect(messages).toHaveLength(1);
  vi.setSystemTime(start+3540000);
  await chat.sendGoogleChatSpaceDigest("spaces/synthetic-b",[event],"https://app.example.test");
  expect(exchanges).toBe(2);
  release(Response.json({error:"sensitive-token-detail"},{status:401}));
  expect(await first).toMatchObject({name:"GoogleChatDeliveryFailed"});
  await chat.sendGoogleChatSpaceDigest("spaces/synthetic-b",[event],"https://app.example.test");
  expect(exchanges).toBe(2);expect(messages).toHaveLength(3);
});

test("a delivery secret changed during outgoing token issuance cannot authorize a new Chat send",async()=>{
  delayToken=async()=>vi.stubEnv("FOUNDEROPS_DELIVERY_SECRET","rotated-synthetic-delivery-secret");
  const api=await route();const response=await api.POST(trigger());
  expect(messages).toHaveLength(0);
  expect(response.status).toBe(401);
});
