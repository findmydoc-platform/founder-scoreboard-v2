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
      vi.stubEnv("VERCEL_OIDC_TOKEN", token);
      const warm = await authorize();
      if (!warm.ok) throw new Error("Expected mapped Planning reader");
      expect((await warm.planning.readRevision()).error).toBeNull();
      attempts = [];
      const authorized = await authorizeCookie(actor.session);
      expect(authorized).toMatchObject({ ok: true, profile: { id: actor.profileId, platformRole: role } });
      if (!authorized.ok) throw new Error("Expected mapped Planning reader");
      const revision = await authorized.planning.readRevision();
      expect(revision.error).toBeNull();
      expect(revision.scopeRevision).toEqual(expect.any(String));
      // Cookie proxy contributes one live Auth request; the route contributes 16.
      expect(attempts).toHaveLength(17);
      expect(attempts.filter(path => path === "/auth/v1/user")).toHaveLength(5);
      for (const rpc of ["workspace_dispatch_prepare", "current_authenticated_profile", "workspace_release_permit"]) {
        expect(attempts.filter(path => path === `/rest/v1/rpc/${rpc}`)).toHaveLength(3);
      }
      expect(attempts.filter(path => path === "/rest/v1/rpc/workspace_access_context")).toHaveLength(1);
      expect(attempts.filter(path => path === "/rest/v1/rpc/planning_workspace_snapshot")).toHaveLength(1);
      expect((await fixture.database.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actor.userId])).rows[0].remaining).toBe(0);
      for (const credential of [fixture.local.ANON_KEY, actor.session.access_token]) {
        const direct = await nativeFetch(`${fixture.local.API_URL}/rest/v1/rpc/planning_workspace_snapshot`, {
          method: "POST", headers: { apikey: fixture.local.ANON_KEY, authorization: `Bearer ${credential}`, "content-type": "application/json" }, body: "{}",
        });
        expect([401,403,404]).toContain(direct.status);
      }
      await fixture.database.query("update public.profiles set auth_user_id=null where id=$1", [actor.profileId]);
      attempts = [];
      expect((await authorized.planning.readRevision()).error).not.toBeNull();
      expect(attempts.filter(path => path === "/rest/v1/rpc/planning_workspace_snapshot")).toHaveLength(0);
      await fixture.database.query("update public.profiles set auth_user_id=$1 where id=$2", [actor.userId,actor.profileId]);
      await fixture.database.query("delete from auth.sessions where id=$1", [actor.sessionId]);
      attempts = [];
      expect((await authorized.planning.readRevision()).error).not.toBeNull();
      expect(attempts.filter(path => path === "/rest/v1/rpc/planning_workspace_snapshot")).toHaveLength(0);
    }
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await fixture.close();
  }
}, 60_000);

