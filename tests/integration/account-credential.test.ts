import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { importTestModule } from "../helpers/vitest-module.mjs";

it("retains account ownership across real handlers, PostgREST, database mutation and session revocation", async () => {
  const expectedDatabase = process.env.DISPOSABLE_DB_URL;
  if (!expectedDatabase || !["localhost", "127.0.0.1"].includes(new URL(expectedDatabase).hostname)) throw new Error("An explicitly guarded disposable database is required.");
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const local = JSON.parse(stdout);
  if (local.DB_URL !== expectedDatabase || !["localhost", "127.0.0.1"].includes(new URL(local.API_URL).hostname)) throw new Error("Disposable database target mismatch.");
  const database = new pg.Client(expectedDatabase);
  await database.connect();
  const actors = ["founder", "viewer", "unmapped"].map(role => ({ role, userId: randomUUID(), sessionId: randomUUID(), profileId: `account-${role}-${randomUUID()}`, token: "" }));
  const originalFetch = globalThis.fetch;
  const configuration = (await database.query("select mode,linking_enforced from workspace_private.configuration")).rows[0];
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  try {
    for (const actor of actors) {
      await database.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values ($1,$2,'authenticated','authenticated',now())", [actor.userId, `synthetic-account-${actor.role}@example.test`]);
      if (actor.role !== "unmapped") await database.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ($1,$2,$3,$4)", [actor.profileId, actor.userId, `Synthetic ${actor.role}`, actor.role]);
      await database.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,now())", [actor.sessionId, actor.userId]);
      const now = Math.floor(Date.now() / 1000);
      const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: `${local.API_URL}/auth/v1`, sub: actor.userId, aud: "authenticated", role: "authenticated", session_id: actor.sessionId, iat: now, exp: now + 3600 })}`;
      actor.token = `${unsigned}.${createHmac("sha256", local.JWT_SECRET).update(unsigned).digest("base64url")}`;
    }
    await database.query("update workspace_private.configuration set mode='legacy',linking_enforced=false");
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: local.API_URL, SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY, REQUIRE_SUPABASE_AUTH: "true",
      GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-unused-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-unused@example.test", GOOGLE_AUTHORIZED_GROUP: "synthetic-unused-group", VERCEL_OIDC_TOKEN: "synthetic-unused-oidc" })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.origin !== new URL(local.API_URL).origin) throw new Error("Unexpected external provider in account test.");
      if (url.pathname === "/auth/v1/user") {
        const actor = actors.find(candidate => request.headers.get("authorization") === `Bearer ${candidate.token}`);
        const active = actor && (await database.query("select exists(select 1 from auth.sessions where id=$1 and user_id=$2) as active", [actor.sessionId, actor.userId])).rows[0].active;
        return actor && active ? Response.json({ id: actor.userId, aud: "authenticated", role: "authenticated", identities: [] }) : Response.json({ message: "Invalid credential" }, { status: 401 });
      }
      return originalFetch(request);
    });
    const settings = await importTestModule("src/app/api/profile-settings/route.ts", { "server-only": {} });
    const preferences = await importTestModule("src/app/api/notification-preferences/route.ts", { "server-only": {} });
    const tours = await importTestModule("src/app/api/profile-feature-tours/seen/route.ts", { "server-only": {} });
    const governance = await importTestModule("src/app/api/profiles/[id]/route.ts", { "server-only": {} });
    const [founder, viewer, unmapped] = actors;
    const request = (actor: typeof founder, method: string, body: unknown) => new NextRequest("https://app.example.test/api/profile-settings", { method, headers: { authorization: `Bearer ${actor.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    expect((await settings.PATCH(request(founder, "PATCH", { focus: "Owner focus" }))).status).toBe(200);
    expect((await database.query("select focus from public.profiles where id=$1", [founder.profileId])).rows[0].focus).toBe("Owner focus");
    expect((await settings.PATCH(request(founder, "PATCH", { profileId: viewer.profileId, focus: "Foreign focus" }))).status).toBe(400);
    expect((await preferences.PATCH(request(founder, "PATCH", { profileId: viewer.profileId, eventType: "task.mention", enabled: true }))).status).toBe(403);
    expect((await governance.PATCH(request(founder, "PATCH", { platformRole: "ceo" }), { params: Promise.resolve({ id: viewer.profileId }) })).status).toBe(403);
    expect((await tours.POST(request(viewer, "POST", { tourId: "account-test-tour", profileId: founder.profileId }))).status).toBe(200);
    expect((await database.query("select profile_id from public.profile_feature_tour_acknowledgements where tour_id='account-test-tour' and profile_id=any($1)", [actors.map(actor => actor.profileId)])).rows).toEqual([{ profile_id: viewer.profileId }]);
    expect((await settings.PATCH(request(unmapped, "PATCH", { focus: "Unmapped" }))).status).toBe(403);
    await database.query("delete from auth.sessions where id=$1", [founder.sessionId]);
    expect((await settings.PATCH(request(founder, "PATCH", { focus: "Revoked" }))).status).toBe(401);
    expect((await database.query("select focus from public.profiles where id=$1", [founder.profileId])).rows[0].focus).toBe("Owner focus");
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await database.query("delete from public.audit_log where actor_profile_id=any($1)", [actors.map(actor => actor.profileId)]);
    await database.query("delete from public.profiles where id=any($1)", [actors.map(actor => actor.profileId)]);
    await database.query("delete from auth.users where id=any($1)", [actors.map(actor => actor.userId)]);
    await database.query("update workspace_private.configuration set mode=$1,linking_enforced=$2", [configuration.mode, configuration.linking_enforced]);
    await database.end();
  }
}, 30_000);
