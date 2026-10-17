import { localSupabaseStatus } from "../../helpers/local-supabase-target.mjs";
import { createCipheriv, createHmac, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import pg from "pg";
import { vi } from "vitest";

type ActorName = "ceo" | "deputy" | "founder" | "other" | "viewer" | "administrator" | "unmapped";
export type PlanningDatabaseActor = { profileId: string; userId: string; sessionId: string; token: string; subject: string };

// Fixtures verify the configured local test target; the runner owns environment isolation.
export async function withPlanningCredentialDatabase(run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>, mode: "legacy" | "linking" = "legacy") {
  const fixture = await createFixture(mode);
  let failure: unknown;
  try { await run(fixture); } catch (error) { failure = error; }
  try { await fixture.cleanup(); } catch (error) {
    if (failure) throw new AggregateError([failure, error], "Planning acceptance and fixture cleanup both failed");
    throw error;
  }
  if (failure) throw failure;
}

async function createFixture(mode: "legacy" | "linking") {
  const local = await localSupabaseStatus();
  const api = new URL(local.API_URL);
  const db = new pg.Client(local.DB_URL);
  await db.connect();
  const prefix = `planning-auth-${randomUUID()}`;
  const projectExisted = (await db.query("select exists(select 1 from public.projects where id='findmydoc-founder-execution') as present")).rows[0].present;
  const initiativeId = `${prefix}-initiative`, epicId = `${prefix}-epic`;
  const nativeFetch = globalThis.fetch;
  const previous = (await db.query("select mode,linking_enforced from workspace_private.configuration")).rows[0];
  const actors = Object.fromEntries(["ceo", "deputy", "founder", "other", "viewer", "administrator", "unmapped"].map(name => [name, { profileId: `${prefix}-${name}`, userId: randomUUID(), sessionId: randomUUID(), subject: randomUUID(), token: "" }])) as Record<ActorName, PlanningDatabaseActor>;
  const observed: Array<{ path: string; method: string; actor: ActorName | null; permit: boolean }> = [];
  let provider: (request: Request) => Promise<Response> = async () => { throw new Error("Unscripted Planning provider request"); };
  const encryptionKey = Buffer.alloc(32, 17);
  const encrypt = (value: string) => {
    const iv = Buffer.alloc(12, 23), cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
    const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), bytes.toString("base64url")].join(".");
  };
  const cleanup = async () => {
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules();
    const profileIds = Object.values(actors).map(actor => actor.profileId), userIds = Object.values(actors).map(actor => actor.userId);
    try {
      await db.query("delete from public.notification_events where actor_profile_id=any($1) or recipient_profile_id=any($1)", [profileIds]);
      await db.query("delete from public.audit_log where actor_profile_id=any($1)", [profileIds]);
      await db.query("select set_config('founderops.trash_lifecycle_write','on',false)");
      await db.query("delete from public.tasks where id like $1", [`${prefix}%`]);
      // API-created IDs and detached lifecycle rows share this fixture's unique UUID namespace.
      await db.query("delete from public.planning_github_lifecycle_outbox where task_id like $1 or root_id like $1", [`${prefix}%`]);
      await db.query("delete from public.sprints where id like $1", [`${prefix}%`]);
      if (!projectExisted) await db.query("delete from public.projects where id='findmydoc-founder-execution'");
      await db.query("delete from public.google_workspace_disconnect_series where operation_id in (select id from public.google_workspace_disconnect_operations where owner_profile_id=any($1))", [profileIds]);
      await db.query("delete from public.google_workspace_disconnect_operations where owner_profile_id=any($1)", [profileIds]);
      await db.query("delete from public.team_workweek_publications where owner_profile_id=any($1)", [profileIds]);
      await db.query("delete from public.team_workweek_versions where owner_profile_id=any($1)", [profileIds]);
      await db.query("delete from workspace_private.request_permits where user_id=any($1)", [userIds]);
      await db.query("delete from workspace_private.google_login_sessions where user_id=any($1)", [userIds]);
      await db.query("delete from workspace_private.identity_bindings where user_id=any($1)", [userIds]);
      await db.query("delete from public.profiles where id=any($1)", [profileIds]);
      await db.query("delete from auth.users where id=any($1)", [userIds]);
    } finally {
      try { await db.query("update workspace_private.configuration set mode=$1,linking_enforced=$2", [previous.mode, previous.linking_enforced]); }
      finally { await db.end(); }
    }
  };
  try {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    for (const [name, actor] of Object.entries(actors)) {
      await db.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values($1,$2,'authenticated','authenticated',now())", [actor.userId, `${actor.profileId}@example.test`]);
      if (name !== "unmapped") await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,$3,$4)", [actor.profileId, actor.userId, `Synthetic ${name}`, name === "other" || name === "administrator" ? "founder" : name]);
      await db.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,now())", [actor.sessionId, actor.userId]);
      await db.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values($1,'google',$2,$3)", [actor.userId, actor.subject, JSON.stringify({ sub: actor.subject, iss: "https://accounts.google.com", email: `${actor.profileId}@findmydoc.eu`, email_verified: true, custom_claims: { hd: "findmydoc.eu" } })]);
      await db.query("insert into workspace_private.identity_bindings(user_id,google_subject) values($1,$2)", [actor.userId, actor.subject]);
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: `${local.API_URL}/auth/v1`, sub: actor.userId, aud: "authenticated", role: "authenticated", session_id: actor.sessionId, iat: now, exp: now + 3600, amr: [{ method: "oauth", timestamp: now }] })}`;
      actor.token = `${unsigned}.${createHmac("sha256", local.JWT_SECRET).update(unsigned).digest("base64url")}`;
    }
    await db.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic Planning acceptance') on conflict(id) do nothing");
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner) values($1,'findmydoc-founder-execution','Synthetic acceptance Epic','epic','Offen','P2',$2)", [epicId, actors.ceo.profileId]);
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,assignee) values($1,'findmydoc-founder-execution','Synthetic acceptance Initiative','initiative','Offen','P2','approved',$2,$3,$3)", [initiativeId, epicId, actors.founder.profileId]);
    await db.query("update workspace_private.configuration set mode=$1,linking_enforced=$2", [mode, mode === "linking"]);
    if (mode === "linking") for (const actor of Object.values(actors)) await db.query("select public.workspace_record_google_login($1,$2,$3)", [actor.userId, actor.sessionId, actor.subject]);
    await db.query("insert into public.administrator_access_grants(profile_id,eligible,active_until) values($1,true,now()+interval '1 hour')", [actors.administrator.profileId]);
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: local.API_URL, SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY, REQUIRE_SUPABASE_AUTH: "true",
      GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-planning-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-planning@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", VERCEL_OIDC_TOKEN: actors.founder.token,
      GOOGLE_WORKSPACE_CLIENT_ID: "synthetic-planning-client", GOOGLE_WORKSPACE_CLIENT_SECRET: "synthetic-planning-secret", GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: encryptionKey.toString("base64"),
      GITHUB_APP_ID: "", GITHUB_APP_INSTALLATION_ID: "", GITHUB_APP_PRIVATE_KEY: "", GITHUB_APP_PRIVATE_KEY_PATH: "", GITHUB_APP_CLIENT_ID: "", GITHUB_APP_CLIENT_SECRET: "", GITHUB_TOKEN_ENCRYPTION_KEY: "",
      GOOGLE_CHAT_WEBHOOK_URL: "", GOOGLE_CHAT_PRIVATE_KEY: "", GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL: "" })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      const entry = Object.entries(actors).find(([, actor]) => request.headers.get("authorization") === `Bearer ${actor.token}`);
      if (url.origin === api.origin) {
        if (url.pathname === "/auth/v1/user") {
          const actor = entry?.[1];
          const active = actor && (await db.query("select exists(select 1 from auth.sessions where id=$1 and user_id=$2) as active", [actor.sessionId, actor.userId])).rows[0].active;
          return actor && active ? Response.json({ id: actor.userId, aud: "authenticated", role: "authenticated", identities: [] }) : Response.json({ message: "Invalid credential" }, { status: 401 });
        }
        observed.push({ path: url.pathname, method: request.method, actor: entry?.[0] as ActorName || null, permit: request.headers.has("x-founderops-workspace-permit") });
        return nativeFetch(request);
      }
      if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-planning-sts" });
      if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-planning-directory", expireTime: new Date(Date.now() + 3600000).toISOString() });
      if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
      if (url.hostname === "www.googleapis.com") return provider(request);
      throw new Error("Unscripted external provider in Planning database test");
    });
    vi.resetModules();
  } catch (error) { await cleanup(); throw error; }
  const request = (name: ActorName, path: string, method = "GET", body?: unknown) => new NextRequest(`http://localhost:3000${path}`, { method, headers: { authorization: `Bearer ${actors[name].token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const rpc = (name: string, body: unknown, actor: ActorName | "service" | "anonymous" = "service") => nativeFetch(`${local.API_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: { apikey: local.ANON_KEY, authorization: `Bearer ${actor === "service" ? local.SERVICE_ROLE_KEY : actor === "anonymous" ? local.ANON_KEY : actors[actor].token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return { db, prefix, initiativeId, actors, observed, request, rpc, cleanup, encrypt, local, nativeFetch, setProvider(value: typeof provider) { provider = value; } };
}
