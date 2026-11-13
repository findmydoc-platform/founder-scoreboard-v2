import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { createCalendarLiveFixture } from "./helpers/calendar-live-fixture";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";

it("complete enumeration and selected SQL reads reject source shifts at their actual publication fences", async () => {
  const fixture = await createCalendarLiveFixture();
  const nativeFetch = globalThis.fetch;
  const prefix = `consistency-${randomUUID()}`;
  const foreignProject = `${prefix}-foreign`;
  let createdProject = false;
  let mutation: { table: string; run: () => Promise<unknown> } | undefined;
  let mutations = 0;
  let beforeFence: (() => Promise<unknown>) | undefined;
  let revokeBeforeLiveCheck = false;
  let snapshotTransports = 0;
  let sourceTransports = 0;
  let failFence = false;
  try {
    await fixture.mode("linking");
    createdProject = (await fixture.database.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic Planning') on conflict(id) do nothing returning id")).rowCount === 1;
    await fixture.database.query("insert into public.projects(id,name) values($1,'Unrelated synthetic project')", [foreignProject]);
    await fixture.database.query("insert into public.tasks(id,project_id,title,status,priority,task_type) values($1,'findmydoc-founder-execution','Synthetic Epic','Offen','P2','epic')", [`${prefix}-epic`]);
    await fixture.database.query("insert into public.tasks(id,project_id,title,status,priority,task_type,parent_task_id,approval_status) values($1,'findmydoc-founder-execution','Synthetic Initiative','Offen','P2','initiative',$2,'approved')", [`${prefix}-initiative`, `${prefix}-epic`]);
    await fixture.database.query(`insert into public.tasks(id,project_id,title,status,priority,task_type,approval_status,sort_order,parent_task_id)
      select $1 || '-' || lpad(n::text,4,'0'),'findmydoc-founder-execution','Synthetic card ' || n,'Offen','P2','deliverable','approved',n,$2
      from generate_series(1,1027) n`, [prefix, `${prefix}-initiative`]);
    await fixture.database.query("insert into public.tasks(id,project_id,title,status,priority,task_type) values($1,$2,'Unrelated card','Offen','P2','epic')", [`${prefix}-foreign`, foreignProject]);
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: fixture.local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: fixture.local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: fixture.local.SERVICE_ROLE_KEY, REQUIRE_SUPABASE_AUTH: "true",
      GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-consistency-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-consistency@example.test",
      GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", VERCEL_OIDC_TOKEN: "synthetic-oidc" })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
      if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now() + 3600000).toISOString() });
      if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
      if (url.origin !== new URL(fixture.local.API_URL).origin) throw new Error("Unexpected external provider");
      if (revokeBeforeLiveCheck && beforeFence && url.pathname === "/auth/v1/user") {
        const revoke = beforeFence; beforeFence = undefined; revokeBeforeLiveCheck = false;
        await revoke();
      }
      if (url.pathname === "/rest/v1/rpc/planning_workspace_snapshot") {
        snapshotTransports++;
        if (snapshotTransports === 2 && failFence) {
          failFence = false;
          return Response.json({ code: "XX000", message: "Synthetic unavailable snapshot" }, { status: 503 });
        }
      }
      if (mutation && url.pathname === `/rest/v1/${mutation.table}` && Number(url.searchParams.get("offset")) > 0) {
        const next = mutation; mutation = undefined; mutations++;
        await next.run();
      }
      if (url.pathname === "/rest/v1/rpc/planning_source_version") {
        sourceTransports++;
        if (failFence) { failFence = false; return Response.json({ code: "XX000", message: "Synthetic unavailable source fence" }, { status: 503 }); }
      }
      const response = await nativeFetch(request);
      // Selection and hydration share one SQL statement. Mutate only after its
      // actual response so the separate publication fence must detect the shift.
      if (mutation && url.pathname === "/rest/v1/rpc/planning_deliverable_selection") {
        const next = mutation; mutation = undefined; mutations++;
        await next.run();
      }
      if (beforeFence && url.pathname === "/rest/v1/task_links" && Number(url.searchParams.get("offset")) > 0) revokeBeforeLiveCheck = true;
      return response;
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const actor = await fixture.actor("viewer");
    vi.stubEnv("VERCEL_OIDC_TOKEN", actor.session.access_token);
    const base = `sb-${new URL(fixture.local.API_URL).hostname.split(".")[0]}-auth-token`;
    const read = async (scope: object = { view: "complete" }) => {
      await new Promise(resolve => setTimeout(resolve, 250));
      revokeBeforeLiveCheck = false;
      snapshotTransports = 0; sourceTransports = 0;
      const response = await GET(new NextRequest(`https://application.example.test/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`, {
        headers: { cookie: `${base}=base64-${Buffer.from(JSON.stringify(actor.session)).toString("base64url")}` },
      }));
      expect((await fixture.database.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actor.userId])).rows[0].remaining).toBe(0);
      return response;
    };
    const stable = await read();
    expect(stable.status).toBe(200);
    const first = (await stable.json()).model as PlanningWorkspaceModel;
    expect(first.board).toBeUndefined();
    expect(first.items.filter(item => item.taskType === "deliverable")).toHaveLength(1027);
    const initialBoard = await read({ view: "board", filters: {} });
    expect(initialBoard.status).toBe(200);
    expect((await initialBoard.json()).model.board.columns.Offen).toMatchObject({ total: 1027, loaded: 20, completeness: "partial" });
    mutation = { table: "active_tasks", run: () => fixture.database.query("update public.tasks set sort_order=5000 where id=$1", [`${prefix}-0001`]) };
    expect((await read()).status).toBe(503);
    expect(mutations).toBe(1);

    mutation = { table: "active_tasks", run: async () => {
      await fixture.database.query("begin");
      await fixture.database.query("select set_config('founderops.trash_lifecycle_write','on',true)");
      await fixture.database.query("delete from public.tasks where id=$1", [`${prefix}-0002`]);
      await fixture.database.query("insert into public.tasks(id,project_id,title,status,priority,task_type,approval_status,sort_order,parent_task_id) values($1,'findmydoc-founder-execution','Replacement card','Offen','P2','deliverable','approved',0,$2)", [`${prefix}-replacement`, `${prefix}-initiative`]);
      await fixture.database.query("commit");
    } };
    expect((await read()).status).toBe(503);
    expect(mutations).toBe(2);

    mutation = { table: "active_tasks", run: () => fixture.database.query("update public.tasks set sort_order=5500 where id=$1", [`${prefix}-0004`]) };
    expect((await read({ view: "board", filters: {} })).status).toBe(503);
    expect(mutations).toBe(3);
    const current = await read({ view: "board", filters: {} });
    expect(current.status).toBe(200);
    const continuation = ((await current.json()).model as PlanningWorkspaceModel).board!.columns.Offen.continuation!;
    mutation = { table: "active_tasks", run: () => fixture.database.query("update public.tasks set sort_order=6000 where id=$1", [`${prefix}-0003`]) };
    expect((await read({ view: "board", filters: {}, column: "Offen", continuation })).status).toBe(409);
    expect(mutations).toBe(4);

    await fixture.database.query(`insert into public.task_links(task_id,type,label,url,position)
      select id,'evidence','Evidence','https://example.test/' || id,sort_order from public.tasks where project_id='findmydoc-founder-execution' and task_type='deliverable' and id like $1`, [`${prefix}%`]);
    await fixture.database.query("insert into public.task_links(task_id,type,label,url,position) values($1,'evidence','Foreign evidence','https://example.test/foreign',-1)", [`${prefix}-foreign`]);
    mutation = { table: "task_links", run: () => fixture.database.query("update public.task_links set position=9000 where task_id=$1", [`${prefix}-foreign`]) };
    const complete = await read({ view: "complete" });
    expect(complete.status).toBe(200);
    expect(mutations).toBe(5);
    const model = (await complete.json()).model as PlanningWorkspaceModel;
    expect(model.coverage?.links).toBe("complete");
    expect(model.items).toHaveLength(1029);
    expect(model.items.filter(item => item.taskType === "deliverable").every(item => item.evidenceLinks?.length === 1)).toBe(true);
    expect(new Set(model.items.map(item => item.id)).size).toBe(1029);
    const currentBoard = await read({ view: "board", filters: {} });
    expect(currentBoard.status).toBe(200);
    const currentContinuation = ((await currentBoard.json()).model as PlanningWorkspaceModel).board!.columns.Offen.continuation!;
    failFence = true;
    expect((await read({ view: "board", filters: {}, column: "Offen", continuation: currentContinuation })).status).toBe(503);
    expect(failFence).toBe(false);
    expect(sourceTransports).toBe(1);
    beforeFence = () => fixture.database.query("delete from auth.sessions where id=$1", [actor.sessionId]);
    const deniedFence = await read();
    expect(deniedFence.status).toBe(503);
    expect((await deniedFence.json()).model).toBeUndefined();
    expect(beforeFence).toBeUndefined();
    expect(snapshotTransports).toBe(1);
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await fixture.database.query("begin");
    await fixture.database.query("select set_config('founderops.trash_lifecycle_write','on',true)");
    await fixture.database.query("delete from public.tasks where id like $1", [`${prefix}%`]);
    await fixture.database.query("commit");
    await fixture.database.query("delete from public.projects where id=$1", [foreignProject]);
    if (createdProject) await fixture.database.query("delete from public.projects where id='findmydoc-founder-execution'");
    await fixture.close();
  }
}, 120_000);
