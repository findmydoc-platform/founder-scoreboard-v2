import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("selected JSON publication reads its live actor and source together without a second service source dispatch", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parent = `${prefix}-publication-parent`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`,
    [parent, initiativeId, actors.founder.profileId]);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", column: "Offen", filters: { query: parent } };
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.model.board.cardIds).toEqual([parent]);
    expect(body.model.board.childProgressById[parent]).toEqual({ completed: 0, total: 0, unfinished: 0, percentage: 0 });
    expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
    // This is a dispatch budget at the real database boundary, not a timing
    // threshold. The complete result still needs a fresh publication check.
    const publication = observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context"));
    expect(publication).toEqual([expect.objectContaining({ actor: "founder", permit: true })]);
    expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_source_version"))).toEqual([]);
    expect(body).not.toHaveProperty("publicationContext");
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  }, "linking");
}, 120_000);

test("the atomic publication RPC admits only a mapped live user session and returns its own current role", async () => {
  await withPlanningCredentialDatabase(async ({ db, actors, rpc }) => {
    const revision = (await db.query("select public.planning_source_version() as value")).rows[0].value;
    for (const role of ["ceo", "deputy", "founder", "viewer"] as const) {
      const response = await rpc("planning_board_publication_context", {}, role);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ profile_id: actors[role].profileId, platform_role: role, source_revision: revision });
    }
    for (const role of ["anonymous", "unmapped", "service"] as const) {
      const response = await rpc("planning_board_publication_context", {}, role);
      expect([401, 403]).toContain(response.status);
      expect(await response.json()).not.toHaveProperty("source_revision");
    }
    await db.query("delete from auth.sessions where id=$1", [actors.viewer.sessionId]);
    const revoked = await rpc("planning_board_publication_context", {}, "viewer");
    expect(revoked.status).toBe(403);
    expect(await revoked.json()).not.toHaveProperty("source_revision");
    await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [actors.founder.sessionId]);
    expect((await rpc("planning_board_publication_context", {}, "founder")).status).toBe(403);
  });
}, 120_000);

test.each(["source", "role", "session"] as const)("a held complete summary cannot publish after its %s foundation changes", async change => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parent = `${prefix}-held-publication`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`,
    [parent, initiativeId, actors.founder.profileId]);
    const transport = globalThis.fetch;
    let summaryReady = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init), response = await transport(next);
      if (new URL(next.url).pathname.endsWith("/rpc/planning_deliverable_summaries")) {
        expect(response.status).toBe(200);
        const summary = await response.clone().json();
        expect(summary.status).toBe("ready");
        expect(summary.child_progress[parent]).toEqual({ completed: 0, total: 0, unfinished: 0, percentage: 0 });
        summaryReady = true;
        if (change === "source") await db.query("update public.tasks set title='Changed after summary' where id=$1", [parent]);
        if (change === "role") await db.query("update public.profiles set platform_role='viewer' where id=$1", [actors.founder.profileId]);
        if (change === "session") await db.query("delete from auth.sessions where id=$1", [actors.founder.sessionId]);
      }
      return response;
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", column: "Offen", filters: { query: parent } };
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(summaryReady).toBe(true);
    expect(response.status).toBe(change === "source" ? 503 : 403);
    const body = await response.json();
    for (const field of ["model", "summaries", "readAuthority", "publicationContext"]) expect(body).not.toHaveProperty(field);
    const publications = observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context"));
    expect(publications).toHaveLength(change === "session" ? 0 : 1);
    expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_source_version"))).toEqual([]);
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  }, "linking");
}, 120_000);

test("an unavailable atomic publication read fails closed without a service fallback", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parent = `${prefix}-unavailable-publication`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`,
    [parent, initiativeId, actors.founder.profileId]);
    const transport = globalThis.fetch;
    let failed = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init);
      if (new URL(next.url).pathname.endsWith("/rpc/planning_board_publication_context")) {
        failed = true;
        return Response.json({ message: "Synthetic unavailable publication read" }, { status: 503 });
      }
      return transport(next);
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", column: "Offen", filters: { query: parent } };
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(failed).toBe(true);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).not.toHaveProperty("model");
    expect(body).not.toHaveProperty("readAuthority");
    expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_source_version"))).toEqual([]);
  }, "linking");
}, 120_000);
