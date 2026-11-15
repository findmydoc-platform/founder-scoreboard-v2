import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("Epic initial publication accepts only its issued summary and consumes the atomic admission once", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, actors, request, observed }) => {
    const epicId = `${prefix}-native-summary`, childId = `${prefix}-native-child`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,status,owner)
      values($1,'findmydoc-founder-execution',$1,'epic','Offen',$2)`, [epicId, actors.founder.profileId]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'initiative',$2,'proposed','Offen','P2',$3)`, [childId, epicId, actors.founder.profileId]);
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: request("founder", "/api/planning-board-data") }, action: "planning.board.read" });
    expect(permission.ok).toBe(true);
    if (!permission.ok) throw new Error("Synthetic native Epic admission unavailable");
    const controller = new AbortController();
    const result = await permission.planning.startBoardQuery({ view: "board", level: "epic", filters: { query: epicId } }, { signal: controller.signal });
    expect(result.status).toBe("ready");
    if (result.status !== "ready" || !result.delivery) throw new Error("Synthetic native Epic delivery unavailable");
    const delivery = result.delivery;
    try {
      const [column, summary] = await Promise.all([delivery.columns.Offen!, delivery.summaries!]);
      expect(column.kind).toBe("column"); expect(summary.kind).toBe("summaries");
      if (column.kind !== "column" || summary.kind !== "summaries") throw new Error("Synthetic native Epic content unavailable");
      expect(column.cardIds).toEqual([epicId]);
      expect(summary.childProgressById[epicId]).toEqual({ completed: 0, total: 1, unfinished: 1, percentage: 0 });
      const before = observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context")).length;
      const forged = { ...summary, childProgressById: { ...summary.childProgressById,
        [epicId]: { completed: 0, total: 999, unfinished: 999, percentage: 0 } } };
      const rejected = await delivery.checkPublication(column, forged);
      expect(rejected.kind).toBe("failure");
      expect(rejected).not.toHaveProperty("items");
      expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context"))).toHaveLength(before);

      const foreign = await delivery.checkPublication(column, { ...summary, readId: "unrelated-native-delivery" });
      expect(foreign.kind).toBe("failure"); expect(foreign).not.toHaveProperty("items");
      const forgedColumn = await delivery.checkPublication({ ...column, items: [{ ...column.items[0], title: "Unissued payload" }] }, summary);
      expect(forgedColumn.kind).toBe("failure"); expect(forgedColumn).not.toHaveProperty("items");
      const originalProgress = summary.childProgressById[epicId];
      try {
        summary.childProgressById[epicId] = { completed: 0, total: 999, unfinished: 999, percentage: 0 };
        const mutated = await delivery.checkPublication(column, summary);
        expect(mutated.kind).toBe("failure"); expect(mutated).not.toHaveProperty("items");
      } finally { summary.childProgressById[epicId] = originalProgress; }
      const transport = globalThis.fetch;
      let reached!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { reached = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
      vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
        const next = new Request(input, init), response = await transport(next);
        if (new URL(next.url).pathname.endsWith("/rpc/planning_board_publication_context")) {
          expect(response.status).toBe(200); reached(); await gate;
        }
        return response;
      });
      const publishing = delivery.checkPublication(column, summary);
      try {
        await Promise.race([entered, publishing.then(() => { throw new Error("Joint publication did not reach its held live check"); })]);
        const competing = await delivery.checkPublication(column, summary);
        expect(competing.kind).toBe("failure"); expect(competing).not.toHaveProperty("items");
        release();
        const published = await publishing;
        expect(published).toMatchObject({ kind: "column", cardIds: [epicId] });
      } finally { release(); await publishing; vi.stubGlobal("fetch", transport); }
      const duplicate = await delivery.checkPublication(column, summary);
      expect(duplicate.kind).toBe("failure"); expect(duplicate).not.toHaveProperty("items");
      const obsoleteSummary = await delivery.checkPublication(summary);
      expect(obsoleteSummary.kind).toBe("failure"); expect(obsoleteSummary).not.toHaveProperty("childProgressById");
      expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context"))).toHaveLength(before + 1);
    } finally { controller.abort(); delivery.abort(); }
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  }, "linking");
}, 120_000);

test("ready Epic SSR rejects role, source and original-deadline loss before atomic publication", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, actors, request }) => {
    const epicId = `${prefix}-fenced-native-summary`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,status,owner)
      values($1,'findmydoc-founder-execution',$1,'epic','Offen',$2)`, [epicId, actors.founder.profileId]);
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const { preparePlanningServerBoardColumns } = await importTestModule("src/features/planning/server/planning-server-board-columns.tsx", { "server-only": {} });
    for (const boundary of ["role", "source", "deadline"] as const) {
      const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: request("founder", "/api/planning-board-data") }, action: "planning.board.read" });
      expect(permission.ok).toBe(true);
      if (!permission.ok || !permission.readAuthority) throw new Error("Synthetic original Epic authority unavailable");
      const controller = new AbortController();
      const result = await permission.planning.startBoardQuery({ view: "board", level: "epic", filters: { query: epicId } }, { signal: controller.signal });
      expect(result.status).toBe("ready");
      if (result.status !== "ready" || !result.delivery) throw new Error("Synthetic prepared Epic unavailable");
      let restoreClock: (() => void) | undefined;
      try {
        const [column, summary] = await Promise.all([result.delivery.columns.Offen!, result.delivery.summaries!]);
        expect(column.kind).toBe("column"); expect(summary.kind).toBe("summaries");
        if (boundary === "role") await db.query("update public.profiles set platform_role='viewer' where id=$1", [actors.founder.profileId]);
        if (boundary === "source") await db.query("update public.tasks set description='Changed after native preparation' where id=$1", [epicId]);
        if (boundary === "deadline") { const clock = vi.spyOn(Date, "now").mockReturnValue(permission.readAuthority.deadline); restoreClock = () => { clock.mockRestore(); }; }
        const prepared = await preparePlanningServerBoardColumns(result);
        expect(prepared.status, boundary).toBe("unavailable");
        for (const field of ["model", "delivery"]) expect(prepared, boundary).not.toHaveProperty(field);
      } finally {
        restoreClock?.(); controller.abort(); result.delivery.abort();
        if (boundary === "role") await db.query("update public.profiles set platform_role='founder' where id=$1", [actors.founder.profileId]);
      }
      expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
    }
  }, "linking");
}, 120_000);
