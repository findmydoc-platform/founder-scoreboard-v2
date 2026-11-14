import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("a selected JSON page resolves avatar identity while its complete summary response is pending", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request }) => {
    const parent = `${prefix}-parallel-summary`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`,
    [parent, initiativeId, actors.founder.profileId]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner)
      values($1,'findmydoc-founder-execution','Synthetic child','sub_issue',$2,'Erledigt','P2',$3)`,
    [`${parent}-child`, parent, actors.other.profileId]);

    const transport = globalThis.fetch;
    let release!: () => void, reached!: () => void;
    const held = new Promise<void>(resolve => { reached = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let avatarsStarted = false, published = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init), path = new URL(next.url).pathname;
      if (path.endsWith("/rpc/workspace_access_contexts")) avatarsStarted = true;
      const response = await transport(next);
      if (path.endsWith("/rpc/planning_deliverable_summaries")) {
        expect(response.status).toBe(200);
        expect((await response.clone().json()).status).toBe("ready");
        reached();
        await gate;
      }
      return response;
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", column: "Offen", filters: { query: parent } };
    const pending = GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`))
      .then(response => { published = true; return response; });
    try {
      await held;
      expect(published).toBe(false);
      await vi.waitFor(() => expect(avatarsStarted).toBe(true), { timeout: 1000 });
      expect(published).toBe(false);
      release();
      const response = await pending;
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.model.board.cardIds).toEqual([parent]);
      expect(body.model.board.childProgressById[parent]).toEqual({ completed: 1, total: 1, unfinished: 0, percentage: 100 });
      expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
    } finally {
      release();
      await pending;
    }
  });
}, 120_000);
