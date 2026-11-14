import { expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
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

type QueryFixture = Parameters<Parameters<typeof withPlanningCredentialDatabase>[0]>[0];
async function seedQueryCards({ db, prefix, initiativeId, actors }: QueryFixture, suffix: string) {
  const key = `${prefix}-${suffix}`, open = `${key}-open`, review = `${key}-review`;
  for (const [id, status] of [[open, "Offen"], [review, "Review"]]) await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,review_status,review_owner_profile_id,evidence_link,review_requested_at) values($1,'findmydoc-founder-execution',$2,'deliverable',$3,'P2','approved',$4,$5,case when $3='Review' then 'requested' else 'not_requested' end,case when $3='Review' then $6 else null end,case when $3='Review' then 'https://example.test/synthetic-review-evidence' else '' end,case when $3='Review' then now() else null end)", [id, key, status, initiativeId, actors.founder.profileId, actors.ceo.profileId]);
  return { key, open, review };
}

test.each(["ready", "source", "role", "deadline", "request-abort"] as const)("selected SQL hydration overlaps held avatars and preserves the %s boundary", async boundary => {
  await withPlanningCredentialDatabase(async fixture => {
    const { db, actors, request, observed } = fixture;
    const { key, open, review } = await seedQueryCards(fixture, "avatar-overlap");
    const transport = globalThis.fetch, signals: AbortSignal[] = [];
    let avatarEntered!: () => void, releaseAvatar!: () => void, releaseRows!: () => void;
    const avatarStarted = new Promise<void>(resolve => { avatarEntered = resolve; });
    const avatarGate = new Promise<void>(resolve => { releaseAvatar = resolve; });
    const rowsGate = new Promise<void>(resolve => { releaseRows = resolve; });
    let settled = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init), path = new URL(next.url).pathname;
      const column = path.endsWith("/rpc/planning_deliverable_column");
      if (column) signals.push(next.signal);
      const response = await transport(next);
      if (path.endsWith("/rpc/workspace_access_contexts")) {
        avatarEntered(); await avatarGate;
      } else if (column) {
        // Keep the actual SQL response private until the common basis finishes.
        // Cancellation releases only this response gate, not database work.
        await new Promise<void>(resolve => {
          const stop = () => { next.signal.removeEventListener("abort", stop); resolve(); };
          if (next.signal.aborted) stop(); else next.signal.addEventListener("abort", stop, { once: true });
          void rowsGate.then(stop);
        });
      }
      return response;
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const abort = new AbortController(), scope = { view: "board", filters: { query: key } };
    const input = new NextRequest(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`), { signal: abort.signal });
    input.headers.set("accept", "application/x-ndjson");
    const pending = GET(input).finally(() => { settled = true; });
    let response: Response | undefined;
    try {
      await avatarStarted;
      await expect.poll(() => signals.length, { timeout: 5000 }).toBe(2);
      expect(settled).toBe(false);
      expect(signals.every(signal => !signal.aborted)).toBe(true);
      if (boundary === "source") await db.query("update public.tasks set sort_order=42 where id=$1", [open]);
      if (boundary === "role") await db.query("update public.profiles set platform_role='viewer' where id=$1", [actors.founder.profileId]);
      if (boundary === "deadline") { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + 3_600_000); }
      if (boundary === "request-abort") abort.abort();
      releaseAvatar();
      response = await pending;
      if (!response) throw new Error("Synthetic overlap response missing");
      if (boundary === "ready") {
        expect(response.status).toBe(200);
        const received = frames(response), basis = (await received.next()).value;
        expect(basis.kind).toBe("basis"); expect(basis.model.items).toEqual([]);
        for (const column of ["Offen", "Review"]) expect(basis.model.board.columns[column]).toMatchObject({ total: 1, loaded: 0, availability: "not-loaded" });
        releaseRows();
        const outcomes = [];
        for await (const frame of received) outcomes.push(frame);
        expect(outcomes.filter(frame => frame.kind === "column")).toHaveLength(2);
        expect(outcomes.some(frame => frame.kind === "column" && frame.cardIds.includes(open))).toBe(true);
        expect(outcomes.some(frame => frame.kind === "column" && frame.cardIds.includes(review))).toBe(true);
        expect(outcomes.at(-1)?.kind).toBe("end");
        expect(observed.filter(value => value.path.endsWith("/planning_deliverable_query_plan"))).toHaveLength(1);
        expect(observed.filter(value => value.path.endsWith("/workspace_access_contexts"))).toHaveLength(1);
      } else {
        expect(response.status).toBeGreaterThanOrEqual(400);
        const body = await response.json();
        expect(body).not.toHaveProperty("model"); expect(body).not.toHaveProperty("readAuthority");
        expect(signals).toHaveLength(2);
        expect(signals.every(signal => signal.aborted)).toBe(true);
      }
    } finally {
      abort.abort(); releaseAvatar(); releaseRows(); vi.useRealTimers();
      const completed = response || await pending;
      await completed?.body?.cancel().catch(() => undefined);
    }
  });
}, 120_000);

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

test.each(["source", "authority", "column-failure", "column-failure-source", "column-failure-authority"] as const)("a real query streams a later ready column before a held first column and handles %s after hydration", async change => {
  await withPlanningCredentialDatabase(async fixture => {
    const { db, actors, observed, request } = fixture;
    const { key, open, review } = await seedQueryCards(fixture, "stream");
    const expectedQuery = normalizePlanningBoardQuery({ view: "board", filters: { query: key } });
    const safeColumns = (columns: Record<string, { total: number; ids?: string[] }>) => Object.fromEntries(Object.entries(columns).map(([status, value]) => [status, { total: value.total, selectedIds: value.ids?.length ?? null }]));
    const directPlan = (await db.query("select public.planning_deliverable_query_plan($1,$2) as plan", [actors.founder.profileId, expectedQuery])).rows[0].plan;
    const persisted = (await db.query("select task_type,status,approval_status from public.tasks where id=any($1) order by status", [[open, review]])).rows.map(row => ({
      taskType: ["deliverable", "sub_issue", "initiative", "epic"].includes(row.task_type) ? row.task_type : "other",
      status: ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt", "Pausiert"].includes(row.status) ? row.status : "other",
      approval: ["approved", "proposed", "rejected"].includes(row.approval_status) ? row.approval_status : "other",
    }));
    expect(persisted).toEqual([{ taskType: "deliverable", status: "Offen", approval: "approved" }, { taskType: "deliverable", status: "Review", approval: "approved" }]);
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
          if (change.startsWith("column-failure")) return Response.json({ code: "XX000", message: "Synthetic column unavailable" }, { status: 503 });
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
          const diagnostic = JSON.stringify({ persisted, direct: { status: directPlan.status, columns: safeColumns(directPlan.columns) }, dispatched: planFacts,
            basis: { queryBinding: JSON.stringify(frame.model.query) === JSON.stringify(expectedQuery), columns: safeColumns(frame.model.board.columns) } });
          if (["Offen", "Review"].some(status => frame.model.board.columns[status].total !== 1 || frame.model.board.columns[status].availability !== "not-loaded")) throw new Error(`Safe query-basis mismatch: ${diagnostic}`);
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
          if (change.endsWith("source")) await db.query("update public.tasks set sort_order=42 where id=$1", [open]);
          if (change.endsWith("authority")) await db.query("delete from auth.sessions where id=$1", [actors.founder.sessionId]);
          release();
        }
      }
      expect(received.filter(frame => frame.kind === "basis")).toHaveLength(1);
      expect(received.some(frame => frame.kind === "column" && frame.column === "Offen")).toBe(false);
      const failed = received.find(frame => frame.kind === "failure" && (frame.column === "Offen" || change.endsWith("authority")));
      expect(failed).toMatchObject({ status: change.endsWith("source") ? 409 : change.endsWith("authority") ? 403 : 503 });
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

test.each(["source", "role", "deadline"] as const)("a settled SQL hydration must pass fresh %s validation at the actual publication boundary", async change => {
  await withPlanningCredentialDatabase(async fixture => {
    const { db, actors, observed, request } = fixture;
    const { key, open, review } = await seedQueryCards(fixture, "publication");
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: request("founder", "/api/planning-board-data") }, action: "planning.board.read" });
    expect(permission.ok).toBe(true);
    if (!permission.ok) throw new Error("Synthetic publication actor denied");
    const started = await permission.planning.startBoardQuery({ view: "board", filters: { query: key } });
    expect(started.status).toBe("ready");
    if (started.status !== "ready" || !started.delivery) throw new Error("Synthetic query delivery unavailable");
    const delivery = started.delivery;
    try {
      const [firstDraft, laterDraft] = await Promise.all([delivery.columns.Review!, delivery.columns.Offen!]);
      expect(firstDraft.kind).toBe("column"); expect(laterDraft.kind).toBe("column");
      const beforePublish = observed.filter(value => value.path.endsWith("/planning_source_version")).length;
      const first = await delivery.checkPublication(firstDraft);
      expect(first.kind).toBe("column");
      if (first.kind === "column") expect(first.cardIds).toEqual([review]);
      expect(observed.filter(value => value.path.endsWith("/planning_source_version"))).toHaveLength(beforePublish + 1);
      const liveBeforeLater = observed.filter(value => value.path.endsWith("/current_authenticated_profile")).length;
      if (change === "source") await db.query("update public.tasks set sort_order=44 where id=$1", [open]);
      if (change === "role") await db.query("update public.profiles set platform_role='viewer' where id=$1", [actors.founder.profileId]);
      if (change === "deadline") {
        expect(permission.readAuthority?.deadline).toBeGreaterThan(Date.now());
        vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(permission.readAuthority!.deadline);
      }
      const rejected = await delivery.checkPublication(laterDraft);
      expect(rejected).toMatchObject({ kind: "failure", status: change === "source" ? 409 : 403 });
      expect(rejected).not.toHaveProperty("items");
      if (change !== "deadline") expect(observed.filter(value => value.path.endsWith("/current_authenticated_profile")).length).toBeGreaterThan(liveBeforeLater);
      const previousPayloadCannotBeRepublished = await delivery.checkPublication(firstDraft);
      expect(previousPayloadCannotBeRepublished).toMatchObject({ kind: "failure", status: change === "source" ? 409 : 403 });
    } finally { vi.useRealTimers(); delivery.abort(); }
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  });
}, 120_000);

test("the shared server publication guard rejects temporal expiry after real SQL hydration without a source write", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, local, nativeFetch }) => {
    const end = new Date(); end.setUTCDate(end.getUTCDate() + 2); end.setUTCHours(0, 0, 0, 0);
    const start = new Date(end); start.setUTCDate(start.getUTCDate() - 6);
    const sprint = `${prefix}-temporal-sprint`, card = `${prefix}-temporal-card`, evaluation = end.toISOString();
    await db.query("insert into public.sprints(id,project_id,name,status,start_date,end_date) values($1,'findmydoc-founder-execution','Synthetic publication interval','active',$2,$3)", [sprint, start.toISOString().slice(0, 10), evaluation.slice(0, 10)]);
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,sprint_id) values($1,'findmydoc-founder-execution',$1,'deliverable','Offen','P2','approved',$2,$3,$4)", [card, initiativeId, actors.founder.profileId, sprint]);
    // The trusted provider seam supplies the already supported SQL evaluation
    // argument. All result/time evidence still comes from the real SQL function;
    // no public browser input or synthetic SQL result controls the clock.
    const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => {
      const next = new Request(input, init);
      if (new URL(next.url).pathname.endsWith("/planning_deliverable_query_plan")) {
        const body = await next.clone().json();
        return nativeFetch(new Request(next, { body: JSON.stringify({ ...body, p_evaluated_at: evaluation }) }));
      }
      return nativeFetch(next);
    } } });
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(end);
    let delivery: import("@/features/planning/model/planning-board-delivery").PlanningBoardDelivery | undefined;
    try {
      const { createSupabasePlanningBoardReadModel } = await importTestModule("src/features/planning/server/planning-board-read-model-supabase.ts", { "server-only": {} });
      const result = await createSupabasePlanningBoardReadModel(client).startQuery({ authorized: true, actorProfileId: actors.founder.profileId, query: { view: "board", filters: { query: card, quick: ["week"] } } });
      expect(result.status).toBe("ready");
      if (result.status !== "ready" || !result.delivery) throw new Error("Temporal query delivery unavailable");
      delivery = result.delivery;
      if (!delivery) throw new Error("Temporal query delivery capability missing");
      const draft = await delivery.columns.Offen!;
      expect(draft.kind).toBe("column");
      const validUntil = Date.parse(result.model.board!.validUntil!);
      expect(validUntil).toBe(end.getTime() + 1);
      const originalSource = result.model.scopeRevision;
      vi.setSystemTime(validUntil);
      expect(await delivery.checkPublication(draft)).toMatchObject({ kind: "failure", status: 409 });
      expect((await client.rpc("planning_source_version")).data).toBe(originalSource);
    } finally { vi.useRealTimers(); delivery?.abort(); }
  });
}, 120_000);

test.each(["body", "request"] as const)("aborting the %s cancels every pending column read signal and leaves no permit", async cancellation => {
  await withPlanningCredentialDatabase(async fixture => {
    const { db, actors, request } = fixture;
    const { key } = await seedQueryCards(fixture, "cancellation");
    const transport = globalThis.fetch, signals: AbortSignal[] = [], releases: Array<() => void> = [];
    let entered!: () => void;
    const bothEntered = new Promise<void>(resolve => { entered = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init);
      if (!new URL(next.url).pathname.endsWith("/planning_deliverable_column")) return transport(next);
      // Hold the actual outbound data-dispatch boundary. This proves supported
      // signal propagation, not physical database termination or completed SQL.
      signals.push(next.signal); if (signals.length === 2) entered();
      return new Promise<Response>((_resolve, reject) => {
        const stop = () => { next.signal.removeEventListener("abort", stop); reject(new DOMException("Synthetic cancelled dispatch", "AbortError")); };
        releases.push(stop);
        if (next.signal.aborted) stop(); else next.signal.addEventListener("abort", stop, { once: true });
      });
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const abort = new AbortController(), scope = { view: "board", filters: { query: key } };
    const input = new NextRequest(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`), { signal: abort.signal });
    input.headers.set("accept", "application/x-ndjson");
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await GET(input); expect(response.status).toBe(200);
      const body: ReadableStream<Uint8Array> | null = response.body;
      if (!body) throw new Error("Synthetic query response body missing");
      reader = body.getReader();
      const basis = await reader.read(); expect(new TextDecoder().decode(basis.value)).toContain('"kind":"basis"');
      await bothEntered;
      if (cancellation === "body") await reader.cancel(); else abort.abort();
      expect(signals).toHaveLength(2); expect(signals.every(signal => signal.aborted)).toBe(true);
    } finally { abort.abort(); releases.forEach(stop => stop()); await reader?.cancel().catch(() => undefined); }
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  });
}, 120_000);
