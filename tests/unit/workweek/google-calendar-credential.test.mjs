import { afterEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { createCipheriv, createHmac } from "node:crypto";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });
function encrypted(value) {
  const iv=Buffer.alloc(12,2),cipher=createCipheriv("aes-256-gcm",Buffer.alloc(32,1),iv);
  const bytes=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return ["v1",iv,cipher.getAuthTag(),bytes].map(part=>Buffer.isBuffer(part)?part.toString("base64url"):part).join(".");
}
function fixture() {
  for(const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:"https://calendar-auth.example.test",SUPABASE_URL:"https://calendar-auth.example.test",NEXT_PUBLIC_SUPABASE_ANON_KEY:"synthetic-anon",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",SUPABASE_SECRET_KEY:"synthetic-service",SUPABASE_ANON_KEY:"synthetic-anon",SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",REQUIRE_SUPABASE_AUTH:"true",GOOGLE_WORKSPACE_CLIENT_ID:"synthetic-calendar-client",GOOGLE_WORKSPACE_CLIENT_SECRET:"synthetic-secret",GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,1).toString("base64")})) vi.stubEnv(name,value);
  const row={connection_id:"connection-1",credential_version:0,refresh_claim_id:null,encrypted_access_token:encrypted("synthetic-calendar"),encrypted_refresh_token:encrypted("synthetic-refresh"),access_token_expires_at:new Date(Date.now()+3600000).toISOString(),refresh_token_expires_at:new Date(Date.now()+7200000).toISOString(),oauth_scopes:["https://www.googleapis.com/auth/calendar.events.owned"],token_type:"Bearer",primary_calendar_id:"primary",revoked_at:null};
  const provider=[],removed=[];
  const control={onVault:async()=>{},onUse:async()=>{},onClaim:async()=>{},onFinalize:async()=>{},tokenPosts:[]};
  vi.stubGlobal("fetch",async(input,options)=>{
    const request=new Request(input,options),url=new URL(request.url);
    if(url.href==="https://oauth2.googleapis.com/token") {control.tokenPosts.push(await request.text());return Response.json({access_token:"synthetic-rotated",refresh_token:"synthetic-rotated-refresh",expires_in:3600,token_type:"Bearer"});}
    if(url.pathname.endsWith("/rpc/claim_google_calendar_refresh")) {await control.onClaim();return Response.json("claim-1");}
    if(url.pathname.endsWith("/rpc/finalize_google_calendar_refresh")) {await control.onFinalize();return Response.json(true);}
    if(url.hostname==="www.googleapis.com") {provider.push(request);expect(request.headers.get("authorization")).toBe("Bearer synthetic-calendar");return Response.json({id:"event-1"});}
    if(url.pathname==="/auth/v1/user") return Response.json({id:"user-1",aud:"authenticated",user_metadata:{}});
    if(url.pathname.endsWith("/rpc/workspace_access_context")) return Response.json({mode:"legacy",linkingEnforced:false,userId:"user-1",profileId:"owner-1",linked:false,identity:null});
    if(url.pathname.endsWith("/rpc/current_authenticated_profile")) return Response.json({id:"owner-1",name:"Synthetic owner",platform_role:"viewer"});
    if(url.pathname.endsWith("/rpc/administrator_access_snapshot")) return Response.json({eligible:false,active:false});
    if(url.pathname==="/rest/v1/google_workspace_disconnect_operations") return Response.json([]);
    if(url.pathname==="/rest/v1/google_workspace_connections") {if(request.method==="PATCH"){Object.assign(row,await request.json());return new Response(null,{status:204});}await control.onVault();return Response.json(row);}
    if(url.pathname.endsWith("/rpc/remove_google_calendar_connection")) {removed.push(await request.json());return Response.json(true);}
    if(url.pathname.endsWith("/rpc/use_google_calendar_connection")) {await control.onUse();return Response.json(true);}
    throw new Error(`Unexpected synthetic protocol ${url.pathname}`);
  });
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const sessionExpires=Math.floor(Date.now()/1000)+3600;
  const unsigned=`${encode({alg:"HS256",typ:"JWT"})}.${encode({iss:"https://calendar-auth.example.test/auth/v1",session_id:"00000000-0000-4000-8000-000000000001",sub:"user-1",aud:"authenticated",role:"authenticated",exp:sessionExpires})}`;
  const token=`${unsigned}.${createHmac("sha256","synthetic-signature").update(unsigned).digest("base64url")}`;
  return {row,provider,removed,control,sessionExpires,request:new NextRequest("https://application.example.test/api/team-workweek/publish",{headers:{authorization:`Bearer ${token}`}})};
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

