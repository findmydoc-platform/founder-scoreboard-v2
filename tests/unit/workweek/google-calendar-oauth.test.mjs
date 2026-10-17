import {beforeEach,afterEach,expect,test,vi} from "vitest";
import {NextRequest,NextResponse} from "next/server";
import {createHmac} from "node:crypto";
import {importTestModule} from "../../helpers/vitest-module.mjs";
const authOrigin="https://calendar-auth.example.test",appOrigin="https://application.example.test";
let jar,userId,configuredLogin,providerLogin,vault,exchanges,stores,queued,calendarStatus,expireExchange;
function setupSession() {
  const exp=Math.floor(Date.now()/1000)+3600;
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const data=`${encode({alg:"HS256",typ:"JWT"})}.${encode({sub:userId,exp,aud:"authenticated",role:"authenticated",iss:`${authOrigin}/auth/v1`,session_id:"b1111111-1111-4111-8111-111111111111",amr:[{method:"oauth"}]})}`;
  const access=`${data}.${createHmac("sha256","synthetic-signing-key").update(data).digest("base64url")}`;
  const session={access_token:access,refresh_token:"synthetic-session-refresh",expires_at:exp,expires_in:3600,token_type:"bearer",user:{id:userId,aud:"authenticated",user_metadata:{}}};
  const values=new Map([["sb-calendar-auth-auth-token",`base64-${encode(session)}`]]);
  jar={getAll:()=>[...values].map(([name,value])=>({name,value})),set:(name,value)=>values.set(name,value)};
}
beforeEach(()=>{
  vi.resetModules();userId="user-1";configuredLogin="synthetic-author";providerLogin="https://www.googleapis.com/auth/calendar.events.owned";vault=null;exchanges=0;stores=[];queued=[];calendarStatus=200;expireExchange=false;setupSession();
  for(const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:authOrigin,SUPABASE_URL:authOrigin,NEXT_PUBLIC_SUPABASE_ANON_KEY:"synthetic-anon",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",SUPABASE_SERVICE_ROLE_KEY:"synthetic-service",SUPABASE_SECRET_KEY:"synthetic-service",SUPABASE_ANON_KEY:"synthetic-anon",SUPABASE_PUBLISHABLE_KEY:"synthetic-anon",REQUIRE_SUPABASE_AUTH:"true",GOOGLE_WORKSPACE_CLIENT_ID:"synthetic-client",GOOGLE_WORKSPACE_CLIENT_SECRET:"synthetic-secret",GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY:Buffer.alloc(32,3).toString("base64"),APP_URL:appOrigin,VERCEL_ENV:"preview"})) vi.stubEnv(name,value);
  vi.stubGlobal("fetch",async(input,options)=>{
    const request=new Request(input,options),url=new URL(request.url);
    if(url.href==="https://oauth2.googleapis.com/token") {exchanges++;if(expireExchange){vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+600000);}return Response.json({access_token:"synthetic-calendar-user",refresh_token:"synthetic-calendar-refresh",expires_in:3600,refresh_token_expires_in:7200,token_type:"Bearer",scope:providerLogin});}
    if(url.hostname==="www.googleapis.com") return Response.json({kind:"calendar#events",summary:"Synthetic calendar"},{status:calendarStatus});
    if(url.origin!==authOrigin) throw new Error("Unexpected synthetic protocol");
    if(url.pathname==="/auth/v1/user") return Response.json({id:userId,aud:"authenticated",user_metadata:{}});
    if(url.pathname.endsWith("/rpc/workspace_access_context")) return Response.json({mode:"legacy",linkingEnforced:false,userId,profileId:"profile-1",linked:false,identity:null});
    if(url.pathname.endsWith("/rpc/current_authenticated_profile")) return Response.json({id:"profile-1",name:"Synthetic author",platform_role:"founder"});
    if(url.pathname.endsWith("/rpc/administrator_access_snapshot")) return Response.json({eligible:false,active:false});
    if(url.pathname==="/rest/v1/google_workspace_connections") return Response.json(vault);
    if(url.pathname==="/rest/v1/profiles") return Response.json({github_login:configuredLogin});
    if(url.pathname.endsWith("/rpc/store_google_calendar_connection")) {const stored=await request.json();stores.push(stored);vault={connection_id:"connection-1",credential_version:0,...stored};return Response.json(true);}
    throw new Error(`Unexpected synthetic protocol ${url.pathname}`);
  });
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
async function routes() {
  const mocks={"server-only":{},"next/headers":{cookies:async()=>jar},"next/server":{NextRequest,NextResponse,after:callback=>queued.push(callback)}};
  await importTestModule("src/lib/credentials/index.ts",mocks);
  return {start:await importTestModule("src/app/api/google-workspace/connect/route.ts",mocks),callback:await importTestModule("src/app/api/google-workspace/callback/route.ts",mocks)};
}
async function begin(next="/team") {
  const api=await routes();const start=await api.start.GET(new NextRequest(`${appOrigin}/api/google-workspace/connect?next=${encodeURIComponent(next)}`));
  const destination=new URL(start.headers.get("location"));
  return {api,state:destination.searchParams.get("state"),destination};
}
function callback(state) {return new NextRequest(`${appOrigin}/api/google-workspace/callback?code=synthetic-code&state=${encodeURIComponent(state)}`);}
test("real Calendar connect/callback stores encrypted profile-bound credentials with exact offline scope",async()=>{
  const {api,state,destination}=await begin();
  expect(destination.origin).toBe("https://accounts.google.com");
  expect(destination.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.events.owned");
  expect(destination.searchParams.get("access_type")).toBe("offline");
  const result=await api.callback.GET(callback(state));
  expect(new URL(result.headers.get("location")).pathname).toBe("/team");
  expect(exchanges).toBe(1);expect(stores).toHaveLength(1);
  expect(stores[0].p_profile_id).toBe("profile-1");
  expect(stores[0].p_access).not.toContain("synthetic-calendar-user");expect(stores[0].p_refresh).not.toContain("synthetic-calendar-refresh");
  expect(stores[0].p_access_expires).not.toBe(stores[0].p_refresh_expires);
});
test.each(["signature","expired","different-session","wrong-scope","primary-denied","expires-during-exchange"])("real callback rejects %s before replacing a connection",async change=>{
  const started=await begin();let state=started.state;
  if(change==="signature") state=state.slice(0,-2)+"xx";
  if(change==="expired") {vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.now()+600000);}
  if(change==="different-session") {userId="other-user";setupSession();}
  if(change==="expires-during-exchange") expireExchange=true;
  if(change==="primary-denied") calendarStatus=403;
  if(change==="wrong-scope") providerLogin="https://www.googleapis.com/auth/calendar";
  const result=await started.api.callback.GET(callback(state));
  expect(new URL(result.headers.get("location")).searchParams.get("googleWorkspace")).toBe("connection_error");
  expect(stores).toHaveLength(0);expect(queued).toHaveLength(0);
  expect(exchanges).toBe(["wrong-scope","primary-denied","expires-during-exchange"].includes(change) ? 1:0);
});
test("connect rejects external and backslash next destinations",async()=>{
  const {api,state}=await begin("/\\evil.example.test/path");
  const result=await api.callback.GET(callback(state));
  expect(new URL(result.headers.get("location")).pathname).toBe("/team");
});
