import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";
import type { PlanningBoardDelivery, PlanningBoardStreamFrame } from "@/features/planning/model/planning-board-delivery";
import { createCalendarLiveFixture } from "./helpers/calendar-live-fixture";
import { importTestModule } from "../helpers/vitest-module.mjs";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

async function withWorkspaceQuery(run: (context: Awaited<ReturnType<typeof prepare>>) => Promise<void>) {
  const context = await prepare();
  let failure: unknown;
  try { await run(context); } catch (error) { failure = error; }
  try { await context.close(); } catch (error) {
    if (failure) throw new AggregateError([failure, error], "Workspace query acceptance and fixture cleanup both failed");
    throw error;
  }
  if (failure) throw failure;
}

async function prepare() {
  const fixture = await createCalendarLiveFixture(), transport = globalThis.fetch;
  const prefix = `workspace-query-${randomUUID()}`;
  const ids = [`${prefix}-epic`, `${prefix}-initiative`, `${prefix}-open`, `${prefix}-done`];
  const createdIds: string[] = [];
  let createdProject = false;
  const pending = new Set<Promise<Response>>(), gates: Array<ReturnType<typeof gate>> = [];
  const prepared = new Set<string>(), consumed = new Set<string>(), acknowledged = new Set<string>();
  const removedByRelease = new Set<string>();
  const failures: string[] = [];
  let hydrationResponses = 0, profileDispatches = 0, protectedDispatches = 0;
  let afterPrepare: ((hash: string) => Promise<void>) | undefined;
  let beforeRelease: ((request: Request, hash: string, present: number) => Promise<void>) | undefined;
  let actor: Awaited<ReturnType<typeof fixture.actor>>;
  const remaining = async (hash?: string) => (await fixture.database.query(
    "select count(*)::integer as count from workspace_private.request_permits where user_id=$1 and ($2::text is null or permit_hash=$2)",
    [actor.userId, hash ?? null],
  )).rows[0].count as number;
  const safe = (condition: boolean, message: string) => { if (!condition) failures.push(message); };
  const close = async () => {
    for (const item of gates) item.release();
    while (pending.size) await Promise.allSettled([...pending]);
    vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules();
    let failure: unknown;
    try {
      await fixture.database.query("begin");
      try {
        const rows = (await fixture.database.query("select id,project_id,owner from public.tasks where id=any($1) for update", [createdIds])).rows;
        if (rows.length !== createdIds.length || new Set(createdIds).size !== createdIds.length
          || !rows.every(row => row.project_id === "findmydoc-founder-execution" && row.owner === actor.profileId)) {
          throw new Error("Synthetic Item cleanup scope verification failed");
        }
        await fixture.database.query("set local founderops.trash_lifecycle_write='on'");
        await fixture.database.query("delete from public.tasks where id=any($1)", [createdIds]);
        if (createdProject) await fixture.database.query("delete from public.projects where id='findmydoc-founder-execution'");
        await fixture.database.query("commit");
      } catch (error) {
        try { await fixture.database.query("rollback"); } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Workspace query Item cleanup and rollback both failed");
        }
        throw error;
      }
    } catch (error) { failure = error; }
    try { await fixture.close(); } catch (error) {
      if (failure) throw new AggregateError([failure, error], "Workspace query Item and identity cleanup both failed");
      throw error;
    }
    if (failure) throw failure;
  };
  try {
    await fixture.mode("linking", true);
    actor = await fixture.actor("founder");
    createdProject = (await fixture.database.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic Workspace query') on conflict(id) do nothing returning id")).rowCount === 1;
    await fixture.database.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner) values($1,'findmydoc-founder-execution','Synthetic permit Epic','epic','Offen','P2',$2)", [ids[0], actor.profileId]);
    createdIds.push(ids[0]);
    await fixture.database.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,parent_task_id,approval_status) values($1,'findmydoc-founder-execution','Synthetic permit Initiative','initiative','Offen','P2',$2,$3,'approved')", [ids[1], actor.profileId, ids[0]]);
    createdIds.push(ids[1]);
    for (const [id, status] of [[ids[2], "Offen"], [ids[3], "Erledigt"]]) {
      await fixture.database.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,parent_task_id,approval_status) values($1,'findmydoc-founder-execution',$2,'deliverable',$3,'P2',$4,$5,'approved')", [id, prefix, status, actor.profileId, ids[1]]);
      createdIds.push(id);
    }
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: fixture.local.API_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: fixture.local.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: fixture.local.SERVICE_ROLE_KEY,
      REQUIRE_SUPABASE_AUTH: "true", GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-query-audience",
      GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-query@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu",
      VERCEL_OIDC_TOKEN: actor.session.access_token })) vi.stubEnv(name, value);
    const dispatch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
      if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now() + 3600000).toISOString() });
      if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
      if (url.origin !== new URL(fixture.local.API_URL).origin) throw new Error("Unexpected external provider in Workspace query test");
      if (url.pathname.endsWith("/workspace_dispatch_prepare")) {
        const body = await request.clone().json();
        const response = await transport(request);
        if (response.ok && await response.clone().json() === true) {
          // Hashes, tokens and row bindings remain in memory. Assertions expose
          // only booleans/counts, never the values used to bind the permit.
          const binding = (await fixture.database.query(`select
            user_id=$2::uuid and jwt_hash=$3 and method='POST' and path='/rpc/current_authenticated_profile'
            and access_generation=(select access_generation from workspace_private.configuration where singleton)
            and expires_at>clock_timestamp() as matches
            from workspace_private.request_permits where permit_hash=$1`, [body.p_hash, actor.userId, digest(actor.session.access_token)])).rows;
          safe(binding.length === 1 && binding[0].matches === true, "prepared permit must have the original user/JWT/method/path/generation binding");
          safe(!prepared.has(body.p_hash), "each preparation must issue a distinct permit");
          prepared.add(body.p_hash);
          await afterPrepare?.(body.p_hash);
        }
        return response;
      }
      if (url.pathname.endsWith("/current_authenticated_profile")) {
        profileDispatches++;
        safe(request.headers.get("authorization") === `Bearer ${actor.session.access_token}`, "live profile must use the original JWT");
        const permit = request.headers.get("x-founderops-workspace-permit");
        safe(Boolean(permit), "live profile must carry a Workspace permit");
        const hash = digest(permit || "");
        safe(prepared.has(hash) && await remaining(hash) === 1, "the real permit must exist before its protected POST");
        const response = await transport(request);
        if (response.ok && await remaining(hash) === 0) consumed.add(hash);
        return response;
      }
      if (url.pathname.endsWith("/workspace_release_permit")) {
        const { p_hash: hash } = await request.clone().json();
        const present = await remaining(hash);
        safe(prepared.has(hash), "cleanup must match a positively observed preparation");
        safe(present === 1 || present === 0 && consumed.has(hash), "absence before cleanup must have an observed protected-request consumption");
        await beforeRelease?.(request, hash, present);
        const response = await transport(request);
        safe(response.ok && await remaining(hash) === 0, "acknowledged cleanup must leave its exact permit absent");
        acknowledged.add(hash);
        if (present > 0) removedByRelease.add(hash);
        return response;
      }
      if (["planning_deliverable_query_plan", "planning_deliverable_column", "planning_source_version"].some(name => url.pathname.endsWith(`/rpc/${name}`))) protectedDispatches++;
      const response = await transport(request);
      if (url.pathname.endsWith("/planning_deliverable_column") && response.ok) hydrationResponses++;
      return response;
    };
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const reading = dispatch(input, init);
      pending.add(reading);
      void reading.finally(() => pending.delete(reading)).catch(() => undefined);
      return reading;
    });
    vi.resetModules();
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const query = { view: "board" as const, filters: { query: prefix } };
    const request = (signal?: AbortSignal) => new NextRequest(`http://localhost:3000/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`, {
      signal, headers: { authorization: `Bearer ${actor.session.access_token}`, accept: "application/x-ndjson" },
    });
    return { fixture, actor, query, ids, GET, authorizeCredentialAction, request, remaining, close,
      hold() { const item = gate(); gates.push(item); return item; },
      onPrepare(callback: typeof afterPrepare) { afterPrepare = callback; },
      onRelease(callback: typeof beforeRelease) { beforeRelease = callback; },
      hydrationCount: () => hydrationResponses,
      assertAccounting() {
        expect(failures).toEqual([]);
        expect(prepared.size).toBeGreaterThan(0);
        expect(acknowledged.size).toBe(prepared.size);
        expect([...prepared].every(hash => acknowledged.has(hash))).toBe(true);
        expect([...prepared].every(hash => consumed.has(hash) !== removedByRelease.has(hash))).toBe(true);
      },
      facts: () => ({ prepared: prepared.size, consumed: consumed.size, acknowledged: acknowledged.size, releaseRemovals: removedByRelease.size, profileDispatches, protectedDispatches }),
    };
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Workspace query setup and fixture cleanup both failed");
    }
    throw error;
  }
}