it("Planning revision detects older Item, relationship and Sprint changes and rejects a model changed during enumeration", async () => {
  const fixture = await createCalendarLiveFixture();
  const nativeFetch = globalThis.fetch;
  let afterSnapshot: (() => Promise<unknown>) | undefined;
  let paths: string[] = [];
  try {
    await fixture.mode("legacy", false);
    const actor = await fixture.actor("viewer");
    await fixture.database.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic Planning')");
    await fixture.database.query(`insert into public.tasks(id,project_id,title,status,priority,updated_at) values
      ('revision-old','findmydoc-founder-execution','Older Item','Offen','P2','2020-01-01'),
      ('revision-new','findmydoc-founder-execution','Newest Item','Offen','P2','2090-01-01')`);
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: fixture.local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: fixture.local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: fixture.local.SERVICE_ROLE_KEY,
      REQUIRE_SUPABASE_AUTH: "true" })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.origin !== new URL(fixture.local.API_URL).origin) throw new Error("Unexpected external provider");
      paths.push(url.pathname);
      const response = await nativeFetch(request);
      if (url.pathname === "/rest/v1/rpc/planning_workspace_snapshot" && afterSnapshot) {
        const change = afterSnapshot; afterSnapshot = undefined; await change();
      }
      return response;
    });
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const authorize = (action: "planning.revision.read" | "planning.board.read") => authorizeCredentialAction({ credential: { kind: "session-request", request: new NextRequest("https://application.example.test/api/planning-revision", { headers: { authorization: `Bearer ${actor.session.access_token}` } }) }, action });
    const revisionPermission = await authorize("planning.revision.read");
    if (!revisionPermission.ok) throw new Error("Expected mapped Planning reader");
    const read = async () => {
      paths = [];
      const value = await revisionPermission.planning.readRevision();
      expect(value.error).toBeNull();
      expect(value.scopeRevision).toEqual(expect.any(String));
      expect(paths.filter(path => path === "/rest/v1/rpc/planning_workspace_snapshot")).toHaveLength(1);
      expect(paths.filter(path => ["/rest/v1/active_tasks", "/rest/v1/sprints", "/rest/v1/task_relationship_edges"].includes(path))).toEqual([]);
      return value;
    };
    const initial = await read();
    for (const statement of [
      "update public.tasks set title='Changed older Item' where id='revision-old'",
      "update public.tasks set review_evidence_exception_note='Explicit evidence exception',review_evidence_exception_confirmed_at=clock_timestamp() where id='revision-old'",
      "insert into public.planning_item_strategy(task_id,goal) values('revision-old','Goal')",
      "update public.planning_item_strategy set goal='Changed goal' where task_id='revision-old'",
      "delete from public.planning_item_strategy where task_id='revision-old'",
      "insert into public.profiles(id,name,platform_role) values('revision-person','Synthetic Person','viewer')",
      "update public.profiles set name='Changed Person' where id='revision-person'",
      "insert into public.planning_item_raci_assignments(task_id,profile_id,role) values('revision-old','revision-person','responsible')",
      "update public.planning_item_raci_assignments set role='consulted' where task_id='revision-old'",
      "delete from public.planning_item_raci_assignments where task_id='revision-old'",
      "delete from public.profiles where id='revision-person'",
      "insert into public.task_dependencies(task_id,note) values('revision-old','Waiting')",
      "update public.task_dependencies set note='Waiting elsewhere' where task_id='revision-old'",
      "delete from public.task_dependencies where task_id='revision-old'",
      "insert into public.task_links(task_id,type,label,url) values('revision-old','evidence','Proof','https://example.test/proof')",
      "update public.task_links set label='Changed evidence' where task_id='revision-old'",
      "delete from public.task_links where task_id='revision-old'",
      "insert into public.task_blockers(task_id,reason) values('revision-old','Waiting')",
      "update public.task_blockers set reason='Changed Blocker' where task_id='revision-old'",
      "delete from public.task_blockers where task_id='revision-old'",
      "update public.projects set range_label='Changed range' where id='findmydoc-founder-execution'",
      "insert into public.task_relationship_edges(task_id,related_task_id,relation_type) values('revision-old','revision-new','relates_to')",
      "delete from public.task_relationship_edges where task_id='revision-old'",
      "insert into public.sprints(id,project_id,name,status) values('revision-sprint','findmydoc-founder-execution','Synthetic Sprint','planning')",
      "update public.sprints set name='Changed Sprint' where id='revision-sprint'",
      "delete from public.sprints where id='revision-sprint'",
    ]) {
      const before = await read(); await fixture.database.query(statement); const after = await read();
      expect(after.scopeRevision).not.toBe(before.scopeRevision);
      expect(after.count).toBe(initial.count);
      expect(after.data).toEqual(initial.data);
    }
    const beforeAvatar = await read();
    await fixture.database.query("update auth.identities set identity_data=jsonb_set(identity_data,'{picture}','\"https://lh3.googleusercontent.com/a/revision\"') where user_id=$1 and provider='google'", [actor.userId]);
    expect((await read()).scopeRevision).not.toBe(beforeAvatar.scopeRevision);
    const beforeBinding = await read();
    await fixture.database.query("update workspace_private.identity_bindings set google_subject=google_subject || '-changed' where user_id=$1", [actor.userId]);
    expect((await read()).scopeRevision).not.toBe(beforeBinding.scopeRevision);
    await fixture.database.query("update workspace_private.identity_bindings set google_subject=replace(google_subject,'-changed','') where user_id=$1", [actor.userId]);
    await fixture.database.query("insert into public.profile_ui_preferences(profile_id,default_workspace) values($1,'planning')", [actor.profileId]);
    const beforePreferences = await read();
    await fixture.database.query("update public.profile_ui_preferences set default_task_view='table' where profile_id=$1", [actor.profileId]);
    const afterPreferences = await read();
    // Stored UI preferences contribute to the Board model's source evidence.
    expect(afterPreferences.scopeRevision).not.toBe(beforePreferences.scopeRevision);
    expect(afterPreferences.count).toBe(initial.count);
    expect(afterPreferences.data).toEqual(initial.data);
    await fixture.database.query("update auth.sessions set refreshed_at=clock_timestamp() where id=$1", [actor.sessionId]);
    await fixture.database.query("update auth.identities set identity_data=jsonb_set(identity_data,'{private_other_field}','true') where user_id=$1 and provider='google'", [actor.userId]);
    await fixture.database.query("update workspace_private.identity_bindings set linked_at=clock_timestamp() where user_id=$1", [actor.userId]);
    await fixture.database.query("insert into public.projects(id,name) values('revision-other','Unrelated')");
    await fixture.database.query("insert into public.tasks(id,project_id,title,status,priority) values('revision-unrelated','revision-other','Unrelated','Offen','P2')");
    await fixture.database.query("insert into public.task_dependencies(task_id,note) values('revision-unrelated','Private unrelated activity')");
    expect((await read()).scopeRevision).toBe(afterPreferences.scopeRevision);
    const boardPermission = await authorize("planning.board.read");
    if (!boardPermission.ok) throw new Error("Expected mapped Board reader");
    const beforeModel = await read();
    afterSnapshot = () => fixture.database.query("update public.tasks set title='Changed during enumeration' where id='revision-old'");
    const loaded = await boardPermission.planning.loadBoard({ view: "complete" });
    expect(loaded.status).toBe("unavailable");
    const currentModel = await boardPermission.planning.loadBoard({ view: "complete" });
    if (currentModel.status !== "ready") throw new Error("Expected stable complete Planning model");
    expect(currentModel.model.scopeRevision).not.toBe(beforeModel.scopeRevision);
    expect(currentModel.model.items.find((item: { id: string; title: string }) => item.id === "revision-old")?.title).toBe("Changed during enumeration");
    expect((await read()).scopeRevision).toBe(currentModel.model.scopeRevision);
    await fixture.database.query("select set_config('founderops.trash_lifecycle_write','on',false)");
    const beforeTrash = await read();
    await fixture.database.query("update public.tasks set trashed_at=transaction_timestamp(),trashed_by=$1,trash_reason='Synthetic withdrawal',trash_cause='withdrawn',purge_after=transaction_timestamp()+interval '90 days',trash_root_type='deliverable',trash_root_id=id,trash_revision=1 where id='revision-old'", [actor.profileId]);
    const trashed = await read();
    expect(trashed.count).toBe(1); expect(trashed.scopeRevision).not.toBe(beforeTrash.scopeRevision);
    await fixture.database.query("insert into public.task_dependencies(task_id,note) values('revision-old','Hidden trash change')");
    expect((await read()).scopeRevision).toBe(trashed.scopeRevision);
    await fixture.database.query("update public.tasks set trashed_at=null,trashed_by=null,trash_reason=null,trash_cause=null,purge_after=null,trash_root_type=null,trash_root_id=null where id='revision-old'");
    const restored = await read(); expect(restored.count).toBe(2); expect(restored.scopeRevision).not.toBe(trashed.scopeRevision);
    await fixture.database.query("delete from public.tasks where id='revision-old'");
    const removed = await read(); expect(removed.count).toBe(1); expect(removed.scopeRevision).not.toBe(restored.scopeRevision);
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await fixture.database.query("select set_config('founderops.trash_lifecycle_write','on',false)");
    await fixture.database.query("delete from public.projects where id in ('findmydoc-founder-execution','revision-other')");
    await fixture.database.query("delete from public.profiles where id='revision-person'");
    await fixture.close();
  }
}, 60_000);
