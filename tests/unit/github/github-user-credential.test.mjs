import { afterEach, expect, test, vi } from "vitest";
import { createCipheriv, createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });

function encrypted(value) {
  const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 1), Buffer.alloc(12, 2));
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [Buffer.alloc(12, 2), cipher.getAuthTag(), bytes].map(part => part.toString("base64url")).join(".");
}
function fixture() {
  for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://vault.example.test", SUPABASE_URL: "https://vault.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", SUPABASE_SECRET_KEY: "synthetic-service", NEXT_PUBLIC_SUPABASE_ANON_KEY:"synthetic-anon", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"synthetic-anon", SUPABASE_ANON_KEY:"synthetic-anon", SUPABASE_PUBLISHABLE_KEY:"synthetic-anon", REQUIRE_SUPABASE_AUTH:"true", GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32,1).toString("base64") })) vi.stubEnv(name,value);
  const row = { profile_id: "author-1", github_login: "author", github_user_id: 42, encrypted_access_token: encrypted("synthetic-user"), encrypted_refresh_token: encrypted("synthetic-refresh"), access_token_expires_at: new Date(Date.now()+3600000).toISOString(), refresh_token_expires_at: new Date(Date.now()+7200000).toISOString(), connection_id: "connection-1", credential_version: 0, refresh_claim_id: null, revoked_at: null };
  const requests = [];
  const control={vaultReads:0,onVault:async()=>{},onUse:async()=>{},ownedTasks:new Set(["task-1","task-2"]),expectedToken:"synthetic-user",lockedAt:new Date().toISOString()};
  vi.stubGlobal("fetch", async (input, options) => {
    const request = new Request(input,options); const url = new URL(request.url);
    if (url.hostname === "api.github.com") {
      requests.push(request);
      expect(request.headers.get("authorization")).toBe(`Bearer ${control.expectedToken}`);
      return Response.json({ id: 77, html_url: "https://github.com/findmydoc-platform/management/issues/1#issuecomment-77" });
    }
    if (url.pathname === "/auth/v1/user") return Response.json({id:"user-1",aud:"authenticated",identities:[]});
    if (url.pathname.endsWith("/rpc/workspace_access_context")) return Response.json({mode:"legacy",linkingEnforced:false,userId:"user-1",profileId:"author-1"});
    if (url.pathname.endsWith("/rpc/current_authenticated_profile")) return Response.json({id:"author-1",name:"Author",platform_role:"founder"});
    if (url.pathname.endsWith("/rpc/administrator_access_snapshot")) return Response.json({eligible:false,active:false});
    if (url.pathname === "/rest/v1/profiles") return Response.json({ id: "author-1", github_login: "author" });
    if (url.pathname === "/rest/v1/github_app_user_tokens") {control.vaultReads++;await control.onVault();return Response.json(row);}
    if (url.pathname === "/rest/v1/task_comment_github_deliveries") return Response.json({ task_comment_id: 5, task_id: "task-1", author_profile_id: "author-1", status: "processing", lock_token: "claim-1", locked_at: control.lockedAt });
    if (url.pathname === "/rest/v1/task_comments") return Response.json({ id: 5, task_id: "task-1", profile_id: "author-1" });
    if (url.pathname === "/rest/v1/active_tasks") {const id=url.searchParams.get("id")?.replace(/^eq\./,"") || "task-1";return Response.json({ id, github_repo: "findmydoc-platform/management", github_issue_number: 1, task_type:"deliverable",status:"Offen",assignee:control.ownedTasks.has(id)?"author-1":"other-owner",owner:control.ownedTasks.has(id)?"author-1":"other-owner",review_status:"not_requested",score_final:false });}
    if (url.pathname === "/rest/v1/rpc/use_github_user_connection") {await control.onUse();return Response.json(true);}
    throw new Error(`Unexpected synthetic protocol ${url.pathname}`);
  });
  return { row, requests, control };
}

test("a claimed authored comment uses its bound encrypted user connection without exposing a token", async () => {
  const state=fixture();
  const { authorizeCredentialAction }=await importTestModule("src/lib/credentials/index.ts", {"server-only":{}});
  const { createGitHubIssueComment }=await importTestModule("src/lib/github.ts");
  const access=await authorizeCredentialAction({ credential:{kind:"github-comment-delivery",commentId:5,claimToken:"claim-1"},action:"github.comment.deliver" });
  expect(access).toMatchObject({ok:true});
  expect(JSON.stringify(access)).not.toContain("synthetic-user");
  expect(await createGitHubIssueComment(1,"Authored",access.github,"fmd-comment-id:5")).toMatchObject({id:77});
  expect(state.requests).toHaveLength(1);
});


test.each(["revoked","different-account"])("%s user connections cannot authorize authored writes",async condition=>{
  const state=fixture();
  if(condition==="revoked") state.row.revoked_at=new Date().toISOString();
  else state.row.github_login="different-account";
  const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  await expect(authorizeCredentialAction({credential:{kind:"github-comment-delivery",commentId:5,claimToken:"claim-1"},action:"github.comment.deliver"})).rejects.toThrow("Verbindung fehlt");
  expect(state.requests).toHaveLength(0);
});

