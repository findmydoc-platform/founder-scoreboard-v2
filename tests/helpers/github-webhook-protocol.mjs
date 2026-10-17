import {createHmac} from "node:crypto";
import {vi} from "vitest";
import {importTestModule} from "./vitest-module.mjs";
export const webhookSecret="synthetic-webhook-secret";
export function webhookPayload(overrides={}) {
 return {action:"edited",installation:{id:42},repository:{id:101,full_name:"findmydoc-platform/management"},issue:{id:202,node_id:"I_synthetic",number:17,updated_at:"2026-10-17T10:00:00Z"},sender:{id:303,login:"synthetic-founder",type:"User"},...overrides};
}
export function githubWebhookProtocol() {
 const origin="https://webhook-storage.example.test";
 for(const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:origin,SUPABASE_URL:origin,NEXT_PUBLIC_SUPABASE_ANON_KEY:"synthetic-anon",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",SUPABASE_ANON_KEY:"synthetic-anon",SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",SUPABASE_SECRET_KEY:"synthetic-service",GITHUB_APP_WEBHOOK_SECRET:webhookSecret,GITHUB_APP_INSTALLATION_ID:"42",GITHUB_WEBHOOK_ORGANIZATION_ID:"606",GITHUB_APP_ID:"",GITHUB_APP_PRIVATE_KEY:"",GITHUB_APP_PRIVATE_KEY_PATH:""}))vi.stubEnv(name,value);
 const state={rows:new Map(),calls:[],after:[],storageError:null,afterInsert:null,beforeDuplicate:null,claim:false,processed:new Set(),applied:[],finalized:[]};
 vi.stubGlobal("fetch",async(input,init)=>{
  const request=new Request(input,init),url=new URL(request.url);if(url.origin!==origin)throw new Error("Unexpected external protocol in webhook test");
  const path=url.pathname.split("/").at(-1),body=request.method==="POST"?await request.json():null;
  state.calls.push({path,method:request.method,body,url});
  if(path==="github_planning_webhook_deliveries"||path==="github_webhook_deliveries") {
   if(body){if(state.storageError==="insert")return Response.json({code:"XX000",message:"Sensitive storage detail"},{status:500});const key=path+":"+body.delivery_id;if(state.rows.has(key)){if(state.beforeDuplicate)await state.beforeDuplicate();return Response.json({code:"23505",message:"Duplicate"},{status:409});}state.rows.set(key,structuredClone(body));if(state.afterInsert)await state.afterInsert();return new Response(null,{status:201});}
   if(state.storageError==="read")return Response.json({code:"XX000",message:"Sensitive storage detail"},{status:500});const id=url.searchParams.get("delivery_id")?.replace(/^eq\./,"");return Response.json(state.rows.get(path+":"+id)||null);
  }
  if(path.startsWith("claim_github_")) {if(!state.claim||state.processed.has(body.p_delivery_id))return Response.json(null);const table=path.includes("planning")?"github_planning_webhook_deliveries":"github_webhook_deliveries";const row=state.rows.get(table+":"+body.p_delivery_id);if(!row)return Response.json(null);return Response.json({...row,attempts:1,status:"processing"});}
  if(path==="resolve_github_issue_comment_webhook_tasks")return Response.json(state.taskMapping?[{task_id:"synthetic-task"}]:[]);
  if(path==="resolve_github_planning_webhook_tasks")return Response.json([]);
  if(path==="apply_github_issue_comment_webhook_projection_with_mentions"){state.applied.push(body);return Response.json("applied");}
  if(path.startsWith("finalize_github_")){state.finalized.push(body);state.processed.add(body.p_delivery_id);return Response.json(true);}
  throw new Error("Unexpected webhook storage operation");
 });
 return {state,raw:(payload=webhookPayload())=>Buffer.from(typeof payload==="string"?payload:JSON.stringify(payload)),request(payload=webhookPayload(),headers={}){
  const raw=Buffer.from(typeof payload==="string"?payload:JSON.stringify(payload));return new Request("https://app.example.test/api/github/webhooks",{method:"POST",headers:{"content-type":"application/json","x-github-delivery":"synthetic-delivery","x-github-event":"issues","x-hub-signature-256":`sha256=${createHmac("sha256",webhookSecret).update(raw).digest("hex")}`,...headers},body:raw});
 },async route(){const next=await import("next/server");return importTestModule("src/app/api/github/webhooks/route.ts",{"server-only":{},"next/server":{...next,after:callback=>state.after.push(callback)}});}};
}