async function ownerAccess() {
  const state=fixture();const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  const {calendar}=await authorizeCredentialAction({credential:{kind:"session-request",request:state.request},action:"google-calendar.workweek",target:{ownerProfileId:"owner-1"}});
  return {...state,write:()=>calendar.request("https://www.googleapis.com/calendar/v3/calendars/primary/events",{method:"POST",body:JSON.stringify({id:"event-1"})})};
}
test.each(["acquisition","final-binding"])("a Calendar session deadline crossed during %s prevents mutation",async phase=>{
  const state=await ownerAccess();let acquired=false,crossed=false;
  const expire=()=>{crossed=true;vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(state.sessionExpires*1000);};
  state.control.onUse=async()=>{acquired=true;if(phase==="acquisition")expire();};
  state.control.onVault=async()=>{if(phase==="final-binding" && acquired)expire();};
  await expect(state.write()).rejects.toThrow();expect(crossed).toBe(true);expect(state.provider).toHaveLength(0);
});
test("a reconnect after Calendar token acquisition invalidates the issued transport",async()=>{
  const state=await ownerAccess();state.control.onUse=async()=>{state.row.connection_id="replacement";state.row.encrypted_access_token=encrypted("replacement-secret");};
  await expect(state.write()).rejects.toThrow();expect(state.provider).toHaveLength(0);
});
test.each(["access","refresh"])("Calendar %s expiry is checked after the final asynchronous binding read",async kind=>{
  const state=await ownerAccess(),expires=Date.now()+61000;let acquired=false;
  state.row[kind === "access" ? "access_token_expires_at" : "refresh_token_expires_at"]=new Date(expires).toISOString();
  state.control.onUse=async()=>{acquired=true;};state.control.onVault=async()=>{if(acquired){vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(expires);}};
  await expect(state.write()).rejects.toThrow();expect(acquired).toBe(true);expect(state.control.tokenPosts).toHaveLength(0);expect(state.provider).toHaveLength(0);
});
test.each(["claim","finalize","initial-use"])("OAuth configuration changing during Calendar %s cannot release transport",async phase=>{
  const state=fixture();if(phase!=="initial-use")state.row.access_token_expires_at=new Date(Date.now()-1000).toISOString();
  const change=async()=>{vi.stubEnv("GOOGLE_WORKSPACE_CLIENT_ID","replacement-client");};
  if(phase==="claim")state.control.onClaim=change;
  if(phase==="finalize")state.control.onFinalize=change;
  if(phase==="initial-use")state.control.onUse=change;
  const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  await expect(authorizeCredentialAction({credential:{kind:"session-request",request:state.request},action:"google-calendar.workweek",target:{ownerProfileId:"owner-1"}})).rejects.toThrow();
  if(phase==="claim")expect(state.control.tokenPosts).toHaveLength(0);expect(state.provider).toHaveLength(0);
});

test("a configuration change during final Calendar binding validation prevents dispatch",async()=>{
  const state=await ownerAccess();let acquired=false;
  state.control.onUse=async()=>{acquired=true;};
  state.control.onVault=async()=>{if(acquired)vi.stubEnv("GOOGLE_WORKSPACE_CLIENT_ID","replacement-client");};
  await expect(state.write()).rejects.toThrow();expect(acquired).toBe(true);expect(state.provider).toHaveLength(0);
});

