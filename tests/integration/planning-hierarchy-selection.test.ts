import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("the Initiative Board selects its complete parent scope before provider limits without reading every Item", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, actors, local, request, observed }) => {
    const epic = `${prefix}-old-epic`, otherEpic = `${prefix}-other-epic`, key = `${prefix}-initiative`;
    for (const id of [epic, otherEpic]) await db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority)
      values($1,'findmydoc-founder-execution','Synthetic completed Epic','epic','Erledigt','P2')`, [id]);
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      await db.query("update public.tasks set updated_at='2020-01-01T00:00:00Z' where id=$1", [epic]);
      await db.query("commit");
    } catch (error) { await db.query("rollback"); throw error; }
    await db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,approval_status,status,priority,sort_order)
      select $1||'-'||lpad(n::text,4,'0'),'findmydoc-founder-execution',
        case when n>1000 then 'Synthetic 100%_ready\\[x]' else 'Synthetic unrelated Initiative' end,
        repeat('Synthetic long brief ',100),'initiative',$2,'draft','Offen',
        case when n=1002 then 'P0' else 'P4' end,case when n=1002 then 10 else 20 end
      from generate_series(1,1002) n`, [key, epic]);
    const first = `${key}-1002`, second = `${key}-1001`, outside = `${key}-outside`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority)
      values($1,'findmydoc-founder-execution','Synthetic 100%_ready\\[x]','initiative',$2,'Offen','P0')`, [outside, otherEpic]);
    for (const [id, status] of [[`${key}-child-open`, "Offen"], [`${key}-child-done`, "Erledigt"]]) {
      await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority)
        values($1,'findmydoc-founder-execution','Synthetic direct child','deliverable',$2,'approved',$3,'P2')`, [id, first, status]);
    }
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority)
      values($1,'findmydoc-founder-execution','Synthetic grandchild','sub_issue',$2,'Offen','P2')`, [`${key}-grandchild`, `${key}-child-open`]);
    const query = { view: "board" as const, level: "initiative" as const, parentId: epic, column: "Offen" as const,
      filters: { query: "100%_ready\\[x]", priority: "Alle", quick: ["open"] } };
    const context = { authorized: true, actorProfileId: actors.founder.profileId, query };
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const { projectPlanningBoard } = await importTestModule("src/features/planning/server/planning-board-projection.ts", { "server-only": {} });
    const referenceClient = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(referenceClient, { ...context, query: { view: "complete" } });
    expect(complete.status).toBe("ready");
    if (complete.status !== "ready") throw new Error("Complete Initiative reference unavailable");
    const reference = projectPlanningBoard(complete.model, context);
    expect(reference.status).toBe("ready");
    if (reference.status !== "ready") throw new Error("Complete Initiative projection unavailable");
    const expected = [first, second], progress = { completed: 1, total: 2, unfinished: 1, percentage: 50 };
    expect(reference.model.board!.cardIds).toEqual(expected);
    expect(reference.model.board!.metrics).toEqual({ total: 2, open: 2, done: 0, blocked: 0 });
    expect(reference.model.board!.childProgressById[first]).toEqual(progress);
    expect(reference.model.board!.attentionById![first]).toEqual([]);

    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const before = observed.length;
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(response.status).toBe(200);
    const { model } = await response.json();
    expect(model.board.cardIds).toEqual(expected);
    expect(model.board.metrics).toEqual(reference.model.board!.metrics);
    expect(model.board.columns.Offen).toMatchObject({ total: 2, loaded: 2, completeness: "complete" });
    expect(model.board.childProgressById[first]).toEqual(progress);
    expect(model.board.attentionById[first]).toEqual([]);
    expect(model.items.find((item: { id: string }) => item.id === epic)).toMatchObject({ taskType: "epic", status: "Erledigt" });
    expect(model.items.some((item: { id: string }) => item.id === outside || item.id.includes("-child-") || item.id.endsWith("-grandchild"))).toBe(false);
    expect(model.coverage.items).toBe("partial");
    expect(observed.slice(before).some(entry => /\/(active_tasks|tasks)$/.test(entry.path))).toBe(false);
    const denied = await GET(request("unmapped", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(denied.status).toBe(403);
    expect(await denied.json()).not.toHaveProperty("model");
  });
}, 120_000);
