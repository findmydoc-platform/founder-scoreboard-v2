import { localSupabaseStatus } from "../helpers/local-supabase-target.mjs";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { importTestModule } from "../helpers/vitest-module.mjs";

it("Workweek HTTP read states retain owner isolation, temporal projections and stale-snapshot denial", async () => {
  const local = await localSupabaseStatus();
  const database = new pg.Client(local.DB_URL);
  await database.connect();
  const otherUserId = randomUUID(), otherProfileId = `foreign-workweek-${randomUUID()}`;
  let otherFixture: Awaited<ReturnType<typeof import("../helpers/workweek-read-fixtures.mjs")["workweekReadFixture"]>> | undefined;
  const userId = randomUUID(), sessionId = randomUUID(), subject = randomUUID(), profileId = `workweek-read-${randomUUID()}`;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now()/1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: `${local.API_URL}/auth/v1`, sub: userId,
    aud: "authenticated", role: "authenticated", session_id: sessionId, iat: now, exp: now+3600, amr: [{ method: "oauth", timestamp: now }] })}`;
  const token = `${unsigned}.${createHmac("sha256", local.JWT_SECRET).update(unsigned).digest("base64url")}`;
  const originalFetch = globalThis.fetch;
  const previous = (await database.query("select mode,linking_enforced from workspace_private.configuration")).rows[0];
  let membershipReads = 0;
  let primaryError: unknown;
  try {
    await database.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values ($1,'synthetic-calendar@example.test','authenticated','authenticated',now())", [userId]);
    await database.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ($1,$2,'Synthetic Calendar','founder')", [profileId,userId]);
    await database.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'google',$2,$3)", [userId,subject,JSON.stringify({ sub: subject, iss: "https://accounts.google.com", email: "synthetic-calendar@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } })]);
    await database.query("insert into workspace_private.identity_bindings(user_id,google_subject) values ($1,$2)", [userId,subject]);
    await database.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,now())", [sessionId,userId]);
    await database.query("update workspace_private.configuration set mode='linking',linking_enforced=true");
    await database.query("select public.workspace_record_google_login($1,$2,$3)", [userId,sessionId,subject]);
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_URL: local.API_URL, SUPABASE_ANON_KEY: local.ANON_KEY, SUPABASE_PUBLISHABLE_KEY: local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY, REQUIRE_SUPABASE_AUTH: "true", GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-workweek-read-audience",
      GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-calendar@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", VERCEL_OIDC_TOKEN: token })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init); const url = new URL(request.url);
      // Auth is the controlled external protocol; PostgREST still verifies this exact signed JWT itself.
      if (url.pathname === "/auth/v1/user") {
        return request.headers.get("authorization") === `Bearer ${token}`
          ? Response.json({ id: userId, aud: "authenticated", role: "authenticated", identities: [] })
          : Response.json({ message: "Invalid credential" }, { status: 401 });
      }
      if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
      if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-reader", expireTime: new Date(Date.now()+3600000).toISOString() });
      if (url.hostname === "admin.googleapis.com") { membershipReads++; return Response.json({ isMember: true }); }
      if (url.origin !== new URL(local.API_URL).origin) throw new Error("Unexpected external provider in calendar test");
      return originalFetch(request);
    });
    const { workweekReadFixture } = await import("../helpers/workweek-read-fixtures.mjs");
    const today = (await database.query("select date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date::text as current, (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7)::text as future, (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+6)::text as before_future")).rows[0];
    const weeks = { current: today.current, future: today.future, beforeFuture: today.before_future };
    await database.query("insert into auth.users(id) values ($1)", [otherUserId]);
    await database.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ($1,$2,'Foreign draft owner','founder')", [otherProfileId, otherUserId]);
    otherFixture = await workweekReadFixture(database, otherProfileId, weeks);
    await otherFixture.seed("draft");
    const route = await importTestModule("src/app/api/team-workweek/private-draft/route.ts", { "server-only": {} });
    const request = (week?: string) => ({ headers: new Headers({ authorization: `Bearer ${token}` }), nextUrl: new URL(`https://application.example.test/api/team-workweek/private-draft${week ? `?week=${week}` : ""}`) }) as NextRequest;
    for (const name of ["initial", "draft", "preparing", "published", "current-future", "selected-future", "pinned", "pinned-current", "conflict", "automatic", "automatic-private", "automatic-history", "recovery", "recovery-no-journal", "recovery-expired", "recovery-restarted", "recovery-identity"]) {
      const fixture = await workweekReadFixture(database, profileId, weeks);
      try {
        await fixture.seed(name);
        const response = await route.GET(request());
        expect(response.status, name).toBe(200);
        const body = await response.json();
        expect(body.weekContext.contextToken, name).toMatch(/^[a-f0-9]{32}$/);
        if (name === "initial") expect(body).toMatchObject({ version: null, publication: null, pendingPublication: null });
        if (name === "draft") expect(body.version.id).toBe(fixture.ids.draft);
        if (name === "preparing") expect(body).toMatchObject({ version: { id: fixture.ids.draft }, publication: { id: fixture.ids.pending }, pendingPublication: { resumeAllowed: true } });
        if (name === "published") expect(body).toMatchObject({ version: null, publication: null, latestPublished: { id: fixture.ids.publishedDraft } });
        if (name === "current-future" || name === "selected-future") {
          expect(body.latestPublished.id).toBe(fixture.ids.base);
          expect(body.preparedSuccessor.id).toBe(fixture.ids.future);
          const selected = await route.GET(request(weeks.future));
          expect(selected.status).toBe(200);
          expect((await selected.json()).weekContext.basePublicationId).toBe(fixture.ids.future);
        }
        if (name.startsWith("pinned")) expect(body.restartAvailable).toBe(name === "pinned-current");
        if (name === "conflict") expect(body).toMatchObject({ version: { id: fixture.ids.draft }, publication: { id: fixture.ids.resolutionPublication } });
        if (name.startsWith("automatic")) {
          expect(body).toMatchObject({ version: { id: name.includes("private") ? fixture.ids.draft : fixture.ids.automaticVersion }, publication: { id: fixture.ids.automatic }, restartAvailable: true, pendingPublication: { resumeAllowed: false } });
          const explicit = await route.GET(request(weeks.future));
          expect(explicit.status).toBe(200);
          expect((await explicit.json()).publication).toBeNull();
        }
        if (name.startsWith("recovery")) expect(body.pendingPublication.resumeAllowed, name).toBe(name === "recovery");
      } finally { await fixture.cleanup(); }
    }
    // Capture the actual selected-context result, then commit a real revision change.
    // The held publication query reads the new revision after that commit.
    const fixture = await workweekReadFixture(database, profileId, weeks);
    try {
      await fixture.seed("current-future");
      const dispatch = globalThis.fetch;
      let release: (() => void) | undefined;
      const selectedRead = new Promise<void>(resolve => { release = resolve; });
      let contextReads = 0;
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init); const url = new URL(req.url);
        if (url.pathname.endsWith("/team_workweek_edit_context")) {
          const response = await dispatch(req); contextReads++;
          await database.query("update public.team_workweek_publications set publication_revision=publication_revision+10 where id=$1", [fixture.ids.base]);
          release!(); return response;
        }
        if (url.pathname === "/rest/v1/team_workweek_publications" && url.searchParams.get("status") === "eq.published") {
          await selectedRead;
        }
        return dispatch(req);
      });
      const stale = await route.GET(request(weeks.current));
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ code: "edit_context_stale" });
      expect(contextReads).toBe(1);
      vi.stubGlobal("fetch", dispatch);
    } finally { await fixture.cleanup(); }
    expect(membershipReads).toBe(1);
    await otherFixture.cleanup();
    otherFixture = await workweekReadFixture(database, otherProfileId, weeks);
    await otherFixture.seed("calendar-history-only");
    const calendarFixture = await workweekReadFixture(database, profileId, weeks);
    try {
      await calendarFixture.seed("calendar-exclusion");
      const calendar = await importTestModule("src/app/api/team-workweek/team/route.ts", { "server-only": {} });
      const from = new Date(Date.parse(`${weeks.current}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
      const to = new Date(Date.parse(`${weeks.future}T12:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
      for (const ranged of [false, true]) {
        const response = await calendar.GET({ headers: request().headers, nextUrl: new URL(`https://application.example.test/api/team-workweek/team${ranged ? `?from=${from}&to=${to}` : ""}`) } as NextRequest);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(new Set(body.publishedOwnerIds)).toEqual(new Set([profileId, otherProfileId]));
        expect(body.currentWorkweeks.map((row: { id: string }) => row.id)).toEqual([calendarFixture.ids.base]);
        expect(body.upcomingWorkweeks.map((row: { id: string }) => row.id)).toEqual([calendarFixture.ids.future]);
        if (ranged) expect(new Set(body.calendarWorkweeks.map((row: { id: string }) => row.id))).toEqual(new Set([calendarFixture.ids.history, calendarFixture.ids.base, calendarFixture.ids.future, otherFixture.ids.history]));
        else expect(body).not.toHaveProperty("calendarWorkweeks");
        expect(JSON.stringify(body)).not.toContain(calendarFixture.ids.draft);
        expect(JSON.stringify(body)).not.toContain(calendarFixture.ids.pending);
        expect(JSON.stringify(body)).not.toMatch(/google_event_id|refresh_token|access_token|team_workweek_windows/);
      }
    } finally { await calendarFixture.cleanup(); }
    for (const state of ["timestamped", "empty-replaced-future"]) {
      const temporal = await workweekReadFixture(database, profileId, weeks);
      try {
        await temporal.seed(state);
        const calendar = await importTestModule("src/app/api/team-workweek/team/route.ts", { "server-only": {} });
        const response = await calendar.GET({ headers: request().headers, nextUrl: new URL("https://application.example.test/api/team-workweek/team") } as NextRequest);
        expect(response.status, state).toBe(200);
        const body = await response.json();
        expect(body.currentWorkweeks.map((row: { id: string }) => row.id)).toEqual([temporal.ids.base]);
        expect(body.upcomingWorkweeks.map((row: { id: string }) => row.id)).toEqual([state === "timestamped" ? temporal.ids.future : temporal.ids.later]);
        if (state === "empty-replaced-future") expect(JSON.stringify(body.workweeks)).not.toContain(temporal.ids.emptyFuture);
      } finally { await temporal.cleanup(); }
    }
    const membershipReadsBeforeRemoval = membershipReads;
    const headers = { apikey: local.ANON_KEY, authorization: `Bearer ${token}` };
    expect((await originalFetch(`${local.API_URL}/rest/v1/team_workweek_publications?select=id`, { headers })).status).toBe(403);
    await database.query("delete from auth.sessions where id=$1", [sessionId]);
    expect((await route.GET(request())).status).toBe(403);
    expect(membershipReads).toBe(membershipReadsBeforeRemoval);
  } catch (error) { primaryError = error; throw error; } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    const cleanupErrors: unknown[] = [];
    for (const operation of [
      () => otherFixture?.cleanup(),
      () => database.query("delete from public.profiles where id=$1", [otherProfileId]),
      () => database.query("delete from auth.users where id=$1", [otherUserId]),
      () => database.query("delete from workspace_private.identity_bindings where user_id=$1", [userId]),
      () => database.query("delete from workspace_private.google_login_sessions where user_id=$1", [userId]),
      () => database.query("delete from public.profiles where id=$1", [profileId]),
      () => database.query("delete from auth.users where id=$1", [userId]),
      () => database.query("update workspace_private.configuration set mode=$1,linking_enforced=$2", [previous.mode,previous.linking_enforced]),
      () => database.end(),
    ]) { try { await operation(); } catch (error) { cleanupErrors.push(error); } }
    if (cleanupErrors.length) throw new AggregateError([...(primaryError ? [primaryError] : []), ...cleanupErrors], "Workweek read acceptance cleanup failed");
  }
}, 60_000);
