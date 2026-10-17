import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {resolve} from "node:path";
import {createHmac,randomUUID} from "node:crypto";
import pg from "pg";
import {expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {importTestModule} from "../helpers/vitest-module.mjs";

it("signed HTTP intake retains real queue idempotency, claim ownership and terminal processing",async()=>{
 const {stdout}=await promisify(execFile)(resolve("node_modules/.bin/supabase"),["status","-o","json"]);const local=JSON.parse(stdout);
 if(!new Set(["localhost","127.0.0.1"]).has(new URL(local.API_URL).hostname))throw new Error("Disposable local test target required");
 const database=new pg.Client(local.DB_URL);await database.connect();const originalFetch=globalThis.fetch;const deliveryId=`synthetic-webhook-${randomUUID()}`,leaseId=`synthetic-webhook-${randomUUID()}`;const after:Array<()=>Promise<void>>=[];
 const secret="synthetic-webhook-secret";
 try {
  for(const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:local.API_URL,SUPABASE_URL:local.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:local.ANON_KEY,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_ANON_KEY:local.ANON_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,GITHUB_APP_WEBHOOK_SECRET:secret,GITHUB_APP_INSTALLATION_ID:"42",GITHUB_WEBHOOK_ORGANIZATION_ID:"606",GITHUB_APP_ID:"",GITHUB_APP_PRIVATE_KEY:"",GITHUB_APP_PRIVATE_KEY_PATH:""}))vi.stubEnv(name,value);
  vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{const request=new Request(input,init);if(new URL(request.url).origin!==new URL(local.API_URL).origin)throw new Error("Unexpected external provider in webhook parity test");return originalFetch(request);});
  const next=await import("next/server");const route=await importTestModule("src/app/api/github/webhooks/route.ts",{"server-only":{},"next/server":{...next,after:(callback:()=>Promise<void>)=>after.push(callback)}});
  const payload={action:"deleted",installation:{id:42},repository:{id:101,full_name:"findmydoc-platform/management"},issue:{id:202,node_id:"I_synthetic",number:2000000000,updated_at:"2026-10-17T10:00:00Z"},comment:{id:404,node_id:"IC_synthetic",updated_at:"2026-10-17T10:01:00Z"},sender:{id:303,login:"synthetic-founder",type:"User"}};
  const request=(id=deliveryId,body:unknown=payload,signature?:string)=>{const raw=Buffer.from(JSON.stringify(body));return new NextRequest("https://app.example.test/api/github/webhooks",{method:"POST",headers:{"content-type":"application/json","x-github-delivery":id,"x-github-event":"issue_comment","x-hub-signature-256":signature||`sha256=${createHmac("sha256",secret).update(raw).digest("hex")}`},body:raw});};
  const first=await route.POST(request());expect(first.status).toBe(202);
  expect((await database.query("select status,attempts from public.github_webhook_deliveries where delivery_id=$1",[deliveryId])).rows).toEqual([{status:"received",attempts:0}]);
  const duplicate=await route.POST(request());expect(duplicate.status).toBe(200);expect(await duplicate.json()).toMatchObject({duplicate:true});
  const conflicting=await route.POST(request(deliveryId,{...payload,comment:{...payload.comment,updated_at:"2026-10-17T10:02:00Z"}}));expect(conflicting.status).toBe(409);
  const forged=await route.POST(request(`forged-${deliveryId}`,payload,"sha256="+"0".repeat(64)));expect(forged.status).toBe(401);
  await after.shift()!();await after.shift()!();
  expect((await database.query("select status,status_reason,attempts from public.github_webhook_deliveries where delivery_id=$1",[deliveryId])).rows).toEqual([{status:"ignored",status_reason:"task_not_found",attempts:1}]);
  expect((await database.query("select count(*)::integer as count from public.github_webhook_deliveries where delivery_id=$1",[deliveryId])).rows[0].count).toBe(1);
  expect((await route.POST(request(leaseId))).status).toBe(202);after.length=0;
  const firstLock=randomUUID(),foreignLock=randomUUID();
  expect((await database.query("select * from public.claim_github_issue_comment_webhook_delivery($1,$2,120)",[leaseId,firstLock])).rows).toHaveLength(1);
  expect((await database.query("select * from public.claim_github_issue_comment_webhook_delivery($1,$2,120)",[leaseId,foreignLock])).rows).toHaveLength(0);
  const finalized=await database.query("select public.finalize_github_issue_comment_webhook_delivery($1,$2,'ignored','synthetic_finalization',null,null) as finalized",[leaseId,foreignLock]);expect(finalized.rows[0].finalized).toBe(false);
  await database.query("update public.github_webhook_deliveries set locked_at=now()-interval '3 minutes' where delivery_id=$1",[leaseId]);
  expect((await database.query("select * from public.claim_github_issue_comment_webhook_delivery($1,$2,120)",[leaseId,foreignLock])).rows).toHaveLength(1);
  expect((await database.query("select public.finalize_github_issue_comment_webhook_delivery($1,$2,'ignored','synthetic_finalization',null,null) as finalized",[leaseId,firstLock])).rows[0].finalized).toBe(false);
  expect((await database.query("select public.finalize_github_issue_comment_webhook_delivery($1,$2,'ignored','synthetic_finalization',null,null) as finalized",[leaseId,foreignLock])).rows[0].finalized).toBe(true);
  const denied=await originalFetch(`${local.API_URL}/rest/v1/github_webhook_deliveries`,{method:"POST",headers:{apikey:local.ANON_KEY,authorization:`Bearer ${local.ANON_KEY}`,"content-type":"application/json"},body:JSON.stringify({delivery_id:`forbidden-${deliveryId}`})});expect([401,403]).toContain(denied.status);
 }finally{
  vi.unstubAllGlobals();vi.unstubAllEnvs();await database.query("delete from public.github_webhook_deliveries where delivery_id=any($1)",[[deliveryId,leaseId,`forged-${deliveryId}`,`forbidden-${deliveryId}`]]);await database.end();
 }
},30000);