test("Workspace query delivery observes real prepared, consumed and acknowledged permits with the original JWT", async () => {
  await withWorkspaceQuery(async context => {
    const response: Response = await context.GET(context.request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");
    const frames: PlanningBoardStreamFrame[] = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
    const basis = frames[0];
    expect(basis?.kind).toBe("basis");
    if (!basis || basis.kind !== "basis") throw new Error("Synthetic Workspace query basis missing");
    expect(basis.model.items.length).toBe(0);
    expect(JSON.stringify(frames.filter(frame => frame.kind === "column").flatMap(frame => frame.cardIds).sort()) === JSON.stringify(context.ids.slice(2).sort())).toBe(true);
    expect(frames.some(frame => frame.kind === "failure")).toBe(false);
    expect(frames.at(-1)?.kind).toBe("end");
    context.assertAccounting();
    expect(context.facts().consumed + context.facts().releaseRemovals).toBe(context.facts().prepared);
    expect(await context.remaining()).toBe(0);
  });
}, 120_000);

test("an original Workspace deadline rejects a prepared publication dispatch and releases its still-unconsumed permit", async () => {
  await withWorkspaceQuery(async context => {
    const permission = await context.authorizeCredentialAction({ credential: { kind: "session-request", request: context.request() }, action: "planning.board.read" });
    expect(permission.ok).toBe(true);
    if (!permission.ok) throw new Error("Synthetic Workspace query admission failed");
    const started = await permission.planning.startBoardQuery(context.query);
    expect(started.status).toBe("ready");
    if (started.status !== "ready" || !started.delivery) throw new Error("Synthetic Workspace query delivery unavailable");
    const delivery: PlanningBoardDelivery = started.delivery;
    try {
      const drafts = await Promise.all(Object.values(delivery.columns));
      expect(drafts.length).toBe(2);
      expect(drafts.every(frame => frame?.kind === "column")).toBe(true);
      expect(permission.readAuthority!.deadline).toBeLessThan(context.actor.session.expires_at! * 1000);
      const preparedGate = context.hold(), entered = context.hold();
      let heldHash: string | undefined, positiveBeforeRelease = false;
      context.onPrepare(async hash => {
        context.onPrepare(undefined); heldHash = hash;
        expect(await context.remaining(hash)).toBe(1);
        entered.release(); await preparedGate.promise;
      });
      context.onRelease(async (_request, hash, present) => {
        if (hash === heldHash) { positiveBeforeRelease = present === 1; expect(present).toBe(1); }
      });
      const before = context.facts();
      const publishing = delivery.checkPublication(drafts[0]!);
      await entered.promise;
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(permission.readAuthority!.deadline);
      preparedGate.release();
      const outcome = await publishing;
      expect(outcome.kind).toBe("failure");
      expect(outcome.kind === "failure" ? outcome.status : null).toBe(403);
      expect("items" in outcome).toBe(false);
      expect(positiveBeforeRelease).toBe(true);
      expect(context.facts().prepared - before.prepared).toBe(1);
      expect(context.facts().consumed).toBe(before.consumed);
      expect(context.facts().profileDispatches).toBe(before.profileDispatches);
      expect(context.facts().protectedDispatches).toBe(before.protectedDispatches);
      expect(context.facts().releaseRemovals - before.releaseRemovals).toBe(1);
      context.assertAccounting();
      expect(await context.remaining()).toBe(0);
    } finally { vi.useRealTimers(); delivery.abort(); }
  });
}, 120_000);

test.each(["body", "request"] as const)("Workspace %s cancellation retains independent real permit-release acknowledgement", async kind => {
  await withWorkspaceQuery(async context => {
    const cleanupGate = context.hold(), entered = context.hold();
    const abort = new AbortController();
    let cleanupSignal: AbortSignal | undefined, held = false, callerAbortedWhileCleanupLive = false;
    context.onRelease(async (request, _hash, present) => {
      if (held || context.hydrationCount() < 2) return;
      held = true; cleanupSignal = request.signal;
      // workspace_check_request consumes a permit in a writable transaction;
      // a read-only transaction leaves it for finally. Observe the actual row.
      expect([0, 1]).toContain(present);
      entered.release(); await cleanupGate.promise;
      callerAbortedWhileCleanupLive = !request.signal.aborted;
    });
    const response: Response = await context.GET(context.request(abort.signal));
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    try {
      const basis = await reader.read();
      expect(new TextDecoder().decode(basis.value)).toContain('"kind":"basis"');
      await entered.promise;
      if (kind === "body") await reader.cancel(); else abort.abort();
      expect(cleanupSignal?.aborted).toBe(false);
      cleanupGate.release();
      if (kind === "request") while (!(await reader.read()).done) { /* Drain the classified stream termination. */ }
      await vi.waitFor(() => {
        expect(context.facts().acknowledged).toBe(context.facts().prepared);
      });
      expect(callerAbortedWhileCleanupLive).toBe(true);
      expect(context.facts().consumed + context.facts().releaseRemovals).toBe(context.facts().prepared);
      context.assertAccounting();
      expect(await context.remaining()).toBe(0);
    } finally { cleanupGate.release(); abort.abort(); await reader.cancel().catch(() => undefined); }
  });
}, 120_000);
