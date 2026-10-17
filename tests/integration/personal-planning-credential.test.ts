import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { importTestModule } from "../helpers/vitest-module.mjs";

it("personal planning HTTP contracts retain accounting, owner restrictions, revocation, expiry and issuance limits", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const local = JSON.parse(stdout);
  if (!new Set(["localhost", "127.0.0.1"]).has(new URL(local.API_URL).hostname)) throw new Error("Local test target required");
  const database = new pg.Client(local.DB_URL);
  await database.connect();
  const userId = randomUUID(), sessionId = randomUUID(), profileId = `pat-${randomUUID()}`, otherProfileId = `pat-other-${randomUUID()}`;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: `${local.API_URL}/auth/v1`, sub: userId,
    aud: "authenticated", role: "authenticated", session_id: sessionId, iat: now, exp: now + 3600, amr: [{ method: "password", timestamp: now }] })}`;
  const sessionToken = `${unsigned}.${createHmac("sha256", local.JWT_SECRET).update(unsigned).digest("base64url")}`;
  const originalFetch = globalThis.fetch;
  const previous = (await database.query("select mode,linking_enforced from workspace_private.configuration")).rows[0];
  try {
    await database.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values ($1,'synthetic-pat@example.test','authenticated','authenticated',now())", [userId]);
    await database.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ($1,$2,'Synthetic Token Owner','founder')", [profileId, userId]);
    await database.query("insert into public.profiles(id,name,platform_role) values ($1,'Other Token Owner','founder')", [otherProfileId]);
    await database.query("insert into public.administrator_access_grants(profile_id,eligible,active_until) values ($1,true,now()+interval '1 hour')", [profileId]);
    await database.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,now())", [sessionId, userId]);
    await database.query("update workspace_private.configuration set mode='legacy',linking_enforced=false");
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: local.API_URL, SUPABASE_URL: local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
      SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY,
      REQUIRE_SUPABASE_AUTH: "true", GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-unused-audience",
      GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-unused@example.test", GOOGLE_AUTHORIZED_GROUP: "synthetic-unused-group", VERCEL_OIDC_TOKEN: "synthetic-unused-oidc" })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.pathname === "/auth/v1/user") {
        return request.headers.get("authorization") === `Bearer ${sessionToken}`
          ? Response.json({ id: userId, aud: "authenticated", role: "authenticated", identities: [] })
          : Response.json({ message: "Invalid credential" }, { status: 401 });
      }
      if (url.origin !== new URL(local.API_URL).origin) throw new Error("Unexpected external provider in personal planning test");
      return originalFetch(request);
    });
    const routes = await importTestModule("src/app/api/team/planning-items/v2/tokens/route.ts", { "server-only": {} });
    const revokeRoute = await importTestModule("src/app/api/team/planning-items/v2/tokens/[id]/route.ts", { "server-only": {} });
    const updatePreviewRoute = await importTestModule("src/app/api/team/planning-items/v2/items/[id]/preview/route.ts", { "server-only": {} });
    const previewRoute = await importTestModule("src/app/api/team/planning-items/v2/items/preview/route.ts", { "server-only": {} });
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const sessionRequest = (body?: unknown) => new NextRequest("https://app.example.test/api/team/planning-items/v2/tokens", {
      method: body ? "POST" : "GET", headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const issue = async () => {
      const response = await routes.POST(sessionRequest({ label: "Synthetic automation" }));
      expect(response.status).toBe(200);
      const body = await response.json();
      // Secrets stay in memory and are not asserted through an output-producing equality check.
      if (typeof body.token !== "string" || !body.token.startsWith("fmd_ti_")) throw new Error("Expected one-time credential");
      return body as { token: string; tokenRecord: { id: string } };
    };
    const first = await issue();
    const preview = (token = first.token) => previewRoute.POST(new NextRequest("https://app.example.test/api/team/planning-items/v2/items/preview", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}",
    }));
    const list = async () => (await (await routes.GET(sessionRequest())).json()).tokens as Array<{ id: string; lastUsedAt: string }>;
    const before = (await list()).find(row => row.id === first.tokenRecord.id)!;
    expect(before.lastUsedAt).toBe("");
    const allowed = await preview();
    expect(allowed.status).toBe(400);
    const allowedBody = await allowed.json();
    expect(allowedBody._meta.access).toMatchObject({ decision: "allowed", requiredScopes: ["write:planning-items:create"], missingScopes: [] });
    const used = (await list()).find(row => row.id === first.tokenRecord.id)!;
    expect(Number.isFinite(Date.parse(used.lastUsedAt))).toBe(true);
    await preview();
    const usedAgain = (await list()).find(row => row.id === first.tokenRecord.id)!;
    expect(Date.parse(usedAgain.lastUsedAt)).toBeGreaterThan(Date.parse(used.lastUsedAt));

    const denied = await updatePreviewRoute.POST(new NextRequest("https://app.example.test/api/team/planning-items/v2/items/synthetic/preview", {
      method: "POST", headers: { authorization: `Bearer ${first.token}`, "content-type": "application/json" }, body: "{}",
    }), { params: Promise.resolve({ id: "synthetic-item" }) });
    expect(denied.status).toBe(403);
    expect(denied.headers.get("www-authenticate")).toBe('Bearer error="insufficient_scope"');
    expect(await denied.json()).toMatchObject({ code: "INSUFFICIENT_SCOPE", _meta: { access: { decision: "denied", missingScopes: ["write:planning-items:update"] } } });

    const access = await authorizeCredentialAction({ credential: { kind: "personal-planning-token", request: new NextRequest("https://app.example.test", { headers: { authorization: `Bearer ${first.token}` } }) }, action: "planning-items.access", operation: "planningContext.read", mode: "read" });
    expect(access).toMatchObject({ ok: true, profile: { id: profileId, platformRole: "founder" } });
    expect("authority" in access).toBe(false);
    const browserAdministration = await authorizeCredentialAction({ credential: { kind: "session-request", request: sessionRequest() }, action: "administration.technical.update", targetProfileId: otherProfileId });
    expect(browserAdministration).toMatchObject({ ok: true });
    const personalDelete = await authorizeCredentialAction({ credential: { kind: "personal-planning-token", request: new NextRequest("https://app.example.test", { headers: { authorization: `Bearer ${first.token}` } }) }, action: "planning-items.access", operation: "planningItems.deleteEmpty", mode: "commit", itemId: "synthetic-epic" });
    expect(personalDelete).toMatchObject({ ok: false, status: 403, code: "TOKEN_PROFILE_FORBIDDEN" });
    await database.query("update public.profiles set platform_role='viewer' where id=$1", [profileId]);
    expect(await preview()).toMatchObject({ status: 403 });
    await database.query("update public.profiles set platform_role='founder' where id=$1", [profileId]);

    // A different owner cannot revoke this credential through the authoritative RPC.
    const wrongOwner = await originalFetch(`${local.API_URL}/rest/v1/rpc/revoke_team_planning_items_token`, { method: "POST", headers: { apikey: local.SERVICE_ROLE_KEY, authorization: `Bearer ${local.SERVICE_ROLE_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ p_token_id: first.tokenRecord.id, p_profile_id: otherProfileId }) });
    expect(await wrongOwner.json()).toBeNull();
    await issue(); await issue();
    const limited = await routes.POST(sessionRequest({ label: "Fourth credential" }));
    expect(limited.status).toBe(409);
    const revoked = await revokeRoute.DELETE(sessionRequest(), { params: Promise.resolve({ id: first.tokenRecord.id }) });
    expect(revoked.status).toBe(200);
    const inactive = await preview();
    expect(inactive.status).toBe(401);
    expect(await inactive.json()).toMatchObject({ code: "TOKEN_INACTIVE" });
    const replacement = await issue();
    await database.query("update public.team_task_intake_tokens set created_at=now()-interval '1 day',expires_at=now()-interval '1 second' where id=$1", [replacement.tokenRecord.id]);
    const expired = await preview(replacement.token);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ code: "TOKEN_INACTIVE" });
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await database.query("delete from public.team_task_intake_tokens where profile_id=any($1)", [[profileId, otherProfileId]]);
    await database.query("delete from public.profiles where id=any($1)", [[profileId, otherProfileId]]);
    await database.query("delete from auth.users where id=$1", [userId]);
    await database.query("update workspace_private.configuration set mode=$1,linking_enforced=$2", [previous.mode, previous.linking_enforced]);
    await database.end();
  }
}, 30_000);
