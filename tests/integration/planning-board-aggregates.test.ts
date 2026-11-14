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

test("aggregate-only retry cannot renew the original admission deadline while its JWT is still valid", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parentId = `${prefix}-original-summary-authority`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`, [parentId, initiativeId, actors.founder.profileId]);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const query = { view: "board", column: "Offen", filters: { query: parentId } };
    const first = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(first.status).toBe(200);
    const body = await first.json(), token = body.model.board.summaryRequests[0].token;
    expect(body.model.board.cardIds).toEqual([parentId]);
    expect(body.model.board.childProgressById[parentId]).toEqual({ completed: 0, total: 0, unfinished: 0, percentage: 0 });
    const jwt = JSON.parse(Buffer.from(actors.founder.token.split(".")[1], "base64url").toString("utf8"));
    expect(body.readAuthority.deadline).toBeLessThan(jwt.exp * 1000);
    const summaryReads = observed.filter(entry => entry.path.endsWith("/planning_deliverable_summaries")).length;
    expect(summaryReads).toBe(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(body.readAuthority.deadline);
      expect(Date.now()).toBeLessThan(jwt.exp * 1000);
      const retry = await GET(request("founder", `/api/planning-board-data?summaries=${encodeURIComponent(token)}`));
      expect(retry.status).toBe(403);
      expect(await retry.json()).not.toHaveProperty("summaries");
      expect(observed.filter(entry => entry.path.endsWith("/planning_deliverable_summaries"))).toHaveLength(summaryReads);
    } finally { vi.useRealTimers(); }
  }, "linking");
}, 120_000);

test("filtered summaries preserve complete attention in both waiting directions without transmitting endpoint content", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, local, request }) => {
    const outgoing = `${prefix}-signals-outgoing`, incoming = `${prefix}-signals-incoming`, endpoint = `${prefix}-supporting-endpoint`, sprint = `${prefix}-signal-sprint`;
    await db.query("insert into public.sprints(id,project_id,name,start_date,end_date) values($1,'findmydoc-founder-execution','Synthetic signal Sprint','2030-01-01','2030-01-14')", [sprint]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,acceptance_criteria,definition_of_done,sprint_id,github_issue_sync_status)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P0',$3,$3,$4,'failed')`, [outgoing, initiativeId, "\u00a0 \t", sprint]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,acceptance_criteria,definition_of_done,sprint_id)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Blockiert','P1','Synthetic AC','Synthetic DoD',$3)`, [incoming, initiativeId, sprint]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution','Synthetic supporting endpoint','deliverable',$2,'approved','Offen','P4',$3)`, [endpoint, initiativeId, actors.other.profileId]);
    await db.query("insert into public.task_relationship_edges(task_id,related_task_id,relation_type) values($1,$2,'blocked_by'),($2,$3,'blocks')", [outgoing, endpoint, incoming]);
    await db.query("insert into public.task_blockers(task_id,profile_id,reason) values($1,$2,'Synthetic open blocker')", [incoming, actors.founder.profileId]);
    await db.query("insert into public.task_dependencies(task_id,note) values($1,'Synthetic legacy dependency')", [incoming]);
    // This persisted RAW URL is WHATWG-valid. Storage has no canonical URL
    // invariant, so an anchored https:// expression is not the legacy oracle.
    await db.query("insert into public.task_links(task_id,type,label,url) values($1,'evidence','Synthetic raw evidence','https:example.test/legacy-evidence')", [incoming]);
    const query = { view: "board" as const, filters: { query: `${prefix}-signals`, quick: ["blocked"] } };
    const context = { authorized: true, actorProfileId: actors.founder.profileId, query };
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const { projectPlanningBoard } = await importTestModule("src/features/planning/server/planning-board-projection.ts", { "server-only": {} });
    const referenceClient = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(referenceClient, { ...context, query: { view: "complete" } });
    expect(complete.status).toBe("ready");
    if (complete.status !== "ready") throw new Error("Complete legacy attention reference was unavailable");
    const reference = projectPlanningBoard(complete.model, context);
    expect(reference.status).toBe("ready");
    if (reference.status !== "ready") throw new Error("Complete legacy attention projection was unavailable");
    expect(reference.model.board!.cardIds).toEqual([outgoing, incoming]);
    expect(reference.model.board!.attentionById![outgoing]!.map((signal: { id: string }) => signal.id)).toEqual(["owner-missing", "waiting", "sync-failed", "acceptance-criteria-missing", "definition-of-done-missing", "evidence-missing"]);
    expect(reference.model.board!.attentionById![incoming]!.map((signal: { id: string }) => signal.id)).toEqual(["waiting"]);
    expect(reference.model.board!.metrics.blocked).toBe(2);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const input = request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`);
    input.headers.set("accept", "application/x-ndjson");
    const response = await GET(input);
    expect(response.status).toBe(200);
    const frames = (await response.text()).trim().split("\n").map((line: string) => JSON.parse(line));
    const columns = frames.filter((frame: { kind: string }) => frame.kind === "column");
    expect(columns.flatMap((frame: { cardIds: string[] }) => frame.cardIds).sort()).toEqual([outgoing, incoming].sort());
    // Normal 646 columns intentionally retain scoped endpoint context.
    expect(columns.some((frame: { items: Array<{ id: string }> }) => frame.items.some(item => item.id === endpoint))).toBe(true);
    const summaries = frames.find((frame: { kind: string }) => frame.kind === "summaries");
    expect(summaries.cardIds).toEqual([outgoing, incoming]);
    expect(summaries.attentionById?.[outgoing]?.map((signal: { id: string }) => signal.id)).toEqual(["owner-missing", "waiting", "sync-failed", "acceptance-criteria-missing", "definition-of-done-missing", "evidence-missing"]);
    expect(summaries.attentionById).toEqual(reference.model.board!.attentionById);
    expect(frames[0].model.board.metrics.blocked).toBe(2);
    expect(JSON.stringify(summaries)).not.toContain(endpoint);
    expect(JSON.stringify(summaries)).not.toContain("Synthetic supporting endpoint");
    expect(JSON.stringify(summaries)).not.toContain("https:example.test/legacy-evidence");
  });
}, 120_000);

