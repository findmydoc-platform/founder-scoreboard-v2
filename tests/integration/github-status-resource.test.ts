import { createCipheriv, generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { createCalendarLiveFixture } from "./helpers/calendar-live-fixture";

const mocks = { "server-only": {} };
const expiresAt = "2099-01-01T00:00:00.000Z";

async function withStatus(run: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const fixture = await setup();
  try { await run(fixture); }
  finally { await fixture.close(); }
}

async function setup() {
  const live = await createCalendarLiveFixture();
  await live.mode("linking");
  const actor = await live.actor("founder");
  const nativeFetch = globalThis.fetch;
  const key = Buffer.alloc(32, 19);
  const encrypt = (value: string) => {
    const cipher = createCipheriv("aes-256-gcm", key, Buffer.alloc(12, 11));
    const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return [Buffer.alloc(12, 11), cipher.getAuthTag(), bytes].map(part => part.toString("base64url")).join(".");
  };
  await live.database.query("update public.profiles set github_login='synthetic-author' where id=$1", [actor.profileId]);
  await live.database.query("insert into public.github_app_user_tokens(profile_id,github_login,github_user_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at) values($1,'synthetic-author',424242,$2,$3,$4,$4)", [actor.profileId, encrypt("synthetic-access"), encrypt("synthetic-refresh"), expiresAt]);
  const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: live.local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: live.local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: live.local.SERVICE_ROLE_KEY, REQUIRE_SUPABASE_AUTH: "true",
    GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-status-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-status@example.test",
    GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", VERCEL_OIDC_TOKEN: actor.session.access_token,
    GITHUB_APP_ID: "123", GITHUB_APP_INSTALLATION_ID: "456", GITHUB_APP_PRIVATE_KEY: privateKey,
    GITHUB_APP_CLIENT_ID: "synthetic-client", GITHUB_APP_CLIENT_SECRET: "synthetic-secret", GITHUB_TOKEN_ENCRYPTION_KEY: key.toString("base64"),
  })) vi.stubEnv(name, value);
  const attempts: Array<{ path: string; method: string }> = [];
  let provider = async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname === "/app/installations/456") return Response.json({ id: 456 });
    throw new Error("Unscripted synthetic GitHub request");
  };
  let beforeLocal: (request: Request) => Promise<Response | void> = async () => {};
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    attempts.push({ path: url.pathname, method: request.method });
    if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
    if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: expiresAt });
    if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
    if (url.origin === new URL(live.local.API_URL).origin) { const overridden = await beforeLocal(request); return overridden || nativeFetch(request); }
    if (url.hostname === "api.github.com" || url.href === "https://github.com/login/oauth/access_token") return provider(request);
    throw new Error("Unscripted external status request");
  });
  vi.resetModules();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", mocks);
  const { GET } = await importTestModule("src/app/api/github-app/status/route.ts", mocks);
  const request = () => new NextRequest("https://application.example.test/api/github-app/status", { headers: { authorization: `Bearer ${actor.session.access_token}` } });
  const authorize = () => authorizeCredentialAction({ credential: { kind: "session-request", request: request() }, action: "connection.github.read" });
  return { ...live, actor, createActor: live.actor, attempts, encrypt, request, authorize, authorizeCredentialAction, get: () => GET(request()),
    setProvider(value: typeof provider) { provider = value; },
    beforeLocal(value: typeof beforeLocal) { beforeLocal = value; },
    async close() { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); await live.close(); },
  };
}

it("complete GitHub status uses one resource admission while preserving installation status and unused user tokens", () => withStatus(async f => {
  const response = await f.get();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ installation: { available: true }, user: { connected: true, needsReconnect: false, expiresAt: "2099-01-01T00:00:00+00:00" }, waitingCommentCount: 0 });
  expect(f.attempts.filter(entry => entry.path === "/app/installations/456")).toEqual([{ path: "/app/installations/456", method: "GET" }]);
  expect(f.attempts.filter(entry => entry.path === "/rest/v1/task_comment_github_deliveries")).toEqual([{ path: "/rest/v1/task_comment_github_deliveries", method: "HEAD" }]);
  expect((await f.database.query("select last_used_at from public.github_app_user_tokens where profile_id=$1", [f.actor.profileId])).rows[0].last_used_at).toBeNull();
  // Cold route scope includes JWKS, directory proof, real Auth/REST and installation HTTP.
  expect(f.attempts).toHaveLength(36);
  expect(f.attempts.filter(entry => entry.path === "/rest/v1/rpc/workspace_linking_session_allowed")).toHaveLength(1);
  expect(f.attempts.filter(entry => entry.path === "/auth/v1/user")).toHaveLength(6);
  expect(f.attempts.filter(entry => entry.path === "/rest/v1/rpc/current_authenticated_profile")).toHaveLength(5);
  f.attempts.length = 0;
  expect((await f.get()).status).toBe(200);
  expect(f.attempts).toHaveLength(32);
}), 30_000);

