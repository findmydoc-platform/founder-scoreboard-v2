import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("the selected Board API returns complete direct-child progress without loading the child list", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, local, request }) => {
    const parentId = `${prefix}-aggregate-parent`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,assignee,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3,$3)`,
    [parentId, initiativeId, actors.founder.profileId]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner)
      select $1||'-child-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Synthetic aggregate child','sub_issue',$1,
        case when n=1008 then 'Offen' else 'Erledigt' end,'P2',$2
      from generate_series(1,1008) n`, [parentId, actors.other.profileId]);

    // The complete pre-selection reader is an independent migration reference.
    // The literals also distinguish rounded completion from all children done.
    const query = { view: "board" as const, column: "Offen" as const, filters: { query: parentId } };
    const context = { authorized: true, actorProfileId: actors.founder.profileId, query };
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const { projectPlanningBoard } = await importTestModule("src/features/planning/server/planning-board-projection.ts", { "server-only": {} });
    const referenceClient = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(referenceClient, { ...context, query: { view: "complete" } });
    expect(complete.status).toBe("ready");
    if (complete.status !== "ready") throw new Error("Complete legacy aggregate reference was unavailable");
    const reference = projectPlanningBoard(complete.model, context);
    expect(reference.status).toBe("ready");
    if (reference.status !== "ready") throw new Error("Complete legacy Board aggregate reference was unavailable");
    const expected = { completed: 1007, total: 1008, unfinished: 1, percentage: 100 };
    expect(reference.model.board!.childProgressById[parentId]).toEqual(expected);

    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(response.status).toBe(200);
    const { model } = await response.json();
    expect(model.board.cardIds).toEqual([parentId]);
    expect(model.items.some((item: { parentTaskId: string }) => item.parentTaskId === parentId)).toBe(false);
    expect(model.coverage.items).toBe("partial");
    expect(model.board.childProgressById[parentId]).toEqual(expected);
  });
}, 120_000);
