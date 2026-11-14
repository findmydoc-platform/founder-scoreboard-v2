import { createClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";
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

test("streamed cards survive one failed summary batch and its retry reads only the missing aggregates", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const key = `${prefix}-independent-summary`, open = `${key}-open`, working = `${key}-working`;
    for (const [id, status] of [[open, "Offen"], [working, "In Arbeit"]]) await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$2,'deliverable',$3,'approved',$4,'P2',$5)`, [id, key, initiativeId, status, actors.founder.profileId]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner)
      values($1,'findmydoc-founder-execution','Synthetic off-page child','sub_issue',$2,'Erledigt','P2',$3)`, [`${key}-child`, open, actors.other.profileId]);
    const transport = globalThis.fetch, batches: string[][] = [];
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init);
      if (!new URL(next.url).pathname.endsWith("/rpc/planning_deliverable_summaries")) return transport(next);
      const body = await next.clone().json();
      batches.push(body.p_selected_ids);
      const response = await transport(next);
      if (batches.length === 1) {
        await gate;
        return Response.json({ message: "Synthetic summary unavailable" }, { status: 503 });
      }
      return response;
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", filters: { query: key } };
    const input = request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`);
    input.headers.set("accept", "application/x-ndjson");
    let response: Response | undefined;
    try {
      response = await GET(input);
      if (!response) throw new Error("Synthetic streamed response missing");
      expect(response.status).toBe(200);
      const reader = response.body!.getReader(), decoder = new TextDecoder();
      let buffered = "", token = "";
      const cards: string[] = [], failures: Array<{ area?: string; status: number }> = [];
      for (;;) {
        const { done, value } = await reader.read();
        buffered += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          if (!line) continue;
          const frame = JSON.parse(line);
          if (frame.kind === "basis") token = frame.model.board.summaryRequests?.[0]?.token || "";
          if (frame.kind === "column") {
            cards.push(...frame.cardIds);
            if (cards.length === 2) {
              expect(batches).toEqual([[open, working]]);
              expect(failures).toEqual([]);
              release();
            }
          }
          if (frame.kind === "failure") failures.push(frame);
        }
        if (done) break;
      }
      expect(cards.sort()).toEqual([open, working].sort());
      expect(token).not.toBe("");
      expect(failures).toEqual([expect.objectContaining({ area: "summaries", status: 503 })]);
      const previous = observed.length;
      const retry = await GET(request("founder", `/api/planning-board-data?summaries=${encodeURIComponent(token)}`));
      expect(retry.status).toBe(200);
      const result = await retry.json();
      expect(result.summaries.childProgressById).toEqual({
        [open]: { completed: 1, total: 1, unfinished: 0, percentage: 100 },
        [working]: { completed: 0, total: 0, unfinished: 0, percentage: 0 },
      });
      expect(batches).toEqual([[open, working], [open, working]]);
      expect(observed.slice(previous).some(entry => /\/(planning_deliverable_query_plan|planning_deliverable_selection|planning_deliverable_column|workspace_access_contexts|active_tasks)$/.test(entry.path))).toBe(false);
    } finally {
      release();
      await response?.body?.cancel().catch(() => undefined);
    }
  });
}, 120_000);
