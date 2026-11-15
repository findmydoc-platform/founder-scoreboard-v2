import { createClient } from "@supabase/supabase-js";
import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test.each(["epic", "initiative"] as const)("%s query reveals independently ready strategic columns including Pausiert", async level => {
  await withPlanningCredentialDatabase(async ({ db, prefix, actors, local, request, observed }) => {
    const key = `${prefix}-independent-${level}`, parent = `${key}-parent`;
    if (level === "initiative") await db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority)
      values($1,'findmydoc-founder-execution','Synthetic completed parent','epic','Erledigt','P2')`, [parent]);
    const statuses = ["Offen", "In Arbeit", "Pausiert", "Blockiert", "Erledigt"] as const;
    const ids = statuses.map((status, index) => ({ status, id: `${key}-${index}` }));
    for (const row of ids) await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority)
      values($1,'findmydoc-founder-execution',$2,$3,$4,$5,'P2')`, [row.id, key, level, level === "initiative" ? parent : null, row.status]);
    const query = { view: "board" as const, level, parentId: level === "initiative" ? parent : "all", filters: { query: key } };
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const { projectPlanningBoard } = await importTestModule("src/features/planning/server/planning-board-projection.ts", { "server-only": {} });
    const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: actors.founder.profileId, query: { view: "complete" } });
    if (complete.status !== "ready") throw new Error("Complete strategic column reference unavailable");
    const reference = projectPlanningBoard(complete.model, { authorized: true, actorProfileId: actors.founder.profileId, query });
    if (reference.status !== "ready") throw new Error("Complete strategic column projection unavailable");
    expect([...reference.model.board!.cardIds].sort()).toEqual(ids.map(row => row.id).sort());
    expect(reference.model.board!.metrics).toEqual({ total: 5, open: 4, done: 1, blocked: 1 });
    for (const status of statuses) expect(reference.model.board!.columns[status].total).toBe(1);

    const transport = globalThis.fetch;
    let release!: () => void, held = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init);
      if (new URL(next.url).pathname.endsWith("/rpc/planning_deliverable_column")) {
        const body = await next.clone().json();
        if (body.p_selected_ids.includes(ids[0].id)) { held = true; await gate; }
      }
      return transport(next);
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const input = request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`);
    input.headers.set("accept", "application/x-ndjson");
    const before = observed.length;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await GET(input);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-ndjson");
      reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      const nextFrame = async () => {
        while (!buffered.includes("\n")) {
          const next = await reader!.read();
          if (next.done) throw new Error("Strategic delivery ended before its end frame");
          buffered += decoder.decode(next.value, { stream: true });
        }
        const newline = buffered.indexOf("\n"), line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        return JSON.parse(line);
      };
      const basis = await nextFrame();
      expect(basis.kind).toBe("basis");
      expect(basis.model.board.cardIds).toEqual([]);
      expect(basis.model.board.metrics).toEqual(reference.model.board!.metrics);
      for (const status of statuses) expect(basis.model.board.columns[status]).toMatchObject({ total: 1, loaded: 0, availability: "not-loaded" });
      const cards: string[] = [], summaryIds: string[] = [];
      const accept = (frame: { kind: string; column?: string; cardIds?: string[] }) => {
        expect(frame.kind).not.toBe("failure");
        if (frame.kind === "column") cards.push(...frame.cardIds!);
        if (frame.kind === "summaries") summaryIds.push(...frame.cardIds!);
      };
      while (!cards.includes(ids[1].id)) {
        const frame = await nextFrame();
        expect(frame.kind).not.toBe("end");
        expect(frame.column).not.toBe("Offen");
        accept(frame);
      }
      expect(held).toBe(true);
      expect(cards).not.toContain(ids[0].id);
      release();
      for (;;) { const frame = await nextFrame(); if (frame.kind === "end") break; accept(frame); }
      expect(cards.sort()).toEqual(ids.map(row => row.id).sort());
      expect(summaryIds.sort()).toEqual(ids.map(row => row.id).sort());
      expect(observed.slice(before).some(entry => /\/(active_tasks|tasks)$/.test(entry.path))).toBe(false);
      const invalid = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({ ...query, column: "Review" }))}`));
      expect(invalid.status).toBe(409);
    } finally { release(); await reader?.cancel().catch(() => undefined); }
  });
}, 120_000);

test.each(["epic", "initiative"] as const)("%s SQL pages traverse 47 matching Items per strategic status against complete TypeScript and fixed IDs", async level => {
  await withPlanningCredentialDatabase(async ({ db, prefix, actors, local, request, observed }) => {
    const key = `${prefix}-traversal-${level}`, statuses = ["Offen", "Pausiert", "Erledigt"] as const;
    const parentId = level === "initiative" ? `${prefix}-epic` : "all";
    for (const [statusIndex, status] of statuses.entries()) await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,sort_order,owner)
      select $1||'-'||$2::text||'-'||lpad(n::text,4,'0'),'findmydoc-founder-execution',$1,$3,$4,
        case when $3='initiative' then 'approved' else null end,$5,'P2',0,$6 from generate_series(0,46) n`,
    [key, statusIndex, level, level === "initiative" ? parentId : null, status, actors.founder.profileId]);
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const { projectPlanningBoard } = await importTestModule("src/features/planning/server/planning-board-projection.ts", { "server-only": {} });
    const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: actors.founder.profileId, query: { view: "complete" } });
    if (complete.status !== "ready") throw new Error("Complete strategic traversal reference unavailable");
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const before = observed.length;
    for (const [statusIndex, status] of statuses.entries()) {
      const expected = Array.from({ length: 47 }, (_, index) => `${key}-${statusIndex}-${String(index).padStart(4, "0")}`), actual: string[] = [];
      const scope = { view: "board" as const, level, parentId, column: status, filters: { query: key }, limit: 1000 };
      let continuation: string | undefined, referenceContinuation: string | undefined;
      for (let offset = 0; offset < 47; offset += 20) {
        const literal = expected.slice(offset, offset + 20);
        const reference = projectPlanningBoard(complete.model, { authorized: true, actorProfileId: actors.founder.profileId, query: { ...scope, continuation: referenceContinuation } });
        if (reference.status !== "ready") throw new Error("Complete strategic page reference unavailable");
        expect(reference.model.board!.cardIds).toEqual(literal);
        expect(reference.model.board!.metrics).toEqual({ total: 141, open: 94, done: 47, blocked: 0 });
        referenceContinuation = reference.model.board!.columns[status].continuation || undefined;
        const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({ ...scope, continuation }))}`));
        expect(response.status).toBe(200);
        const { model } = await response.json();
        expect(model.board.cardIds).toEqual(literal);
        expect(model.board.cardIds).toEqual(reference.model.board!.cardIds);
        expect(model.board.metrics).toEqual(reference.model.board!.metrics);
        expect(model.board.columns[status]).toMatchObject({ total: 47, loaded: literal.length, completeness: offset + literal.length === 47 ? "complete" : "partial" });
        expect(model.items.filter((item: { taskType: string }) => item.taskType === level)).toHaveLength(literal.length);
        expect(model.coverage.items).toBe("partial");
        actual.push(...model.board.cardIds);
        continuation = model.board.columns[status].continuation || undefined;
        expect(Boolean(continuation)).toBe(offset + literal.length < 47);
      }
      expect(actual).toEqual(expected);
      expect(new Set(actual).size).toBe(47);
    }
    expect(observed.slice(before).some(entry => /\/(active_tasks|tasks)$/.test(entry.path))).toBe(false);
  });
}, 120_000);
