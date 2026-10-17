import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createCipheriv, createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import type { GoogleCalendarCapability } from "../../src/lib/credentials/types";
const scope="https://www.googleapis.com/auth/calendar.events.owned";
type Row={connection_id:string;credential_version:number;refresh_claim_id:string|null;encrypted_access_token:string;encrypted_refresh_token:string;refresh_token_expires_at:Date;last_used_at:Date|null};
type Fixture={db:pg.Client;id:string;request:NextRequest;local:Record<string,string>;calls:Request[];setProvider(fn:(request:Request)=>Promise<Response>):void;authorize(owner?:string):Promise<GoogleCalendarCapability>;row():Promise<Row>;store():Promise<void>;rpc(name:string,body:unknown,credential?:string):Promise<Response>;encrypt(value:string):string};
async function fixture(run:(f:Fixture)=>Promise<void>) {
  const {stdout}=await promisify(execFile)(resolve("node_modules/.bin/supabase"),["status","-o","json"]);
  const local=JSON.parse(stdout),api=new URL(local.API_URL);
  if(!["localhost","127.0.0.1"].includes(api.hostname))throw Error("Disposable local target required");
  const db=new pg.Client(local.DB_URL);await db.connect();
  const id=`calendar-owner-${randomUUID()}`,userId=randomUUID(),sessionId=randomUUID();
  const key=Buffer.alloc(32,11),originalFetch=globalThis.fetch;
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned=`${encode({alg:"HS256",typ:"JWT"})}.${encode({iss:`${local.API_URL}/auth/v1`,sub:userId,aud:"authenticated",role:"authenticated",session_id:sessionId,exp:Math.floor(Date.now()/1000)+3600})}`;
  const jwt=`${unsigned}.${createHmac("sha256",local.JWT_SECRET).update(unsigned).digest("base64url")}`;
  const request=new NextRequest("http://localhost:3000/api/team-workweek/publish",{headers:{authorization:`Bearer ${jwt}`}});
  const encrypt=(value:string)=>{const iv=Buffer.alloc(12,7),cipher=createCipheriv("aes-256-gcm",key,iv);const bytes=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);return ["v1",iv,cipher.getAuthTag(),bytes].map(part=>Buffer.isBuffer(part)?part.toString("base64url"):part).join(".");};
  let provider:(request:Request)=>Promise<Response>=async()=>{throw Error("Unscripted provider");};
  const calls:Request[]=[];
  try {
    await db.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values($1,$2,'authenticated','authenticated',now())",[userId,`${id}@example.test`]);
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,'Synthetic Calendar owner','viewer')",[id,userId]);
    await db.query("insert into public.google_workspace_connections(profile_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,oauth_scopes,token_type,primary_calendar_id) values($1,$2,$3,now()+interval '1 hour',now()+interval '2 hours',$4,'Bearer','primary')",[id,encrypt("synthetic-calendar-old"),encrypt("synthetic-calendar-refresh"),[scope]]);
    for(const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:local.API_URL,SUPABASE_URL:local.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:local.ANON_KEY,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,GOOGLE_WORKSPACE_CLIENT_ID:"synthetic-calendar-client",GOOGLE_WORKSPACE_CLIENT_SECRET:"synthetic-secret",GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY:key.toString("base64"),VERCEL_ENV:"preview"}))vi.stubEnv(name,value as string);
    vi.stubGlobal("fetch",async(input:RequestInfo|URL,init?:RequestInit)=>{
      const req=new Request(input,init),url=new URL(req.url);
      if(url.origin===api.origin){if(url.pathname==="/auth/v1/user")return Response.json({id:userId,aud:"authenticated",role:"authenticated",user_metadata:{}});return originalFetch(req);}
      if(url.hostname!=="www.googleapis.com" && url.href!=="https://oauth2.googleapis.com/token")throw Error("Unscripted external provider");
      calls.push(req);return provider(req);
    });
    const row=async()=>(await db.query("select * from public.google_workspace_connections where profile_id=$1",[id])).rows[0] as Row;
    const rpc=async(name:string,body:unknown,credential=local.SERVICE_ROLE_KEY)=>originalFetch(`${local.API_URL}/rest/v1/rpc/${name}`,{method:"POST",headers:{apikey:local.ANON_KEY,authorization:`Bearer ${credential}`,"content-type":"application/json"},body:JSON.stringify(body)});
    const authorize=async(owner=id)=>{const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});return (await authorizeCredentialAction({credential:{kind:"session-request",request},action:"google-calendar.workweek",target:{ownerProfileId:owner}})).calendar;};
    const store=async()=>{const current=await row();const response=await rpc("store_google_calendar_connection",{p_profile_id:id,p_access:encrypt("synthetic-reconnected"),p_refresh:encrypt("synthetic-new-refresh"),p_access_expires:new Date(Date.now()+3600000).toISOString(),p_refresh_expires:new Date(Date.now()+7200000).toISOString(),p_expected_connection:current.connection_id,p_expected_version:current.credential_version});expect(await response.json()).toBe(true);};
    vi.resetModules();await run({db,id,request,local,calls,setProvider:fn=>{provider=fn;},authorize,row,store,rpc,encrypt});
  } finally {
    vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();
    await db.query("delete from public.google_workspace_disconnect_operations where owner_profile_id=$1",[id]);
    await db.query("delete from public.profiles where id=$1",[id]);await db.query("delete from auth.users where id=$1",[userId]);await db.end();
  }
}
it("real owner/status entry retains primary scope, encrypted usage and immediate rebind/disconnect boundaries",()=>fixture(async f=>{
  f.setProvider(async request=>{expect(request.headers.get("authorization")).toBe("Bearer synthetic-calendar-old");return Response.json({kind:"calendar#events",summary:"Synthetic primary"});});
  const access=await f.authorize();expect(JSON.stringify(access)).not.toContain("synthetic-calendar-old");
  await access.request("https://www.googleapis.com/calendar/v3/calendars/primary/events/event-1");
  expect((await f.row()).last_used_at).not.toBeNull();
  await expect(f.authorize("foreign-owner")).rejects.toThrow();
  await expect(access.request("https://www.googleapis.com/calendar/v3/calendars/foreign/events/event-1")).rejects.toThrow();
  const {GET}=await importTestModule("src/app/api/google-workspace/status/route.ts",{"server-only":{}});
  const status=await GET(f.request);expect(status.status).toBe(200);expect(await status.json()).toMatchObject({connection:{state:"connected",calendarLabel:"Synthetic primary"},disconnectPending:false});
  const operation=(await f.db.query("insert into public.google_workspace_disconnect_operations(owner_profile_id,requested_by,revoke_connection,cutoff_date,state,deactivated_at) values($1,'owner',true,current_date,'revoke_pending',now()) returning id,connection_id",[f.id])).rows[0];
  expect(operation.connection_id).toBe((await f.row()).connection_id);
  await f.store();await expect(access.request("https://www.googleapis.com/calendar/v3/calendars/primary/events/event-1")).rejects.toThrow();
  const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  expect(await authorizeCredentialAction({credential:{kind:"session-request",request:f.request},action:"google-calendar.connection.remove",target:{ownerProfileId:f.id,operationId:operation.id}})).toEqual({ok:true});
  expect((await f.row()).connection_id).not.toBe(operation.connection_id);
}),30000);
it.each(["success","failure"])("separate instances claim one rotating refresh and reject stale %s after a newer connection",outcome=>fixture(async f=>{
  await f.db.query("update public.google_workspace_connections set access_token_expires_at=now()-interval '1 second' where profile_id=$1",[f.id]);
  let release!:()=>void,started!:()=>void;const pending=new Promise<void>(r=>{release=r;}),entered=new Promise<void>(r=>{started=r;});
  f.setProvider(async()=>{started();await pending;if(outcome === "failure") return Response.json({error:"server_error"},{status:503});return Response.json({access_token:"synthetic-rotated",refresh_token:"synthetic-rotated-refresh",expires_in:3600,refresh_token_expires_in:7200,token_type:"Bearer"});});
  const first=f.authorize();await Promise.race([entered,first.then(()=>{throw Error("Expected refresh");})]);
  vi.resetModules();await expect(f.authorize()).rejects.toThrow("gerade erneuert");
  await f.store();release();await expect(first).rejects.toThrow();
  expect((await f.db.query("select last_error_class from public.google_workspace_connections where profile_id=$1",[f.id])).rows[0].last_error_class).toBeNull();
  expect(f.calls.filter(r=>r.url==="https://oauth2.googleapis.com/token")).toHaveLength(1);
  f.setProvider(async request=>{expect(request.headers.get("authorization")).toBe("Bearer synthetic-reconnected");return Response.json({});});
  await (await f.authorize()).request("https://www.googleapis.com/calendar/v3/calendars/primary/events/event-1");
}),30000);
it("successful refresh preserves rotation and independent expiry while uncertain writes are observed before another mutation",()=>fixture(async f=>{
  let existing=false,writes=0;
  const effect={id:"effect-1",calendarId:"primary",googleEventId:"fopscontrolled",generation:1,kind:"master",operation:"create",state:"pending",confirmedEtag:null,payload:{id:"fopscontrolled",start:{dateTime:"2099-01-12T09:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2099-01-12T17:00:00Z",timeZone:"Europe/Berlin"},extendedProperties:{private:{founderopsWorkweekEffectId:"effect-1"}}}} as const;
  f.setProvider(async request=>{
    if(request.url==="https://oauth2.googleapis.com/token") {expect((await request.text())).toContain("refresh_token=synthetic-calendar-refresh");return Response.json({access_token:"synthetic-rotated",refresh_token:"synthetic-rotated-refresh",expires_in:3600,refresh_token_expires_in:9000,token_type:"Bearer"});}
    if(request.method==="POST"){writes++;existing=true;throw Error("lost Calendar success response");}
    return existing ? Response.json({...effect.payload,etag:"confirmed"}) : new Response(null,{status:404});
  });
  const {ensureGoogleWorkweekEffect}=await importTestModule("src/features/team-workweek/server/team-workweek-immediate-effects.ts");
  const calendar=await f.authorize();
  expect(await ensureGoogleWorkweekEffect({accessToken:calendar,effect})).toMatchObject({state:"confirmed"});
  await f.db.query("update public.google_workspace_connections set access_token_expires_at=now()-interval '1 second' where profile_id=$1",[f.id]);
  expect(await ensureGoogleWorkweekEffect({accessToken:calendar,effect})).toMatchObject({state:"confirmed"});
  expect(writes).toBe(1);const row=await f.row();expect(row.encrypted_refresh_token).not.toContain("synthetic-rotated-refresh");expect(Number(row.credential_version)).toBe(1);expect(row.refresh_claim_id).toBeNull();
  expect(new Date(row.refresh_token_expires_at).getTime()).toBeGreaterThan(Date.now()+8500000);
  await f.db.query("update public.google_workspace_connections set access_token_expires_at=now()-interval '1 second' where profile_id=$1",[f.id]);
  f.setProvider(async request=>{expect(await request.text()).toContain("refresh_token=synthetic-rotated-refresh");return Response.json({access_token:"synthetic-second-access",expires_in:3600,token_type:"Bearer"});});
  await f.authorize();const preserved=await f.row();
  expect(preserved.encrypted_refresh_token).toBe(row.encrypted_refresh_token);
  expect(preserved.refresh_token_expires_at).toEqual(row.refresh_token_expires_at);

}),30000);
it("unknown refresh outcomes never replay and known refresh expiry denies before provider dispatch",()=>fixture(async f=>{
  await f.db.query("update public.google_workspace_connections set access_token_expires_at=now()-interval '1 second' where profile_id=$1",[f.id]);
  f.setProvider(async()=>{throw Error("rotated but response lost");});
  await expect(f.authorize()).rejects.toMatchObject({code:"invalid_token_response"});
  await f.db.query("update public.google_workspace_connections set refresh_claim_expires_at=now()-interval '1 second' where profile_id=$1",[f.id]);
  vi.resetModules();await expect(f.authorize()).rejects.toThrow("erneuert werden");expect(f.calls).toHaveLength(1);
  await f.store();await f.db.query("update public.google_workspace_connections set refresh_token_expires_at=now()-interval '1 second' where profile_id=$1",[f.id]);
  await expect(f.authorize()).rejects.toThrow("erneuert werden");expect(f.calls).toHaveLength(1);
}),30000);
it.each([['invalid_grant',400,'provider_revoked'],['server_error',503,'invalid_token_response']])("provider %s retains its recovery classification without another exchange",(error,status,code)=>fixture(async f=>{
  await f.db.query("update public.google_workspace_connections set access_token_expires_at=now()-interval '1 second' where profile_id=$1",[f.id]);
  f.setProvider(async()=>Response.json({error},{status:Number(status)}));
  await expect(f.authorize()).rejects.toMatchObject({code});expect(f.calls).toHaveLength(1);
}),30000);
it("anonymous and authenticated clients cannot read the vault or invoke any added RPC",()=>fixture(async f=>{
  const current=await f.row();
  const calls={store_google_calendar_connection:{p_profile_id:f.id,p_access:"forbidden",p_refresh:"forbidden",p_access_expires:null,p_refresh_expires:null,p_expected_connection:current.connection_id,p_expected_version:current.credential_version},claim_google_calendar_refresh:{p_profile_id:f.id,p_connection_id:current.connection_id,p_version:current.credential_version},finalize_google_calendar_refresh:{p_profile_id:f.id,p_connection_id:current.connection_id,p_version:current.credential_version,p_claim_id:randomUUID(),p_access:null,p_refresh:null,p_access_expires:null,p_refresh_expires:null,p_error:"oauth_reconnect_required"},use_google_calendar_connection:{p_profile_id:f.id,p_connection_id:current.connection_id,p_version:current.credential_version},remove_google_calendar_connection:{p_profile_id:f.id,p_operation_id:randomUUID()},bind_google_calendar_disconnect:{}};
  for(const credential of [f.local.ANON_KEY,f.request.headers.get("authorization")!.slice(7)]) {
    for(const [name,body] of Object.entries(calls)){const response=await f.rpc(name,body,credential);expect([401,403,404]).toContain(response.status);}
    const response=await fetch(`${f.local.API_URL}/rest/v1/google_workspace_connections?select=encrypted_access_token`,{headers:{apikey:f.local.ANON_KEY,authorization:`Bearer ${credential}`}});expect(response.ok).toBe(false);
  }
}),30000);
