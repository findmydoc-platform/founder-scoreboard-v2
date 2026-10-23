import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { createCalendarLiveFixture } from "./helpers/calendar-live-fixture";

it("real Auth and PostgREST retain Planning revision roles, JWTs and live checks within the grouped dispatch budget", async () => {
  const fixture = await createCalendarLiveFixture();
  const nativeFetch = globalThis.fetch;
  let token = "";
  let jar: NextRequest["cookies"];
  let attempts: string[] = [];
  try {
    await fixture.mode("linking");
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: fixture.local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: fixture.local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: fixture.local.SERVICE_ROLE_KEY,
      REQUIRE_SUPABASE_AUTH: "true", GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-planning-audience",
      GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-planning@example.test",
      GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", VERCEL_OIDC_TOKEN: "synthetic-oidc" })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
      if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now() + 3600000).toISOString() });
      if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
      if (url.origin !== new URL(fixture.local.API_URL).origin) throw new Error("Unexpected external provider");
      attempts.push(url.pathname);
      if (url.pathname === "/rest/v1/rpc/current_authenticated_profile") {
        // Compare in memory so failure diagnostics never contain a credential.
        expect(request.headers.get("authorization") === `Bearer ${token}`).toBe(true);
        expect(request.headers.has("x-founderops-workspace-permit")).toBe(true);
      }
      return nativeFetch(request);
    });
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {}, "next/headers": { cookies: async () => jar } });
    const authorize = () => authorizeCredentialAction({ credential: { kind: "session-request", request: new NextRequest("https://application.example.test/api/planning-revision", { headers: { authorization: `Bearer ${token}` } }) }, action: "planning.revision.read" });
    const authorizeCookie = async (session: unknown) => {
      const base = `sb-${new URL(fixture.local.API_URL).hostname.split(".")[0]}-auth-token`;
      const request = new NextRequest("https://application.example.test/api/planning-revision", { headers: { cookie: `${base}=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}` } });
      expect((await authorizeCredentialAction({ credential: { kind: "http-request", request }, action: "session.proxy" })).ok).toBe(true);
      jar = request.cookies;
      return authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.revision.read" });
    };
    for (const role of ["ceo", "founder", "deputy", "viewer"]) {
      const actor = await fixture.actor(role);
      token = actor.session.access_token;
      const warm = await authorize();
      if (!warm.ok) throw new Error("Expected mapped Planning reader");
      expect((await warm.planning.readRevision()).error).toBeNull();
      attempts = [];
      const authorized = await authorizeCookie(actor.session);
      expect(authorized).toMatchObject({ ok: true, profile: { id: actor.profileId, platformRole: role } });
      if (!authorized.ok) throw new Error("Expected mapped Planning reader");
      expect((await authorized.planning.readRevision()).error).toBeNull();
      // Cookie proxy contributes one live Auth request; the route contributes 16.
      expect(attempts).toHaveLength(17);
      expect(attempts.filter(path => path === "/auth/v1/user")).toHaveLength(5);
      for (const rpc of ["workspace_dispatch_prepare", "current_authenticated_profile", "workspace_release_permit"]) {
        expect(attempts.filter(path => path === `/rest/v1/rpc/${rpc}`)).toHaveLength(3);
      }
      expect(attempts.filter(path => path === "/rest/v1/rpc/workspace_access_context")).toHaveLength(1);
      expect(attempts.filter(path => path === "/rest/v1/active_tasks")).toHaveLength(1);
      expect((await fixture.database.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actor.userId])).rows[0].remaining).toBe(0);
      await fixture.database.query("delete from auth.sessions where id=$1", [actor.sessionId]);
      attempts = [];
      expect((await authorized.planning.readRevision()).error).not.toBeNull();
      expect(attempts.filter(path => path === "/rest/v1/active_tasks")).toHaveLength(0);
    }
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await fixture.close();
  }
}, 60_000);
