import { afterEach, expect, test, vi } from "vitest";
import { createCipheriv } from "node:crypto";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); });

function encrypted(value) {
  const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32, 1), Buffer.alloc(12, 2));
  const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [Buffer.alloc(12, 2), cipher.getAuthTag(), bytes].map(part => part.toString("base64url")).join(".");
}
function fixture() {
  for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: "https://vault.example.test", SUPABASE_URL: "https://vault.example.test", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", GITHUB_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32,1).toString("base64") })) vi.stubEnv(name,value);
  const row = { profile_id: "author-1", github_login: "author", github_user_id: 42, encrypted_access_token: encrypted("synthetic-user"), encrypted_refresh_token: encrypted("synthetic-refresh"), access_token_expires_at: new Date(Date.now()+3600000).toISOString(), refresh_token_expires_at: new Date(Date.now()+7200000).toISOString(), connection_id: "connection-1", credential_version: 0, refresh_claim_id: null, revoked_at: null };
  const requests = [];
  vi.stubGlobal("fetch", async (input, options) => {
    const request = new Request(input,options); const url = new URL(request.url);
    if (url.hostname === "api.github.com") {
      requests.push(request);
      expect(request.headers.get("authorization")).toBe("Bearer synthetic-user");
      return Response.json({ id: 77, html_url: "https://github.com/findmydoc-platform/management/issues/1#issuecomment-77" });
    }
    if (url.pathname === "/rest/v1/profiles") return Response.json({ id: "author-1", github_login: "author" });
    if (url.pathname === "/rest/v1/github_app_user_tokens") return Response.json(row);
    if (url.pathname === "/rest/v1/task_comment_github_deliveries") return Response.json({ task_comment_id: 5, task_id: "task-1", author_profile_id: "author-1", status: "processing", lock_token: "claim-1", locked_at: new Date().toISOString() });
    if (url.pathname === "/rest/v1/task_comments") return Response.json({ id: 5, task_id: "task-1", profile_id: "author-1" });
    if (url.pathname === "/rest/v1/active_tasks") return Response.json({ id: "task-1", github_repo: "findmydoc-platform/management", github_issue_number: 1 });
    if (url.pathname === "/rest/v1/rpc/use_github_user_connection") return Response.json(true);
    throw new Error(`Unexpected synthetic protocol ${url.pathname}`);
  });
  return { row, requests };
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
