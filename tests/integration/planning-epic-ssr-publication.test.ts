import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("Epic initial publication accepts only its issued summary and consumes the atomic admission once", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, actors, request, observed }) => {
    const epicId = `${prefix}-native-summary`, childId = `${prefix}-native-child`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,status,owner)
      values($1,'findmydoc-founder-execution',$1,'epic','Offen',$2)`, [epicId, actors.founder.profileId]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,owner)
      values($1,'findmydoc-founder-execution',$1,'initiative',$2,'proposed','Offen',$3)`, [childId, epicId, actors.founder.profileId]);
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

      const published = await delivery.checkPublication(column, summary);
      expect(published).toMatchObject({ kind: "column", cardIds: [epicId] });
      const duplicate = await delivery.checkPublication(column, summary);
      expect(duplicate.kind).toBe("failure"); expect(duplicate).not.toHaveProperty("items");
      const obsoleteSummary = await delivery.checkPublication(summary);
      expect(obsoleteSummary.kind).toBe("failure"); expect(obsoleteSummary).not.toHaveProperty("childProgressById");
      expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context"))).toHaveLength(before + 1);
    } finally { controller.abort(); delivery.abort(); }
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  }, "linking");
}, 120_000);