it("waiting comments remain bound to the status owner and their waiting state", () => withStatus(async f => {
  const other = await f.createActor("founder");
  const task = `${f.actor.profileId}-task`, initiative = `${task}-initiative`;
  try {
    await f.database.query("insert into public.projects(id,name) values($1,'Synthetic status project')", [task]);
    await f.database.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status) values($1,$2,'Synthetic initiative','initiative','Offen','P2','approved')", [initiative, task]);
    await f.database.query("insert into public.tasks(id,project_id,title,status,priority,approval_status,parent_task_id) values($1,$1,'Synthetic task','Offen','P2','approved',$2)", [task, initiative]);
    for (const [profile, status] of [[f.actor.profileId, "waiting_for_author_connection"], [f.actor.profileId, "pending"], [other.profileId, "waiting_for_author_connection"]]) {
      const comment = (await f.database.query("insert into public.task_comments(task_id,profile_id,comment) values($1,$2,'Synthetic waiting comment') returning id", [task, profile])).rows[0];
      await f.database.query("insert into public.task_comment_github_deliveries(task_comment_id,task_id,author_profile_id,status) values($1,$2,$3,$4)", [comment.id, task, profile, status]);
    }
    expect(await (await f.get()).json()).toMatchObject({ waitingCommentCount: 1, user: { connected: true } });
  } finally {
    await f.database.query("select set_config('founderops.trash_lifecycle_write','on',false)");
    await f.database.query("delete from public.tasks where id=$1", [task]);
    await f.database.query("delete from public.tasks where id=$1", [initiative]);
    await f.database.query("delete from public.projects where id=$1", [task]);
  }
}), 30_000);

it.each(["ceo", "deputy", "founder", "viewer"])("%s retains the existing GitHub status permission", role => withStatus(async f => {
  await f.database.query("update public.profiles set platform_role=$1 where id=$2", [role, f.actor.profileId]);
  expect((await f.get()).status).toBe(200);
}), 30_000);

it("anonymous and unmapped actors cannot acquire status", () => withStatus(async f => {
  const { GET } = await importTestModule("src/app/api/github-app/status/route.ts", mocks);
  expect((await GET(new NextRequest("https://application.example.test/api/github-app/status"))).status).toBe(401);
  await f.database.query("update public.profiles set auth_user_id=null where id=$1", [f.actor.profileId]);
  expect((await f.get()).status).toBe(403);
  expect(f.attempts.filter(entry => entry.path === "/rest/v1/github_app_user_tokens" || entry.path === "/app/installations/456")).toHaveLength(0);
}), 30_000);

it.each(["session", "profile", "role", "workspace"])("held status rejects live %s changes before reading credentials", change => withStatus(async f => {
  const held = await f.authorize();
  if (!held.ok) throw new Error("Expected admitted status resource");
  if (change === "session") await f.database.query("delete from auth.sessions where id=$1", [f.actor.sessionId]);
  if (change === "profile") await f.database.query("update public.profiles set auth_user_id=null where id=$1", [f.actor.profileId]);
  if (change === "role") await f.database.query("update public.profiles set platform_role='viewer' where id=$1", [f.actor.profileId]);
  if (change === "workspace") await f.mode("google");
  f.attempts.length = 0;
  await expect(held.resource.readGitHubConnection()).rejects.toThrow();
  expect(f.attempts.filter(entry => entry.path === "/rest/v1/profiles" || entry.path === "/rest/v1/github_app_user_tokens")).toHaveLength(0);
}), 30_000);

it.each(["revoked", "association"])("held status observes live %s connection changes", change => withStatus(async f => {
  const held = await f.authorize();
  if (!held.ok) throw new Error("Expected admitted status resource");
  if (change === "revoked") await f.database.query("update public.github_app_user_tokens set revoked_at=now() where profile_id=$1", [f.actor.profileId]);
  else await f.database.query("update public.profiles set github_login='different-owner' where id=$1", [f.actor.profileId]);
  expect(await held.resource.readGitHubConnection()).toMatchObject({ user: { connected: false, needsReconnect: true, expiresAt: null } });
}), 30_000);

it("status rotates an expiring token once and preserves independent installation failure", () => withStatus(async f => {
  await f.database.query("update public.github_app_user_tokens set access_token_expires_at=now()-interval '1 second' where profile_id=$1", [f.actor.profileId]);
  let refreshes = 0;
  f.setProvider(async request => {
    if (new URL(request.url).hostname === "github.com") { refreshes++; return Response.json({ access_token: "synthetic-rotated", refresh_token: "synthetic-rotated-refresh", expires_in: 3600, refresh_token_expires_in: 7200 }); }
    return Response.json({ message: "synthetic installation unavailable" }, { status: 503 });
  });
  const response = await f.get();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toMatchObject({ installation: { available: false }, user: { connected: true, needsReconnect: false }, waitingCommentCount: 0 });
  expect(Date.parse(body.user.expiresAt)).toBeGreaterThan(Date.now());
  const row = (await f.database.query("select credential_version,last_used_at,refresh_claim_id,encrypted_access_token from public.github_app_user_tokens where profile_id=$1", [f.actor.profileId])).rows[0];
  expect(Number(row.credential_version)).toBe(1);
  expect(row.refresh_claim_id).toBeNull();
  expect(row.last_used_at).not.toBeNull();
  expect(row.encrypted_access_token).not.toContain("synthetic-rotated");
  expect(refreshes).toBe(1);
}), 30_000);

