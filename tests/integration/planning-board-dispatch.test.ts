import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { createCalendarLiveFixture } from "./helpers/calendar-live-fixture";

it("real Auth and PostgREST retain Planning board roles, JWTs and live checks within the grouped dispatch budget", async () => {
  const fixture = await createCalendarLiveFixture();
  const nativeFetch = globalThis.fetch;
  let token = "";
  let createdProject = false;
  let jar: NextRequest["cookies"];
  let attempts: string[] = [];
  try {
    await fixture.mode("linking");
    const project = await fixture.database.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic Planning') on conflict(id) do nothing returning id");
    createdProject = project.rowCount === 1;
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
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const authorize = () => authorizeCredentialAction({ credential: { kind: "session-request", request: new NextRequest("https://application.example.test/api/planning-board-data", { headers: { authorization: `Bearer ${token}` } }) }, action: "planning.board.read" });
    for (const role of ["ceo", "founder", "deputy", "viewer"]) {
      const actor = await fixture.actor(role);
      token = actor.session.access_token;
      vi.stubEnv("VERCEL_OIDC_TOKEN", token);
      const authorized = await authorize();
      expect(authorized).toMatchObject({ ok: true, profile: { id: actor.profileId, platformRole: role } });
      if (!authorized.ok) throw new Error("Expected mapped Planning reader");
      expect((await authorized.planning.loadBoard()).status).toBe("ready");
      attempts = [];
      const base = `sb-${new URL(fixture.local.API_URL).hostname.split(".")[0]}-auth-token`;
      const request = new NextRequest("https://application.example.test/api/planning-board-data", { headers: { cookie: `${base}=base64-${Buffer.from(JSON.stringify(actor.session)).toString("base64url")}` } });
      expect((await authorizeCredentialAction({ credential: { kind: "http-request", request }, action: "session.proxy" })).ok).toBe(true);
      jar = request.cookies;
      const response = await GET(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ model: { project: { id: "findmydoc-founder-execution" } }, currentProfile: { id: actor.profileId, platformRole: role } });
      // The proxy and route retain every live check in the measured request budget.
      expect(attempts).toHaveLength(75);
      expect(attempts.filter(path => path === "/auth/v1/user")).toHaveLength(17);
      for (const rpc of ["workspace_dispatch_prepare", "current_authenticated_profile", "workspace_release_permit"]) {
        expect(attempts.filter(path => path === `/rest/v1/rpc/${rpc}`)).toHaveLength(15);
      }
      expect(attempts.filter(path => path === "/rest/v1/rpc/workspace_access_context")).toHaveLength(0);
      expect(attempts.filter(path => path === "/rest/v1/rpc/workspace_calendar_entry")).toHaveLength(1);
      expect(attempts.filter(path => path === "/rest/v1/active_tasks")).toHaveLength(1);
      expect((await fixture.database.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actor.userId])).rows[0].remaining).toBe(0);
      await fixture.mode("google");
      attempts = [];
      expect((await authorized.planning.loadBoard()).status).toBe("forbidden");
      expect(attempts.filter(path => path === "/rest/v1/projects")).toHaveLength(0);
      await fixture.mode("linking");
      await fixture.database.query("update public.profiles set auth_user_id=null where id=$1", [actor.profileId]);
      attempts = [];
      expect((await authorized.planning.loadBoard()).status).toBe("forbidden");
      expect(attempts.filter(path => path === "/rest/v1/projects")).toHaveLength(0);
      await fixture.database.query("update public.profiles set auth_user_id=$1 where id=$2", [actor.userId, actor.profileId]);
      await fixture.database.query("delete from auth.sessions where id=$1", [actor.sessionId]);
      attempts = [];
      expect((await authorized.planning.loadBoard()).status).toBe("forbidden");
      expect(attempts.filter(path => path === "/rest/v1/active_tasks")).toHaveLength(0);
    }
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    if (createdProject) await fixture.database.query("delete from public.projects where id='findmydoc-founder-execution'");
    await fixture.close();
  }
}, 60_000);


it("real Board entry rejects profile, mode and session changes before the first protected read", async () => {
  const fixture = await createCalendarLiveFixture();
  const nativeFetch = globalThis.fetch;
  let afterEntry: (() => Promise<unknown>) | undefined;
  let paths: string[] = [];
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
      paths.push(url.pathname);
      const response = await nativeFetch(request);
      if (url.pathname === "/rest/v1/rpc/workspace_calendar_entry" && afterEntry) {
        const change = afterEntry;
        afterEntry = undefined;
        // Commit after the entry snapshot, before the first bound profile dispatch.
        await change();
      }
      return response;
    });
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    for (const role of ["ceo", "founder", "deputy", "viewer"]) {
      for (const change of ["binding", "mode", "session"] as const) {
        await fixture.mode("linking");
        const actor = await fixture.actor(role);
        paths = [];
        afterEntry = change === "binding"
          ? () => fixture.database.query("update public.profiles set auth_user_id=null where id=$1", [actor.profileId])
          : change === "mode" ? () => fixture.mode("google")
            : () => fixture.database.query("delete from auth.sessions where id=$1", [actor.sessionId]);
        const result = await authorizeCredentialAction({ credential: { kind: "session-request", request: new NextRequest("https://application.example.test/api/planning-board-data", { headers: { authorization: `Bearer ${actor.session.access_token}` } }) }, action: "planning.board.read" });
        expect(afterEntry).toBeUndefined();
        expect(result.ok).toBe(false);
        expect(paths.filter(path => path === "/rest/v1/rpc/workspace_calendar_entry")).toHaveLength(1);
        for (const path of ["/rest/v1/rpc/current_authenticated_profile", "/rest/v1/projects", "/rest/v1/active_tasks"]) expect(paths).not.toContain(path);
        expect((await fixture.database.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actor.userId])).rows[0].remaining).toBe(0);
      }
    }
    await fixture.mode("linking");
    const entryPrivileges = await fixture.database.query(`select
      has_function_privilege('anon', 'public.workspace_calendar_entry(uuid,uuid)', 'EXECUTE') as anon,
      has_function_privilege('authenticated', 'public.workspace_calendar_entry(uuid,uuid)', 'EXECUTE') as authenticated,
      has_function_privilege('service_role', 'public.workspace_calendar_entry(uuid,uuid)', 'EXECUTE') as service_role`);
    expect(entryPrivileges.rows).toEqual([{ anon: false, authenticated: false, service_role: true }]);
    const actor = await fixture.actor();
    for (const credential of [fixture.local.ANON_KEY, actor.session.access_token]) {
      const response = await nativeFetch(`${fixture.local.API_URL}/rest/v1/rpc/workspace_calendar_entry`, {
        method: "POST", headers: { apikey: fixture.local.ANON_KEY, authorization: `Bearer ${credential}`, "content-type": "application/json" },
        body: JSON.stringify({ p_user_id: actor.userId, p_session_id: actor.sessionId }),
      });
      expect([401, 403, 404]).toContain(response.status);
      const body = await response.json();
      expect(["42501", "PGRST202"]).toContain(body.code);
    }
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await fixture.close();
  }
}, 60_000);
