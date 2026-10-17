import { afterEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { createCipheriv, createHmac } from "node:crypto";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });
function encrypted(value) {
  const iv=Buffer.alloc(12,2),cipher=createCipheriv("aes-256-gcm",Buffer.alloc(32,1),iv);
  const bytes=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return ["v1",iv,cipher.getAuthTag(),bytes].map(part=>Buffer.isBuffer(part)?part.toString("base64url"):part).join(".");
}
function fixture() {
  for(const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:"https://calendar-auth.example.test",SUPABASE_URL:"https://calendar-auth.example.test",NEXT_PUBLIC_SUPABASE_ANON_KEY:"synthetic-anon",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",SUPABASE_SECRET_KEY:"synthetic-service",SUPABASE_ANON_KEY:"synthetic-anon",SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",REQUIRE_SUPABASE_AUTH:"true",GOOGLE_WORKSPACE_CLIENT_ID:"synthetic-calendar-client",GOOGLE_WORKSPACE_CLIENT_SECRET:"synthetic-secret",GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString("base64")})) vi.stubEnv(name,value);
  const row={connection_id:"connection-1",credential_version:0,refresh_claim_id:null,encrypted_access_token:encrypted("synthetic-calendar"),encrypted_refresh_token:encrypted("synthetic-refresh"),access_token_expires_at:new Date(Date.now()+3600000).toISOString(),refresh_token_expires_at:new Date(Date.now()+7200000).toISOString(),oauth_scopes:["https://www.googleapis.com/auth/calendar.events.owned"],token_type:"Bearer",primary_calendar_id:"primary",revoked_at:null};
  const provider=[],removed=[];
  vi.stubGlobal("fetch",async(input,options)=>{
    const request=new Request(input,options),url=new URL(request.url);
    if(url.hostname==="www.googleapis.com") {provider.push(request);expect(request.headers.get("authorization")).toBe("Bearer synthetic-calendar");return Response.json({id:"event-1"});}
    if(url.pathname==="/auth/v1/user") return Response.json({id:"user-1",aud:"authenticated",user_metadata:{}});
    if(url.pathname.endsWith("/rpc/workspace_access_context")) return Response.json({mode:"legacy",linkingEnforced:false,userId:"user-1",profileId:"owner-1",linked:false,identity:null});
    if(url.pathname.endsWith("/rpc/current_authenticated_profile")) return Response.json({id:"owner-1",name:"Synthetic owner",platform_role:"viewer"});
    if(url.pathname.endsWith("/rpc/administrator_access_snapshot")) return Response.json({eligible:false,active:false});
    if(url.pathname==="/rest/v1/google_workspace_connections") return Response.json(row);
    if(url.pathname.endsWith("/rpc/remove_google_calendar_connection")) {removed.push(await request.json());return Response.json(true);}
    if(url.pathname.endsWith("/rpc/use_google_calendar_connection")) return Response.json(true);
    throw new Error(`Unexpected synthetic protocol ${url.pathname}`);
  });
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned=`${encode({alg:"HS256",typ:"JWT"})}.${encode({iss:"https://calendar-auth.example.test/auth/v1",session_id:"00000000-0000-4000-8000-000000000001",sub:"user-1",aud:"authenticated",role:"authenticated",exp:Math.floor(Date.now()/1000)+3600})}`;
  const token=`${unsigned}.${createHmac("sha256","synthetic-signature").update(unsigned).digest("base64url")}`;
  return {row,provider,removed,request:new NextRequest("https://application.example.test/api/team-workweek/publish",{headers:{authorization:`Bearer ${token}`}})};
}
test("mapped workweek owners receive only their primary Calendar transport independently of platform role",async()=>{
  const state=fixture();const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  const access=await authorizeCredentialAction({credential:{kind:"session-request",request:state.request},action:"google-calendar.workweek",target:{ownerProfileId:"owner-1"}});
  expect(JSON.stringify(access)).not.toContain("synthetic-calendar");
  expect(await (await access.calendar.request("https://www.googleapis.com/calendar/v3/calendars/primary/events/event-1")).json()).toEqual({id:"event-1"});
  await expect(access.calendar.request("https://www.googleapis.com/calendar/v3/calendars/other/events/event-1")).rejects.toThrow();
  await expect(authorizeCredentialAction({credential:{kind:"session-request",request:state.request},action:"google-calendar.workweek",target:{ownerProfileId:"other-owner"}})).rejects.toThrow();
  state.row.revoked_at=new Date().toISOString();
  await expect(access.calendar.request("https://www.googleapis.com/calendar/v3/calendars/primary/events/event-1")).rejects.toThrow();
  expect(state.provider).toHaveLength(1);
});

test("completed owner cleanup removes its bound local Calendar connection without a provider revocation request",async()=>{
  const state=fixture();const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  expect(await authorizeCredentialAction({credential:{kind:"session-request",request:state.request},action:"google-calendar.connection.remove",target:{ownerProfileId:"owner-1",operationId:"operation-1"}})).toEqual({ok:true});
  expect(state.removed).toEqual([{p_profile_id:"owner-1",p_operation_id:"operation-1"}]);expect(state.provider).toHaveLength(0);
});
