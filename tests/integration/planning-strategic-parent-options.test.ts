import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("Initiative parent discovery includes every authorized Epic beyond card and provider limits without hydrating the options", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, actors, local, request, observed }) => {
    const key = `${prefix}-parent-options`, selectedParent = `${key}-1026`, initiative = `${key}-needle`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,sort_order)
      select $1||'-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Synthetic Epic '||n,
        'epic',case when n=1026 then 'Erledigt' else 'Offen' end,'P2',n from generate_series(0,1026) n`, [key]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority)
      values($1,'findmydoc-founder-execution',$1,'initiative',$2,'Offen','P2')`, [initiative, selectedParent]);
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: actors.founder.profileId, query: { view: "complete" } });
    if (complete.status !== "ready") throw new Error("Complete parent-choice reference unavailable");
    const expected = Array.from({ length: 1027 }, (_, index) => `${key}-${String(index).padStart(4, "0")}`);
    expect(complete.model.items.filter((item: { taskType: string; id: string }) => item.taskType === "epic" && item.id.startsWith(key)).map((item: { id: string }) => item.id)).toEqual(expected);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const query = { view: "board", level: "initiative", column: "Offen", filters: { query: initiative } };
    const before = observed.length;
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(response.status).toBe(200);
    const { model } = await response.json();
    expect(model.board.cardIds).toEqual([initiative]);
    const optionIds = model.board.epicOptions?.map((option: { id: string }) => option.id)
      || model.items.filter((item: { taskType: string }) => item.taskType === "epic").map((item: { id: string }) => item.id);
    expect(optionIds).toContain(expected[0]);
    expect(model.board.epicOptions.filter((option: { id: string }) => option.id.startsWith(key)).map((option: { id: string }) => option.id)).toEqual(expected);
    expect(model.board.epicOptions.every((option: object) => Object.keys(option).sort().join(",") === "id,title")).toBe(true);
    expect(model.items.filter((item: { taskType: string }) => item.taskType === "epic").map((item: { id: string }) => item.id)).toEqual([selectedParent]);
    expect(observed.slice(before).some(entry => /\/(active_tasks|tasks)$/.test(entry.path))).toBe(false);
    const denied = await GET(request("unmapped", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(denied.status).toBe(403);
    expect(await denied.json()).not.toHaveProperty("model");
  });
}, 120_000);