it("status retains reconnect response after unknown refresh outcome", () => withStatus(async f => {
  await f.database.query("update public.github_app_user_tokens set access_token_expires_at='2000-01-01' where profile_id=$1", [f.actor.profileId]);
  let refreshes = 0;
  f.setProvider(async request => {
    if (new URL(request.url).hostname === "github.com") { refreshes++; throw new Error("Synthetic consumed refresh response lost"); }
    return Response.json({ id: 456 });
  });
  const response = await f.get();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ installation: { available: true }, user: { connected: false, needsReconnect: true, expiresAt: "2000-01-01T00:00:00+00:00" }, waitingCommentCount: 0 });
  expect((await f.get()).status).toBe(200);
  expect(refreshes).toBe(1);
}), 30_000);

it("a replacement connection during refresh cannot be overwritten or reported as the old connected snapshot", () => withStatus(async f => {
  await f.database.query("update public.github_app_user_tokens set access_token_expires_at='2000-01-01' where profile_id=$1", [f.actor.profileId]);
  f.setProvider(async request => {
    if (new URL(request.url).hostname !== "github.com") return Response.json({ id: 456 });
    const current = (await f.database.query("select connection_id,credential_version from public.github_app_user_tokens where profile_id=$1", [f.actor.profileId])).rows[0];
    const replaced = await f.database.query("select public.store_github_user_connection($1,'synthetic-author',424242,$2,$3,$4,$4,$5,$6) as stored", [f.actor.profileId, f.encrypt("synthetic-replacement"), f.encrypt("synthetic-replacement-refresh"), expiresAt, current.connection_id, current.credential_version]);
    expect(replaced.rows[0].stored).toBe(true);
    return Response.json({ access_token: "synthetic-stale", refresh_token: "synthetic-stale-refresh", expires_in: 3600 });
  });
  expect(await (await f.get()).json()).toMatchObject({ user: { connected: false, needsReconnect: true, expiresAt: "2000-01-01T00:00:00+00:00" } });
  const held = await f.authorize();
  if (!held.ok) throw new Error("Expected replacement status resource");
  expect(await held.resource.readGitHubConnection()).toMatchObject({ user: { connected: true, needsReconnect: false, expiresAt: "2099-01-01T00:00:00+00:00" } });
}), 30_000);

it("authority loss after credential read blocks refresh dispatch", () => withStatus(async f => {
  await f.database.query("update public.github_app_user_tokens set access_token_expires_at='2000-01-01' where profile_id=$1", [f.actor.profileId]);
  const held = await f.authorize();
  if (!held.ok) throw new Error("Expected admitted status resource");
  f.beforeLocal(async request => {
    if (new URL(request.url).pathname === "/rest/v1/github_app_user_tokens") await f.database.query("delete from auth.sessions where id=$1", [f.actor.sessionId]);
  });
  await expect(held.resource.readGitHubConnection()).rejects.toThrow();
  expect(f.attempts.filter(entry => entry.path === "/login/oauth/access_token" || entry.path === "/rest/v1/rpc/claim_github_user_refresh")).toHaveLength(0);
}), 30_000);

it("pending-count failure remains unknown while a final live authority change still blocks the result", () => withStatus(async f => {
  f.beforeLocal(async request => new URL(request.url).pathname === "/rest/v1/task_comment_github_deliveries" ? Response.json({ message: "Synthetic count failure" }, { status: 500 }) : undefined);
  expect(await (await f.get()).json()).toMatchObject({ waitingCommentCount: null, user: { connected: true } });
  const held = await f.authorize();
  if (!held.ok) throw new Error("Expected admitted status resource");
  f.beforeLocal(async request => {
    if (new URL(request.url).pathname === "/rest/v1/task_comment_github_deliveries") await f.database.query("update public.profiles set platform_role='viewer' where id=$1", [f.actor.profileId]);
  });
  await expect(held.resource.readGitHubConnection()).rejects.toThrow();
}), 30_000);

it("the standalone session status keeps its original response and missing connection behavior", () => withStatus(async f => {
  const status = () => f.authorizeCredentialAction({ credential: { kind: "session-request", request: f.request() }, action: "github.connection.status" });
  expect(await status()).toEqual({ connected: true, needsReconnect: false, expiresAt: "2099-01-01T00:00:00+00:00" });
  await f.database.query("delete from public.github_app_user_tokens where profile_id=$1", [f.actor.profileId]);
  expect(await status()).toEqual({ connected: false, needsReconnect: true, expiresAt: null });
  expect(await (await f.get()).json()).toEqual({ installation: { available: true }, user: { connected: false, needsReconnect: true, expiresAt: null }, waitingCommentCount: 0 });
}), 30_000);
