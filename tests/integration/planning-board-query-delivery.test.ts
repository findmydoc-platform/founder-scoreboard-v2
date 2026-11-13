import { expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { normalizePlanningBoardQuery } from "@/features/planning/model/planning-board-query";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { importTestModule } from "../helpers/vitest-module.mjs";

async function* frames(response: Response) {
  const reader = response.body!.getReader(), decoder = new TextDecoder();
  let buffered = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffered += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffered.indexOf("\n")) >= 0) {
        const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
        if (line) yield JSON.parse(line);
      }
      if (done) { expect(buffered.trim()).toBe(""); return; }
    }
  } finally { await reader.cancel().catch(() => undefined); }
}

test("one real query plan selects bounded identities and complete discovery without hydrating card content", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, rpc }) => {
    const key = `${prefix}-query-plan`, offPage = `${prefix}-off-query`;
    for (let index = 0; index < 21; index++) await db.query("insert into public.tasks(id,project_id,title,description,task_type,status,priority,approval_status,parent_task_id,owner,sort_order) values($1,'findmydoc-founder-execution',$2,'Synthetic private card brief','deliverable','Erledigt','P2','approved',$3,$4,$5)", [`${key}-${String(index).padStart(2, "0")}`, key, initiativeId, actors.founder.profileId, index]);
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,workstream) values($1,'findmydoc-founder-execution','Outside the current query','deliverable','Offen','P2','approved',$2,$3,'Independent off-query option')", [offPage, initiativeId, actors.founder.profileId]);
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      await db.query("update public.tasks set updated_at='2020-01-01T00:00:00Z' where id like $1", [`${key}-%`]);
      await db.query("commit");
    } catch (error) { await db.query("rollback"); throw error; }
    const query = normalizePlanningBoardQuery({ view: "board", filters: { query: key } });
    const result = await rpc("planning_deliverable_query_plan", { p_actor_profile_id: actors.founder.profileId, p_query: query });
    expect(result.status).toBe(200);
    const plan = await result.json();
    expect(plan.status).toBe("ready");
    expect(plan.columns.Erledigt).toEqual({ total: 21, ids: Array.from({ length: 20 }, (_, index) => `${key}-${String(index).padStart(2, "0")}`) });
    for (const status of ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Pausiert"]) expect(plan.columns[status]).toEqual({ total: 0, ids: [] });
    expect(plan).not.toHaveProperty("rows"); expect(plan).not.toHaveProperty("relationships");
    expect(JSON.stringify(plan)).not.toContain("Synthetic private card brief");
    expect(plan.workstreams).toContain("Independent off-query option");
    expect(plan.initiative_options.map((value: { id: string }) => value.id)).toContain(initiativeId);
    expect(plan.profiles.map((value: { id: string }) => value.id)).toContain(actors.founder.profileId);
    const selected = await rpc("planning_deliverable_column", { p_actor_profile_id: actors.founder.profileId, p_selected_ids: plan.columns.Erledigt.ids, p_source_revision: plan.source_revision, p_evaluated_at: plan.evaluated_at, p_valid_until: plan.valid_until });
    expect(selected.status).toBe(200);
    const column = await selected.json();
    expect(column.status).toBe("ready"); expect(column.card_ids).toEqual(plan.columns.Erledigt.ids);
    expect(column.rows).toHaveLength(22);
    expect(column.rows.every((row: object) => !("description" in row) && !("creation_request_payload" in row))).toBe(true);
    expect(column.rows.some((row: { id: string }) => row.id === offPage || row.id === `${key}-20`)).toBe(false);
    for (const name of ["planning_deliverable_query_plan", "planning_deliverable_column"]) {
      const body = name.endsWith("query_plan") ? { p_actor_profile_id: actors.founder.profileId, p_query: query } : { p_actor_profile_id: actors.founder.profileId, p_selected_ids: [], p_source_revision: plan.source_revision, p_evaluated_at: plan.evaluated_at, p_valid_until: null };
      expect((await rpc(name, body, "founder")).status).toBe(403);
      expect((await rpc(name, body, "anonymous")).status).toBe(401);
    }
    const missing = await rpc("planning_deliverable_query_plan", { p_actor_profile_id: "synthetic-unmapped", p_query: query });
    expect((await missing.json()).status).toBe("forbidden");
  });
}, 120_000);