test("direct-child percentages preserve legacy division order and JavaScript positive-half rounding in SQL and API", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, local, request }) => {
    const fractional = `${prefix}-rounding-fraction`, half = `${prefix}-rounding-half`;
    for (const [id, completed, total] of [[fractional, 29, 200], [half, 1, 8]] as const) {
      await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
        values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`, [id, initiativeId, actors.founder.profileId]);
      await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner)
        select $1||'-child-'||n,'findmydoc-founder-execution','Synthetic rounding child','sub_issue',$1,
          case when n<=$2 then 'Erledigt' else 'Offen' end,'P2',$3 from generate_series(1,$4::integer) n`, [id, completed, actors.other.profileId, total]);
    }
    const expected = {
      [fractional]: { completed: 29, total: 200, unfinished: 171, percentage: 14 },
      [half]: { completed: 1, total: 8, unfinished: 7, percentage: 13 },
    };
    const query = { view: "board" as const, column: "Offen" as const, filters: { query: `${prefix}-rounding` } };
    const context = { authorized: true, actorProfileId: actors.founder.profileId, query };
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const { projectPlanningBoard } = await importTestModule("src/features/planning/server/planning-board-projection.ts", { "server-only": {} });
    const referenceClient = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(referenceClient, { ...context, query: { view: "complete" } });
    expect(complete.status).toBe("ready");
    if (complete.status !== "ready") throw new Error("Complete legacy rounding reference was unavailable");
    const reference = projectPlanningBoard(complete.model, context);
    expect(reference.status).toBe("ready");
    if (reference.status !== "ready") throw new Error("Complete legacy rounding projection was unavailable");
    expect(reference.model.board!.childProgressById).toEqual(expected);
    const sql = (await db.query("select public.planning_deliverable_summaries($1,$2,public.planning_source_version(),statement_timestamp(),null) as summary", [actors.founder.profileId, [fractional, half]])).rows[0].summary;
    expect(sql.status).toBe("ready");
    expect(sql.child_progress[half].percentage).toBe(13);
    expect(sql.child_progress[fractional].percentage).toBe(14);
    expect(sql.child_progress).toEqual(expected);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.model.board.childProgressById).toEqual(expected);
  });
}, 120_000);

test.each(["fresh-admission", "dispatched-summary"] as const)("original summary authority survives a held %s boundary", async boundary => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parentId = `${prefix}-held-original-authority`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`, [parentId, initiativeId, actors.founder.profileId]);
    const initial = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const query = { view: "board", column: "Offen", filters: { query: parentId } };
    const first = await initial.GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(first.status).toBe(200);
    const body = await first.json(), token = body.model.board.summaryRequests[0].token;
    const jwt = JSON.parse(Buffer.from(actors.founder.token.split(".")[1], "base64url").toString("utf8"));
    expect(body.readAuthority.deadline).toBeLessThan(jwt.exp * 1000);
    const baseline = observed.filter(entry => entry.path.endsWith("/planning_deliverable_summaries")).length;
    expect(baseline).toBe(1);
    const transport = globalThis.fetch;
    let release!: () => void, held = false, membershipReads = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init), url = new URL(next.url);
      const response = await transport(next);
      const membership = url.hostname === "admin.googleapis.com";
      if (membership) membershipReads++;
      if (!held && (boundary === "fresh-admission" && membership
        || boundary === "dispatched-summary" && url.pathname.endsWith("/rpc/planning_deliverable_summaries"))) {
        expect(response.status).toBe(200);
        held = true; await gate;
      }
      return response;
    });
    let pending: Promise<Response> | undefined;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(body.readAuthority.deadline - 1000);
      // A cold server admission has fresh membership evidence. Its longer new
      // ceiling must not replace the signed original query's earlier ceiling.
      vi.resetModules();
      const retry = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
      pending = retry.GET(request("founder", `/api/planning-board-data?summaries=${encodeURIComponent(token)}`));
      await expect.poll(() => held, { timeout: 5000 }).toBe(true);
      expect(Date.now()).toBeLessThan(body.readAuthority.deadline);
      expect(membershipReads).toBe(1);
      const expectedDispatches = baseline + (boundary === "dispatched-summary" ? 1 : 0);
      expect(observed.filter(entry => entry.path.endsWith("/planning_deliverable_summaries"))).toHaveLength(expectedDispatches);
      vi.setSystemTime(body.readAuthority.deadline);
      expect(Date.now()).toBeLessThan(jwt.exp * 1000);
      release();
      const response = await pending!;
      expect(response.status).toBe(403);
      const denied = await response.json();
      expect(denied).not.toHaveProperty("summaries");
      expect(denied).not.toHaveProperty("readAuthority");
      expect(observed.filter(entry => entry.path.endsWith("/planning_deliverable_summaries"))).toHaveLength(expectedDispatches);
      expect((await db.query("select count(*)::int as count from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].count).toBe(0);
    } finally { release(); await pending?.catch(() => undefined); vi.useRealTimers(); }
  }, "linking");
}, 120_000);
