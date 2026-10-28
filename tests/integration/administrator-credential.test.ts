import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { importTestModule } from "../helpers/vitest-module.mjs";

it("administrator application and database boundaries retain activation, ending, expiry, roles and exact actor binding", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const local = JSON.parse(stdout);
  if (!new Set(["localhost", "127.0.0.1"]).has(new URL(local.API_URL).hostname)) throw new Error("Local test target required");
  const database = new pg.Client(local.DB_URL);
  await database.connect();
  const actors = ["ceo", "founder", "viewer", "unmapped"].map(role => ({ role, userId: randomUUID(), sessionId: randomUUID(), profileId: `admin-${role}-${randomUUID()}`, token: "" }));
  const originalFetch = globalThis.fetch;
  const previous = (await database.query("select mode,linking_enforced from workspace_private.configuration")).rows[0];
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  try {
    for (const actor of actors) {
      await database.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values ($1,$2,'authenticated','authenticated',now())", [actor.userId, `synthetic-admin-${actor.role}@example.test`]);
      if (actor.role !== "unmapped") await database.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ($1,$2,$3,$4)", [actor.profileId, actor.userId, `Synthetic ${actor.role}`, actor.role]);
      await database.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,now())", [actor.sessionId, actor.userId]);
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: `${local.API_URL}/auth/v1`, sub: actor.userId,
        aud: "authenticated", role: "authenticated", session_id: actor.sessionId, iat: now, exp: now + 3600, amr: [{ method: "password", timestamp: now }] })}`;
      actor.token = `${unsigned}.${createHmac("sha256", local.JWT_SECRET).update(unsigned).digest("base64url")}`;
    }
    await database.query("update workspace_private.configuration set mode='legacy',linking_enforced=false");
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: local.API_URL, SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
      SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY,
      REQUIRE_SUPABASE_AUTH: "true", GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-unused-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-unused@example.test",
      GOOGLE_AUTHORIZED_GROUP: "synthetic-unused-group", VERCEL_OIDC_TOKEN: "synthetic-unused-oidc",
      GITHUB_APP_ID: "", GITHUB_APP_INSTALLATION_ID: "", GITHUB_APP_PRIVATE_KEY: "", GITHUB_APP_PRIVATE_KEY_PATH: "",
      GOOGLE_CHAT_WEBHOOK_URL: "", GOOGLE_CHAT_PRIVATE_KEY: "", GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL: "" })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.pathname === "/auth/v1/user") {
        const actor = actors.find(candidate => request.headers.get("authorization") === `Bearer ${candidate.token}`);
        const active = actor && (await database.query("select exists(select 1 from auth.sessions where id=$1 and user_id=$2) as active", [actor.sessionId, actor.userId])).rows[0].active;
        return actor && active ? Response.json({ id: actor.userId, aud: "authenticated", role: "authenticated", identities: [], user_metadata: { platform_role: "ceo" } })
          : Response.json({ message: "Invalid credential" }, { status: 401 });
      }
      if (url.origin !== new URL(local.API_URL).origin) throw new Error("Unexpected external provider in administrator test");
      return originalFetch(request);
    });
    const access = await importTestModule("src/app/api/administrator-access/route.ts", { "server-only": {} });
    const eligibility = await importTestModule("src/app/api/administrator-access/profiles/[id]/route.ts", { "server-only": {} });
    const technical = await importTestModule("src/app/api/administration/profiles/[id]/technical/route.ts", { "server-only": {} });
    const directory = await importTestModule("src/app/api/administration-data/route.ts", { "server-only": {} });
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const [ceo, founder, viewer, unmapped] = actors;
    const request = (actor: typeof founder, method = "GET", body?: unknown) => new NextRequest("https://app.example.test/api/administrator-access", {
      method, headers: { authorization: `Bearer ${actor.token}`, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const target = { params: Promise.resolve({ id: viewer.profileId }) };
    expect((await technical.PATCH(request(founder, "PATCH", { githubLogin: "synthetic-login" }), target)).status).toBe(403);
    expect((await eligibility.PATCH(request(ceo, "PATCH", { eligible: true }), { params: Promise.resolve({ id: founder.profileId }) })).status).toBe(200);
    const before = await (await access.GET(request(founder))).json();
    expect(before).toEqual({ administratorAccess: { eligible: true, active: false, expiresAt: null } });
    const activated = await access.POST(request(founder, "POST", {}));
    expect(activated.status).toBe(200);
    expect(await activated.json()).toMatchObject({ administratorAccess: { eligible: true, active: true } });

    const held = await authorizeCredentialAction({ credential: { kind: "session-request", request: request(founder) }, action: "administration.technical.update", targetProfileId: viewer.profileId });
    expect(held.ok).toBe(true);
    const changed = await technical.PATCH(request(founder, "PATCH", { githubLogin: "synthetic-login" }), target);
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({
      ok: true,
      profile: {
        id: viewer.profileId,
        githubLogin: "synthetic-login",
        googleChatUserId: null,
        googleChatDmSpace: null,
      },
    });
    expect((await database.query("select github_login from public.profiles where id=$1", [viewer.profileId])).rows[0].github_login).toBe("synthetic-login");
    const activeView = await directory.GET(request(founder));
    expect(activeView.status).toBe(200);
    const activeBody = await activeView.json();
    expect(activeBody.administration.people.find((person: { id: string }) => person.id === viewer.profileId).githubLogin).toBe("synthetic-login");
    const ceoView = await directory.GET(request(ceo));
    expect(ceoView.status).toBe(200);
    expect((await ceoView.json()).administration.people.every((person: { githubLogin: string }) => person.githubLogin === "")).toBe(true);
    expect((await directory.GET(request(viewer))).status).toBe(403);
    expect((await directory.GET(request(unmapped))).status).toBe(403);

    const direct = await originalFetch(`${local.API_URL}/rest/v1/rpc/update_profile_technical_identity_transaction`, { method: "POST", headers: { apikey: local.ANON_KEY, authorization: `Bearer ${viewer.token}`, "content-type": "application/json" }, body: JSON.stringify({ p_profile_id: founder.profileId, p_profile_patch: { github_login: "forbidden-login" }, p_request_ip: null, p_user_agent: null }) });
    expect(direct.status).toBe(403);
    expect((await direct.json()).code).toBe("42501");

    expect((await access.DELETE(request(founder, "DELETE"))).status).toBe(200);
    const ended = await technical.PATCH(request(founder, "PATCH", { githubLogin: "after-ending" }), target);
    expect(ended.status).toBe(403);
    expect(await ended.json()).toMatchObject({ code: "administrator_access_expired" });
    if (!held.ok) throw new Error("Expected bound administrator capability");
    expect(await held.administrator.updateTechnicalIdentity({ github_login: "after-ending" }, {})).toMatchObject({ error: { code: "42501" } });
    expect((await database.query("select github_login from public.profiles where id=$1", [viewer.profileId])).rows[0].github_login).toBe("synthetic-login");
    await access.POST(request(founder, "POST", {}));
    await database.query("update public.administrator_access_grants set active_until=now()-interval '1 second' where profile_id=$1", [founder.profileId]);
    expect(await (await technical.PATCH(request(founder, "PATCH", { githubLogin: "expired-login" }), target)).json()).toMatchObject({ code: "administrator_access_expired" });
    expect((await eligibility.PATCH(request(founder, "PATCH", { eligible: true }), target)).status).toBe(403);
    await database.query("delete from auth.sessions where id=$1", [founder.sessionId]);
    const revokedSession = await access.GET(request(founder));
    expect(revokedSession.status).toBe(401);
    expect(await revokedSession.json()).toMatchObject({ code: "session_invalid_before_effect" });
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", ""); vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect((await access.GET(request(ceo))).status).toBe(503);
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await database.query("delete from public.audit_log where actor_profile_id=any($1)", [actors.map(actor => actor.profileId)]);
    await database.query("delete from public.profiles where id=any($1)", [actors.map(actor => actor.profileId)]);
    await database.query("delete from auth.users where id=any($1)", [actors.map(actor => actor.userId)]);
    await database.query("update workspace_private.configuration set mode=$1,linking_enforced=$2", [previous.mode, previous.linking_enforced]);
    await database.end();
  }
}, 30_000);
