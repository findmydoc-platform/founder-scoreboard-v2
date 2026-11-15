import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

const boundaries = [
  { consumer: "epic", change: "original deadline", status: 403 },
  { consumer: "initiative", change: "admitted role", status: 403 },
  { consumer: "table", change: "session", status: 403 },
  { consumer: "table", change: "source", status: 409 },
] as const;

test.each(boundaries)("a settled $consumer continuation cannot publish after loss of its $change", async ({ consumer, change, status }) => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const key = `${prefix}-authority-${consumer}`, firstId = `${key}-0`, laterId = `${key}-1`, outsideId = `${prefix}-outside-scope`;
    const parentId = consumer === "initiative" ? `${prefix}-epic` : consumer === "table" ? initiativeId : null;
    const taskType = consumer === "table" ? "deliverable" : consumer;
    for (const [id, title, order] of [[firstId, `${key} A`, 0], [laterId, `${key} B`, 1], [outsideId, "Synthetic unrelated Item", 2]] as const) {
      await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,sort_order,owner)
        values($1,'findmydoc-founder-execution',$2,$3,$4,'approved','Offen','P2',$5,$6)`,
      [id, title, taskType, parentId, order, actors.founder.profileId]);
    }
    const scope = { view: consumer === "table" ? "table" : "board", level: consumer === "table" ? "epic" : consumer,
      parentId: consumer === "initiative" ? parentId : "all", ...(consumer === "table" ? {} : { column: "Offen" }),
      filters: { query: key, sort: "title", direction: "asc" }, limit: 1 };
    const path = (query: unknown) => `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`;
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const initial = await GET(request("founder", path(scope)));
    expect(initial.status).toBe(200);
    const original = await initial.json();
    const ids = consumer === "table" ? original.model.table.rowIds : original.model.board.cardIds;
    const page = consumer === "table" ? original.model.table.page : original.model.board.columns.Offen;
    expect(ids).toEqual([firstId]);
    expect(page).toMatchObject({ total: 2, loaded: 1, completeness: "partial", continuation: expect.any(String) });
    expect(original.model.coverage.items).toBe("partial");
    expect(original.model.items.some((item: { id: string }) => item.id === outsideId || item.id === laterId)).toBe(false);

    const transport = globalThis.fetch;
    let reached!: () => void, release!: () => void;
    const held = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init), response = await transport(next);
      if (new URL(next.url).pathname.endsWith("/rpc/planning_deliverable_selection")) {
        // Hold a real successful continuation after admission and SQL hydration.
        // No protected row from this response has reached the API consumer yet.
        expect(response.status).toBe(200);
        expect(await response.clone().json()).toMatchObject({ status: "ready", card_ids: [laterId] });
        reached(); await gate;
      }
      return response;
    });
    const jwt = JSON.parse(Buffer.from(actors.founder.token.split(".")[1], "base64url").toString("utf8"));
    if (change === "original deadline") {
      expect(original.readAuthority.deadline).toBeLessThan(jwt.exp * 1000);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(original.readAuthority.deadline - 1000);
    }
    const before = observed.length;
    const pending = GET(request("founder", path({ ...scope, continuation: page.continuation })));
    try {
      await Promise.race([held, pending.then(() => { throw new Error("Continuation completed before its held SQL response"); })]);
      if (change === "admitted role") await db.query("update public.profiles set platform_role='viewer' where id=$1", [actors.founder.profileId]);
      if (change === "session") await db.query("delete from auth.sessions where id=$1", [actors.founder.sessionId]);
      if (change === "source") await db.query("update public.tasks set sort_order=44 where id=$1", [laterId]);
      if (change === "original deadline") {
        vi.setSystemTime(original.readAuthority.deadline);
        expect(Date.now()).toBeLessThan(jwt.exp * 1000);
      }
      release();
      const denied = await pending;
      expect(denied.status).toBe(status);
      const body = await denied.json();
      for (const field of ["model", "summaries", "readAuthority"]) expect(body).not.toHaveProperty(field);
      if (change === "source") expect(body.code).toBe("stale_continuation");
      expect(observed.slice(before).filter(entry => entry.path.endsWith("/rpc/planning_deliverable_selection"))).toHaveLength(1);
      expect(observed.slice(before).some(entry => /\/(active_tasks|tasks|planning_workspace_snapshot)$/.test(entry.path))).toBe(false);
    } finally {
      release(); await pending; vi.useRealTimers();
    }
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  }, "linking");
}, 120_000);