test.each(["source", "authority", "column-failure"] as const)("a real query streams a later ready column before a held first column and handles %s after hydration", async change => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, observed, request }) => {
    const key = `${prefix}-stream`, open = `${key}-open`, review = `${key}-review`;
    for (const [id, status] of [[open, "Offen"], [review, "Review"]]) await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner) values($1,'findmydoc-founder-execution',$2,'deliverable',$3,'P2','approved',$4,$5)", [id, key, status, initiativeId, actors.founder.profileId]);
    const expectedQuery = normalizePlanningBoardQuery({ view: "board", filters: { query: key } });
    const safeColumns = (columns: Record<string, { total: number; ids?: string[] }>) => Object.fromEntries(Object.entries(columns).map(([status, value]) => [status, { total: value.total, selectedIds: value.ids?.length ?? null }]));
    const directPlan = (await db.query("select public.planning_deliverable_query_plan($1,$2) as plan", [actors.founder.profileId, expectedQuery])).rows[0].plan;
    const planFacts: Array<{ actorBinding: boolean; queryBinding: boolean; status: string; columns: ReturnType<typeof safeColumns> }> = [];
    const transport = globalThis.fetch;
    const selectedIds: string[][] = [];
    let release!: () => void, hydrationCompleted!: () => void, held = false;
    const earlierHydrated = new Promise<void>(resolve => { hydrationCompleted = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init), url = new URL(next.url);
      const isColumn = url.pathname.endsWith("/rpc/planning_deliverable_column");
      const isPlan = url.pathname.endsWith("/rpc/planning_deliverable_query_plan");
      const body = isColumn || isPlan ? await next.clone().json() : null;
      const response = await transport(next);
      if (isPlan) {
        const plan = await response.clone().json();
        planFacts.push({ actorBinding: body.p_actor_profile_id === actors.founder.profileId, queryBinding: JSON.stringify(body.p_query) === JSON.stringify(expectedQuery), status: plan.status, columns: safeColumns(plan.columns || {}) });
      }
      if (isColumn) {
        selectedIds.push(body.p_selected_ids);
        if (body.p_selected_ids.includes(open)) {
          held = true; hydrationCompleted();
          await gate;
          if (change === "column-failure") return Response.json({ code: "XX000", message: "Synthetic column unavailable" }, { status: 503 });
        } else if (body.p_selected_ids.includes(review)) {
          // The later response is observable only after the earlier real SQL
          // hydration has completed. The mutation then targets publication.
          await earlierHydrated;
        }
      }
      return response;
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", filters: { query: key } }, abort = new AbortController();
    const input = new NextRequest(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`), { signal: abort.signal });
    input.headers.set("accept", "application/x-ndjson");
    try {
      const response = await GET(input);
      expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain("application/x-ndjson");
      const received: Array<{ kind: string; column?: string; status?: number }> = [];
      for await (const frame of frames(response)) {
        received.push(frame);
        if (frame.kind === "basis") {
          expect(frame.model.items).toEqual([]);
          const diagnostic = JSON.stringify({ direct: { status: directPlan.status, columns: safeColumns(directPlan.columns) }, dispatched: planFacts,
            basis: { queryBinding: JSON.stringify(frame.model.query) === JSON.stringify(expectedQuery), columns: safeColumns(frame.model.board.columns) } });
          if (frame.model.board.columns.Offen.total !== 1 || frame.model.board.columns.Offen.availability !== "not-loaded") throw new Error(`Safe query-basis mismatch: ${diagnostic}`);
          expect(frame.model.board.columns.Offen).toMatchObject({ total: 1, availability: "not-loaded" });
          expect(frame.model.board.columns.Review).toMatchObject({ total: 1, availability: "not-loaded" });
          expect(frame.model.board.columns["In Arbeit"]).toMatchObject({ total: 0, availability: "ready", completeness: "complete" });
          expect(frame.readAuthority.userId).toBe(actors.founder.userId);
        }
        if (frame.kind === "column" && frame.column === "Review") {
          expect(held).toBe(true);
          expect(received.some(value => value.kind === "column" && value.column === "Offen")).toBe(false);
          expect(frame.cardIds).toEqual([review]); expect(frame.items.some((item: { id: string }) => item.id === review)).toBe(true);
          expect(frame).not.toHaveProperty("people"); expect(frame).not.toHaveProperty("sprints");
          if (change === "source") await db.query("update public.tasks set sort_order=42 where id=$1", [open]);
          if (change === "authority") await db.query("delete from auth.sessions where id=$1", [actors.founder.sessionId]);
          release();
        }
      }
      expect(received.filter(frame => frame.kind === "basis")).toHaveLength(1);
      expect(received.some(frame => frame.kind === "column" && frame.column === "Offen")).toBe(false);
      const failed = received.find(frame => frame.kind === "failure" && (frame.column === "Offen" || change === "authority"));
      expect(failed).toMatchObject({ status: change === "source" ? 409 : change === "authority" ? 403 : 503 });
      expect(received.at(-1)?.kind).toBe("end");
      expect(selectedIds).toHaveLength(2);
      expect(new Set(selectedIds.flat())).toEqual(new Set([open, review]));
      expect(observed.filter(value => value.path.endsWith("/planning_deliverable_query_plan"))).toHaveLength(1);
      expect(observed.filter(value => value.path.endsWith("/workspace_access_contexts"))).toHaveLength(1);
      expect(observed.some(value => value.path.endsWith("/planning_deliverable_selection"))).toBe(false);
      if (change === "column-failure") {
        const retry = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({ ...scope, column: "Offen" }))}`));
        expect(retry.status).toBe(200); expect((await retry.json()).model.board.cardIds).toEqual([open]);
      }
    } finally { release(); abort.abort(); }
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  });
}, 120_000);
