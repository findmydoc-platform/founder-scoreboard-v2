import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { createCalendarLiveFixture } from "./helpers/calendar-live-fixture";

it("the Planning source observation covers its Board sources and preserves live session, permit and server-only boundaries", async () => {
  const fixture = await createCalendarLiveFixture();
  const nativeFetch = globalThis.fetch;
  const prefix = `source-${randomUUID()}`;
  let createdProject = false;
  try {
    await fixture.mode("linking");
    createdProject = (await fixture.database.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic Planning') on conflict(id) do nothing returning id")).rowCount === 1;
    const actor = await fixture.actor("viewer");
    // The real OIDC SDK parses expiry before our controlled STS transport runs.
    const providerToken = [Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "synthetic"].join(".");
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: fixture.local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: fixture.local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: fixture.local.SERVICE_ROLE_KEY, REQUIRE_SUPABASE_AUTH: "true",
      GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-source-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-source@example.test",
      GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", VERCEL_OIDC_TOKEN: providerToken })) vi.stubEnv(name, value);
    const paths: string[] = [];
    let failVersion = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
      if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now() + 3600000).toISOString() });
      if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
      if (url.origin !== new URL(fixture.local.API_URL).origin) throw new Error("Unexpected external provider");
      paths.push(url.pathname);
      if (failVersion && url.pathname === "/rest/v1/rpc/planning_source_version") return Response.json({ message: "Unavailable" }, { status: 503 });
      return nativeFetch(request);
    });
    const { GET } = await importTestModule("src/app/api/planning-source-version/route.ts", { "server-only": {} });
    const request = (token?: string) => new NextRequest("http://localhost:3000/api/planning-source-version", { headers: token ? { authorization: `Bearer ${token}` } : {} });
    const version = async () => {
      const response = await GET(request(actor.session.access_token));
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result).toEqual({ version: expect.any(String) });
      return result.version as string;
    };
    let previous = await version();
    expect(paths).toContain("/rest/v1/rpc/current_authenticated_profile");
    expect(paths).toContain("/rest/v1/rpc/workspace_dispatch_prepare");
    expect(paths).toContain("/rest/v1/rpc/workspace_release_permit");
    expect(paths).not.toContain("/rest/v1/rpc/planning_workspace_snapshot");
    expect(paths.some(path => path.endsWith("/active_tasks"))).toBe(false);
    const sqlVersion = async () => (await fixture.database.query("select public.planning_source_version() as version")).rows[0].version;
    const changes: [string, unknown[]][] = [
      ["insert into public.tasks(id,project_id,title,status,priority,task_type) values($1,'findmydoc-founder-execution','Synthetic Epic','Offen','P2','epic')", [`${prefix}-epic`]],
      ["insert into public.tasks(id,project_id,title,status,priority,task_type,parent_task_id,approval_status) values($1,'findmydoc-founder-execution','Synthetic Initiative','Offen','P2','initiative',$2,'approved')", [`${prefix}-initiative`, `${prefix}-epic`]],
      ["insert into public.tasks(id,project_id,title,status,priority,task_type,parent_task_id,approval_status) values($1,'findmydoc-founder-execution','Synthetic card','Offen','P2','deliverable',$2,'approved')", [`${prefix}-card`, `${prefix}-initiative`]],
      ["update public.tasks set title='Same-count change' where id=$1", [`${prefix}-card`]],
      ["insert into public.planning_item_strategy(task_id,goal) values($1,'Synthetic goal')", [`${prefix}-initiative`]],
      ["insert into public.planning_item_raci_assignments(task_id,profile_id,role) values($1,$2,'accountable')", [`${prefix}-initiative`, actor.profileId]],
      ["insert into public.task_links(task_id,type,label,url) values($1,'evidence','Synthetic evidence','https://example.test/evidence')", [`${prefix}-card`]],
      ["insert into public.task_dependencies(task_id,note) values($1,'Synthetic dependency note')", [`${prefix}-card`]],
      ["insert into public.task_blockers(task_id,profile_id,reason) values($1,$2,'Synthetic blocker')", [`${prefix}-card`, actor.profileId]],
      ["insert into public.task_relationship_edges(task_id,related_task_id,relation_type) values($1,$2,'relates_to')", [`${prefix}-card`, `${prefix}-initiative`]],
      ["insert into public.sprints(id,project_id,name) values($1,'findmydoc-founder-execution','Synthetic Sprint')", [`${prefix}-sprint`]],
      ["update public.projects set range_label='Synthetic range' where id='findmydoc-founder-execution'", []],
      ["update public.profiles set focus='Synthetic changed focus' where id=$1", [actor.profileId]],
      ["insert into public.profile_ui_preferences(profile_id,expanded_item_ids) values($1,array[$2])", [actor.profileId, `${prefix}-initiative`]],
      ["update auth.identities set identity_data=jsonb_set(identity_data,'{picture}','\"https://example.test/avatar.png\"') where user_id=$1 and provider='google'", [actor.userId]],
    ];
    for (const [sql, values] of changes) {
      await fixture.database.query(sql, values);
      const current = await sqlVersion();
      expect(current, sql).not.toBe(previous);
      previous = current;
    }
    expect(await version()).toBe(previous);
    await fixture.database.query("begin");
    await fixture.database.query("update workspace_private.identity_bindings set google_subject='synthetic-rebound' where user_id=$1", [actor.userId]);
    expect(await sqlVersion()).not.toBe(previous);
    await fixture.database.query("rollback");
    expect(await sqlVersion()).toBe(previous);
    // This is Board evidence, not a discussion clock. Comments must use their own future observation.
    await fixture.database.query("insert into public.task_comments(task_id,profile_id,comment,github_delivery_applicable) values($1,$2,'Synthetic discussion',false)", [`${prefix}-card`, actor.profileId]);
    expect(await sqlVersion()).toBe(previous);
    await fixture.database.query("begin");
    await fixture.database.query("update public.tasks set title='Rolled back source' where id=$1", [`${prefix}-card`]);
    expect(await sqlVersion()).not.toBe(previous);
    await fixture.database.query("rollback");
    expect(await sqlVersion()).toBe(previous);
    for (const role of ["ceo", "founder", "deputy"]) {
      const allowed = await fixture.actor(role);
      expect((await GET(request(allowed.session.access_token))).status).toBe(200);
    }
    for (const token of [fixture.local.ANON_KEY, actor.session.access_token]) {
      const denied = await nativeFetch(`${fixture.local.API_URL}/rest/v1/rpc/planning_source_version`, { method: "POST", headers: { apikey: fixture.local.ANON_KEY, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: "{}" });
      expect(denied.ok).toBe(false);
    }
    expect((await GET(request())).status).toBe(401);
    await fixture.database.query("update public.profiles set auth_user_id=null where id=$1", [actor.profileId]);
    expect((await GET(request(actor.session.access_token))).status).toBe(403);
    await fixture.database.query("update public.profiles set auth_user_id=$1 where id=$2", [actor.userId, actor.profileId]);
    failVersion = true;
    const unavailable = await GET(request(actor.session.access_token));
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).version).toBeUndefined();
    expect((await fixture.database.query("select count(*)::int as count from workspace_private.request_permits where user_id=$1", [actor.userId])).rows[0].count).toBe(0);
    failVersion = false;
    await fixture.database.query("delete from auth.sessions where id=$1", [actor.sessionId]);
    const revoked = await GET(request(actor.session.access_token));
    expect(revoked.status).toBeGreaterThanOrEqual(400);
    expect((await revoked.json()).version).toBeUndefined();
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await fixture.database.query("rollback");
    await fixture.database.query("select set_config('founderops.trash_lifecycle_write','on',false)");
    await fixture.database.query("delete from public.tasks where id like $1", [`${prefix}%`]);
    await fixture.database.query("delete from public.sprints where id=$1", [`${prefix}-sprint`]);
    if (createdProject) await fixture.database.query("delete from public.projects where id='findmydoc-founder-execution'");
    await fixture.close();
  }
}, 120_000);
