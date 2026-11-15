import { createClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { taskPlanningAttentionSignals } from "@/features/tasks/model/task-attention-signals";
import { hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";

test("table rows precede their independent complete directed risk summary", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, local, request, observed }) => {
    const key = `${prefix}-table-risks`, rowId = `${key}-row`, endpoints = ["wait-out", "wait-in", "blocked", "related"].map(value => `${key}-${value}`);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,assignee,acceptance_criteria,definition_of_done)
      values($1,'findmydoc-founder-execution',$2,'deliverable',$3,'approved','Offen','P1',$4,'Synthetic AC','Synthetic DoD')`, [rowId, key, initiativeId, actors.founder.profileId]);
    for (const id of endpoints) await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority)
      values($1,'findmydoc-founder-execution','Synthetic off-page dependency','deliverable',$2,'approved','Offen','P2')`, [id, initiativeId]);
    await db.query(`insert into public.task_relationship_edges(task_id,related_task_id,relation_type)
      values($1,$2,'blocked_by'),($3,$1,'blocks'),($1,$4,'blocks'),($1,$5,'relates_to')`, [rowId, ...endpoints]);
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: actors.founder.profileId, query: { view: "complete" } });
    if (complete.status !== "ready") throw new Error("Complete table risk reference unavailable");
    const data = planningWorkspaceModelToPlanningShellState(complete.model), task = data.tasks.find(item => item.id === rowId)!;
    const groups = taskRelationsFor(rowId, data.taskRelations);
    const expected = { attention: taskPlanningAttentionSignals(task, data), waitsOn: groups.waitsOn.length, blocks: groups.blocks.length, hasOpenWait: hasOpenWaitingRelation(rowId, data.tasks, data.taskRelations) };
    expect(expected).toEqual({ attention: [{ id: "waiting", label: "Wartet", kind: "critical" }], waitsOn: 2, blocks: 1, hasOpenWait: true });

    const transport = globalThis.fetch;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), held = new Promise<void>(resolve => { entered = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init);
      if (/\/rpc\/(planning_deliverable_summaries|planning_table_risks)$/.test(new URL(next.url).pathname)) { entered(); await gate; }
      return transport(next);
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const before = observed.length;
    const initial = GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({ view: "table", filters: { query: key } }))}`));
    try {
      const first = await Promise.race([initial.then(response => ({ kind: "rows" as const, response })), held.then(() => ({ kind: "aggregate" as const }))]);
      expect(first.kind).toBe("rows");
      if (first.kind !== "rows") throw new Error("Table content waited for its independent risk read");
      expect(first.response.status).toBe(200);
      const { model } = await first.response.json();
      expect(model.table.rowIds).toEqual([rowId]);
      expect(model.table.page).toMatchObject({ total: 1, loaded: 1, completeness: "complete", continuation: null });
      expect(model.table.risksById).toEqual({ [rowId]: null });
      expect(model.table.summaryRequests).toHaveLength(1);
      const summary = model.table.summaryRequests[0];
      expect(summary).toMatchObject({ cardIds: [rowId], status: "loading" });
      const pending = GET(request("founder", `/api/planning-board-data?summaries=${encodeURIComponent(summary.token)}`));
      await held;
      release();
      const response = await pending;
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.summaries).toMatchObject({ kind: "table-risks", token: summary.token, cardIds: [rowId], scopeRevision: model.scopeRevision,
        queryRevision: model.table.revision, observedAt: model.table.observedAt, validUntil: model.table.validUntil, risksById: { [rowId]: expected } });
      expect(body.summaries).not.toHaveProperty("childProgressById");
      expect(body.summaries).not.toHaveProperty("items");
      expect(observed.slice(before).some(entry => /\/(active_tasks|tasks)$/.test(entry.path))).toBe(false);
      const denied = await GET(request("unmapped", `/api/planning-board-data?summaries=${encodeURIComponent(summary.token)}`));
      expect(denied.status).toBe(403);
      expect(await denied.json()).not.toHaveProperty("summaries");
    } finally { release(); await initial; }
  });
}, 120_000);
