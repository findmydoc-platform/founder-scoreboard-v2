import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("Epic selection preserves completed ties and complete off-page hierarchy signals without a full Item read", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, actors, local, request, observed }) => {
    const key = `${prefix}-epic-selection`, first = `${key}-1001`, second = `${key}-1002`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,approval_status,status,priority,sort_order)
      select $1||'-'||lpad(n::text,4,'0'),'findmydoc-founder-execution',
        case when n>1000 then 'Synthetic Epic %_needle' else 'Synthetic unrelated Epic' end,
        'epic','draft',case when n>1000 then 'Erledigt' else 'Offen' end,
        case when n=1002 then 'P0' else 'P4' end,0
      from generate_series(1,1002) n`, [key]);
    const open = `${key}-open-child`, done = `${key}-done-child`, endpoint = `${key}-off-page-endpoint`;
    for (const [id, status] of [[open, "Offen"], [done, "Erledigt"]]) await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority)
      values($1,'findmydoc-founder-execution','Synthetic direct Initiative','initiative',$2,$3,'P2')`, [id, first, status]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority)
      values($1,'findmydoc-founder-execution','Synthetic off-page Deliverable','deliverable',$2,'approved','Offen','P2')`, [endpoint, open]);
    await db.query("insert into public.task_relationship_edges(task_id,related_task_id,relation_type) values($1,$2,'blocked_by')", [first, endpoint]);
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      await db.query("update public.tasks set updated_at='2020-01-01T00:00:00Z' where id=any($1)", [[first, second]]);
      await db.query("commit");
    } catch (error) { await db.query("rollback"); throw error; }
    const query = { view: "board" as const, level: "epic" as const, column: "Erledigt" as const,
      filters: { query: "Epic %_needle", status: "Erledigt" } };
    const context = { authorized: true, actorProfileId: actors.founder.profileId, query };
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const { projectPlanningBoard } = await importTestModule("src/features/planning/server/planning-board-projection.ts", { "server-only": {} });
    const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(client, { ...context, query: { view: "complete" } });
    if (complete.status !== "ready") throw new Error("Complete Epic reference unavailable");
    const reference = projectPlanningBoard(complete.model, context);
    if (reference.status !== "ready") throw new Error("Complete Epic projection unavailable");
    const expected = [first, second], progress = { completed: 1, total: 2, unfinished: 1, percentage: 50 };
    expect(reference.model.board!.cardIds).toEqual(expected);
    expect(reference.model.board!.metrics).toEqual({ total: 2, open: 0, done: 2, blocked: 1 });
    expect(reference.model.board!.childProgressById[first]).toEqual(progress);
    expect(reference.model.board!.attentionById![first]!.map((signal: { id: string }) => signal.id)).toEqual(["waiting"]);
    expect(reference.model.board!.attentionById![second]).toEqual([]);

    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const before = observed.length;
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(response.status).toBe(200);
    const { model } = await response.json();
    expect(model.board.cardIds).toEqual(expected);
    expect(model.board.metrics).toEqual(reference.model.board!.metrics);
    expect(model.board.childProgressById[first]).toEqual(progress);
    expect(model.board.attentionById[first]).toEqual(reference.model.board!.attentionById![first]);
    expect(model.board.attentionById[second]).toEqual([]);
    expect(model.items.find((item: { id: string }) => item.id === endpoint)).toMatchObject({ taskType: "deliverable" });
    expect(model.board.cardIds).not.toContain(endpoint);
    expect(model.coverage.items).toBe("partial");
    const denied = await GET(request("unmapped", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(denied.status).toBe(403);
    expect(await denied.json()).not.toHaveProperty("model");
    expect(observed.slice(before).some(entry => /\/(active_tasks|tasks)$/.test(entry.path))).toBe(false);
  });
}, 120_000);
