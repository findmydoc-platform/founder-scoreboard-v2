import { generateKeyPairSync } from "node:crypto";
import { vi } from "vitest";
import { administratorProtocol } from "./administrator-protocol.mjs";
const {privateKey} = generateKeyPairSync("rsa",{modulusLength:2048});
const syntheticKey = privateKey.export({type:"pkcs8",format:"pem"}).toString();
export function notificationDeliveryProtocol(initial={}) {
  const auth = administratorProtocol(initial);
  const authentication = globalThis.fetch;
  vi.stubEnv("FOUNDEROPS_DELIVERY_SECRET","synthetic-delivery-secret");
  vi.stubEnv("GOOGLE_CHAT_DELIVERY_ENABLED","true");
  vi.stubEnv("GOOGLE_CHAT_WEBHOOK_URL","https://chat.googleapis.com/v1/spaces/synthetic/messages?key=synthetic-key&token=synthetic-token");
  vi.stubEnv("GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL","synthetic-chat@example.test");vi.stubEnv("GOOGLE_CHAT_PRIVATE_KEY",syntheticKey);
  vi.stubEnv("APP_URL","https://app.example.test");
  const state = {events:[{id:7,type:"task.mention",actor_profile_id:null,recipient_profile_id:"synthetic-recipient",entity_type:"task",entity_id:"synthetic-task",title:"Synthetic event",body:"Synthetic body",created_at:new Date().toISOString()}],
    profiles:[{id:"synthetic-recipient",name:"Synthetic Recipient",google_chat_dm_space:"spaces/synthetic-dm",google_chat_user_id:null,notifications_enabled:true}],preferences:[],existing:[],claims:[],records:[],database:[],messages:[],tokens:0,finalized:[],released:[],...initial};
  const selectedIds = url => { const value = url.searchParams.get("id") || url.searchParams.get("event_id"); return value?.startsWith("in.(") ? value.slice(4,-1).split(",").map(Number) : null; };
  vi.stubGlobal("fetch",async(input,init)=>{
    const request = new Request(input,init),url = new URL(request.url);
    if (url.origin === "https://oauth2.googleapis.com") { state.tokens++; if(state.delayToken) await state.delayToken();return Response.json({access_token:"synthetic-chat-token",expires_in:3600}); }
    if (url.origin === "https://chat.googleapis.com") {state.messages.push({url:request.url,body:await request.json()});if(state.chatResponse) return state.chatResponse();return Response.json({name:"spaces/synthetic/messages/synthetic"});}
    if (url.origin !== "https://administrator-auth.example.test") throw new Error("Unexpected external protocol in notification fixture");
    if (url.pathname.startsWith("/auth/")) {const result = await authentication(request);if(state.afterAuth)await state.afterAuth();return result;}
    const path = url.pathname.split("/").at(-1),body = request.method === "POST" || request.method === "PATCH" ? await request.clone().json() : null;
    state.database.push({path,method:request.method,body,url,authorization:request.headers.get("authorization")});
    if(state.beforeRest) await state.beforeRest(path,body,request);
    if(state.storageError === path) return Response.json({message:"Sensitive database detail",code:"XX000"},{status:500});
    if(path === "claim_notification_delivery") {
      if(state.claimError) return Response.json(state.claimError,{status:403});
      const ids = state.claimIds || (state.emptyClaim ? [] : body.p_event_ids || state.events.slice(0,body.p_limit).map(row=>row.id));
      const token = `synthetic-claim-${state.database.filter(call=>call.path===path).length}`;
      state.claims.push(...ids.map(id=>({event_id:id,claim_token:token,claimed_by_profile_id:request.headers.get("authorization")==="Bearer synthetic-service" ? null : "synthetic-profile",claim_authority:request.headers.get("authorization")==="Bearer synthetic-service" ? "pipeline":"administrator",expires_at:new Date(Date.now()+600000).toISOString()})));
      return Response.json({claimToken:token,eventIds:ids});
    }
    if(path === "notification_delivery_claims") {const ids=selectedIds(url);return Response.json(state.claims.filter(row=>!ids||ids.includes(row.event_id)));}
    if(path === "finalize_notification_delivery_claim") {state.finalized.push(body);state.claims=state.claims.filter(row=>row.claim_token!==body.p_claim_token);return Response.json(state.finalizeCount ?? body.p_event_ids.length);}
    if(path === "release_notification_delivery_claim") {state.released.push(body);return new Response(null,{status:204});}
    if(path === "notification_events") {
      if(request.method === "POST") {state.created=body;return new Response(null,{status:201});}
      if(request.method === "HEAD")return new Response(null,{headers:{"content-range":"0-0/3"}});
      if(url.searchParams.get("select")?.includes("actor_label"))return Response.json([]);
      if(url.searchParams.get("select")==="dedupe_key")return Response.json(state.dedupe || []);
      const ids=selectedIds(url);return Response.json(state.events.filter(row=>!ids||ids.includes(row.id)));
    }
    if(path === "notification_deliveries") {if(body){state.records.push(...body);return new Response(null,{status:201});}return Response.json(state.existing);}
    if(path === "notification_preferences")return Response.json(state.preferences);
    if(path === "profiles")return Response.json(state.profiles);
    if(path === "task_comment_github_deliveries") return Response.json([]);
    if(path === "claim_task_comment_github_deliveries" || path === "claim_task_review_github_deliveries") return Response.json([]);
    if(path === "active_tasks")return Response.json(state.tasks || []);
    if(path === "task_blockers" || path === "sprints")return Response.json([]);
    if(path === "founder_events") {if(body){state.marked=body;return new Response(null,{status:204});}return Response.json(state.founderEvents || []);}
    return authentication(request);
  });
  return {...auth,delivery:state,request:(body={eventIds:[7]},headers={})=>auth.request("/api/notifications/deliver","POST",body,headers),pipeline:(body={eventIds:[7]},secret="synthetic-delivery-secret")=>auth.request("/api/notifications/deliver","POST",body,{authorization:"","x-founderops-delivery-secret":secret})};
}