async function claimedAccess() {
  const state=fixture();
  const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  const {createGitHubIssueComment}=await importTestModule("src/lib/github.ts");
  const access=await authorizeCredentialAction({credential:{kind:"github-comment-delivery",commentId:5,claimToken:"claim-1"},action:"github.comment.deliver"});
  return {...state,send:()=>createGitHubIssueComment(1,"Authored",access.github,"fmd-comment-id:5")};
}
test("a claim that expires while user-token acquisition is pending cannot dispatch a comment",async()=>{
  const state=await claimedAccess();
  let release,started;const held=new Promise(r=>{release=r;}),entered=new Promise(r=>{started=r;});
  state.control.onUse=async()=>{started();await held;};
  const write=state.send();await entered;
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.parse(state.control.lockedAt)+120000);
  release();await expect(write).rejects.toThrow();expect(state.requests).toHaveLength(0);
});
test("an issued capability cannot acquire a replacement connection's user token",async()=>{
  const state=await claimedAccess();let reads=0;
  state.control.onVault=async()=>{if(++reads===2){state.row.connection_id="replacement";state.row.encrypted_access_token=encrypted("synthetic-new-connection");}};
  await expect(state.send()).rejects.toThrow();expect(state.requests).toHaveLength(0);
});
test("a claim deadline crossed during the final vault binding read is checked synchronously before dispatch",async()=>{
  const state=await claimedAccess();let acquired=false,crossed=false;
  state.control.onUse=async()=>{acquired=true;};
  state.control.onVault=async()=>{if(acquired){crossed=true;vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(Date.parse(state.control.lockedAt)+120000);}};
  await expect(state.send()).rejects.toThrow();expect(crossed).toBe(true);expect(state.requests).toHaveLength(0);
});

test.each(["acquisition","final-binding"])("a human session that expires during %s cannot dispatch an attachment",async stage=>{
  const state=fixture(),expires=Math.floor(Date.now()/1000)+60;
  const encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned=`${encode({alg:"HS256",typ:"JWT"})}.${encode({iss:"https://vault.example.test/auth/v1",sub:"user-1",aud:"authenticated",role:"authenticated",session_id:"00000000-0000-4000-8000-000000000001",exp:expires})}`;
  const token=`${unsigned}.${createHmac("sha256","synthetic-signature").update(unsigned).digest("base64url")}`;
  const request=new NextRequest("https://application.example.test/api/tasks/task-1/attachments",{headers:{authorization:`Bearer ${token}`}});
  const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  const path=".fmd-attachments/tasks/task-1/controlled.txt";
  const access=await authorizeCredentialAction({credential:{kind:"session-request",request},action:"github.attachment.write",target:{taskId:"task-1",repository:"findmydoc-platform/management",path}});
  const expire=()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(expires*1000);};
  let acquired=false,crossed=false;
  state.control.onUse=async()=>{acquired=true;if(stage==="acquisition"){crossed=true;expire();}};
  state.control.onVault=async()=>{if(stage==="final-binding" && acquired){crossed=true;expire();}};
  await expect(access.github.request(`https://api.github.com/repos/findmydoc-platform/management/contents/${path}`,{method:"PUT",operation:"mutation",body:{content:"aGVsbG8="}})).rejects.toThrow();
  expect(crossed).toBe(true);expect(state.requests).toHaveLength(0);
});

test("legitimate credential rotation within the issued connection remains usable",async()=>{
  const state=await claimedAccess();let reads=0;
  state.control.onVault=async()=>{if(++reads===2){state.row.credential_version++;state.row.encrypted_access_token=encrypted("synthetic-rotated");state.control.expectedToken="synthetic-rotated";}};
  expect(await state.send()).toMatchObject({id:77});expect(state.requests).toHaveLength(1);
});
test("known access-token expiry crossed during final validation cannot dispatch",async()=>{
  const state=await claimedAccess(),expires=Date.now()+61000;let acquired=false;
  state.row.access_token_expires_at=new Date(expires).toISOString();
  state.control.onUse=async()=>{acquired=true;};
  state.control.onVault=async()=>{if(acquired){vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(expires);}};
  await expect(state.send()).rejects.toThrow();expect(state.requests).toHaveLength(0);
});

test("an attachment target cannot be rebound to another task after its original ownership changes",async()=>{
  const state=fixture(),encode=value=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned=`${encode({alg:"HS256",typ:"JWT"})}.${encode({iss:"https://vault.example.test/auth/v1",sub:"user-1",aud:"authenticated",role:"authenticated",session_id:"00000000-0000-4000-8000-000000000001",exp:Math.floor(Date.now()/1000)+3600})}`;
  const token=`${unsigned}.${createHmac("sha256","synthetic-signature").update(unsigned).digest("base64url")}`;
  const request=new NextRequest("https://application.example.test/api/tasks/task-1/attachments",{headers:{authorization:`Bearer ${token}`}});
  const {authorizeCredentialAction}=await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
  const path=".fmd-attachments/tasks/task-1/controlled.txt";
  const input={credential:{kind:"session-request",request},action:"github.attachment.write",target:{taskId:"task-1",repository:"findmydoc-platform/management",path}};
  const access=await authorizeCredentialAction(input);
  state.control.ownedTasks.delete("task-1");input.target.taskId="task-2";
  await expect(access.github.request(`https://api.github.com/repos/findmydoc-platform/management/contents/${path}`,{method:"PUT",operation:"mutation",body:{content:"aGVsbG8="}})).rejects.toThrow();
  expect(state.requests).toHaveLength(0);
});