test.each(["lease","refresh"])("a Calendar %s deadline crossed while claiming cannot consume a refresh credential",async kind=>{
  const state=fixture(),started=Date.now();state.row.access_token_expires_at=new Date(started-1000).toISOString();
  if(kind==="refresh")state.row.refresh_token_expires_at=new Date(started+1000).toISOString();
  state.control.onClaim=async()=>{const current=Date.now();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(kind==="lease"?current+60000:started+1000);};
  const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  await expect(authorizeCredentialAction({credential:{kind:"session-request",request:state.request},action:"google-calendar.workweek",target:{ownerProfileId:"owner-1"}})).rejects.toThrow();
  expect(state.control.tokenPosts).toHaveLength(0);expect(state.provider).toHaveLength(0);
});

test("the actual status route does not probe Calendar after session expiry during acquisition",async()=>{
  const state=fixture();
  state.control.onUse=async()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(state.sessionExpires*1000);};
  const {GET}=await importTestModule("src/app/api/google-workspace/status/route.ts",{"server-only":{}});
  const result=await GET(new NextRequest("https://application.example.test/api/google-workspace/status",{headers:state.request.headers}));
  expect(result.status).toBe(200);expect(await result.json()).toMatchObject({connection:{state:"connected",calendarLabel:null},disconnectPending:false});
  expect(state.provider).toHaveLength(0);
});

test("a damaged encrypted connection retains the existing reconnect status after its first failed probe",async()=>{
  const state=fixture(),parts=state.row.encrypted_access_token.split(".");parts[2]=Buffer.alloc(16).toString("base64url");state.row.encrypted_access_token=parts.join(".");
  const {GET}=await importTestModule("src/app/api/google-workspace/status/route.ts",{"server-only":{}});
  const request=()=>new NextRequest("https://application.example.test/api/google-workspace/status",{headers:state.request.headers});
  expect((await (await GET(request())).json()).connection).toMatchObject({state:"connected",calendarLabel:null});
  expect((await (await GET(request())).json()).connection).toMatchObject({state:"reconnect_required"});
  expect(state.provider).toHaveLength(0);
});


test("disconnect confirms an observed provider effect after the initiating owner loses admission", async () => {
  const state = fixture(), transport = globalThis.fetch;
  let deleted = 0, confirmed = 0, finalized = 0, ownerMapped = true, phase = "cleaning";
  const operation = () => ({ id: "operation-1", owner_profile_id: "owner-1", requested_by: "owner", revoke_connection: true, state: phase, retained_version_id: null, deactivated_at: null, completed_at: null, last_error_class: null });
  const target = { id: "target-1", series_id: "series-1", calendar_id: "primary", google_event_id: "event-1", expected_etag: '"etag-1"', expected_founderops_revision: 1, cleanup_action: "delete", recurrence_count: null, state: "pending" };
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.endsWith("/rpc/current_authenticated_profile") && !ownerMapped) return Response.json(null);
    if (url.pathname === "/rest/v1/google_workspace_disconnect_operations") return Response.json(operation());
    if (url.pathname === "/rest/v1/team_workweek_publications") return Response.json([]);
    if (url.pathname === "/rest/v1/google_workspace_disconnect_series") return Response.json([target]);
    if (url.pathname.endsWith("/rpc/confirm_google_workspace_disconnect_series")) { confirmed++; return new Response(null, { status: 204 }); }
    if (url.pathname.endsWith("/rpc/finalize_google_workspace_disconnect")) { finalized++; phase = "revoke_pending"; return Response.json({ state: phase }); }
    if (url.hostname === "www.googleapis.com") {
      if (request.method === "DELETE") { deleted++; ownerMapped = false; return new Response(null, { status: 204 }); }
      return Response.json({ id: "event-1", etag: '"etag-1"', extendedProperties: { private: { founderopsWorkweekSeriesId: "series-1", founderopsWorkweekRevision: "1" } } });
    }
    return transport(request);
  });
  const { POST } = await importTestModule("src/app/api/google-workspace/disconnect/route.ts", { "server-only": {} });
  const response = await POST(new NextRequest("https://application.example.test/api/google-workspace/disconnect", { method: "POST", headers: state.request.headers, body: JSON.stringify({ confirm: true }) }));
  expect(deleted).toBe(1);
  expect(confirmed).toBe(1);
  expect(finalized).toBe(1);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ result: { state: "remove_pending", recovery: "retry" } });
});
