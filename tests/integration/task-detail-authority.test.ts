import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

const routeContext = (id: string) => ({ params: Promise.resolve({ id }) });

test("detail certificates retain mapped team reads and deny privileged source access and unmapped callers", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts", { "server-only": {} });
  const args = { p_item_id: f.initiativeId, p_area: "target" };
  for (const name of ["ceo", "deputy", "founder", "other", "viewer"] as const) {
    const response = await GET(f.request(name, `/api/tasks/${f.initiativeId}/detail-data?area=target`), routeContext(f.initiativeId));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ taskDetail: { item: { id: f.initiativeId }, readActor: { profileId: f.actors[name].profileId } }, readAuthority: { userId: f.actors[name].userId } });
    expect((await f.rpc("planning_detail_source", args, name)).status).toBe(403);
  }
  const server = await f.rpc("planning_detail_source", args, "service"); expect(server.status).toBe(200);
  expect(await server.json()).toMatchObject({ target_id: f.initiativeId, ancestor_ids: [`${f.prefix}-epic`] });
  const publicCertificate = await f.rpc("planning_detail_publication_context", args, "founder"); expect(publicCertificate.status).toBe(200);
  const certificate = await publicCertificate.json();
  for (const key of ["target_id", "ancestor_ids", "descriptor"]) expect(certificate).not.toHaveProperty(key);
  expect((await f.rpc("planning_detail_publication_context", args, "service")).status).toBe(403);
  for (const name of ["unmapped", "administrator", "anonymous"] as const) expect([401,403]).toContain((await f.rpc("planning_detail_publication_context", args, name)).status);
  expect((await GET(f.request("unmapped", `/api/tasks/${f.initiativeId}/detail-data?area=target`), routeContext(f.initiativeId))).status).toBe(403);
  const direct = await f.db.query(`select role_name as role,has_table_privilege(role_name,'workspace_private.planning_detail_area_revision','SELECT') readable
    from unnest(array['anon','authenticated','service_role']) roles(role_name)`);
  expect(direct.rows).toEqual([{ role: "anon", readable: false }, { role: "authenticated", readable: false }, { role: "service_role", readable: false }]);
  const foreign = `${f.prefix}-foreign-descriptor`;
  await f.db.query("insert into public.tasks(id,project_id,title,task_type,status) values($1,'findmydoc-founder-execution','Unrelated descriptor ancestor','epic','Offen')", [foreign]);
  const transport = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), response = await transport(request);
    if (!new URL(request.url).pathname.endsWith("/rpc/planning_detail_source") || !response.ok) return response;
    return Response.json({ ...await response.json(), target_id: f.initiativeId, ancestor_ids: [foreign] });
  });
  const inconsistent = await GET(f.request("founder", `/api/tasks/${f.initiativeId}/detail-data?area=target`), routeContext(f.initiativeId));
  expect(inconsistent.status).toBe(503); expect(await inconsistent.json()).not.toHaveProperty("taskDetail");
}, "linking"));

test("prepared target and secondary content cannot outlive original authority or a changed mapped role", () => withPlanningCredentialDatabase(async f => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const transport = globalThis.fetch;
  for (const change of ["role", "target-deadline", "discussion-deadline", "timeline-deadline"] as const) {
    const area = change === "role" ? "target" : change.split("-")[0] as "target" | "discussion" | "timeline";
    const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: f.request("founder", `/api/tasks/${f.initiativeId}/detail-data?area=${area}`) }, action: "planning.task.read", targetId: f.initiativeId });
    if (!permission.ok || !permission.readAuthority) throw new Error("Fresh detail admission unavailable");
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), held = new Promise<void>(resolve => { entered = resolve; });
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const next = new Request(input, init), response = await transport(next);
      if (new URL(next.url).pathname.endsWith("/task_links") && response.ok) { entered(); await gate; }
      return response;
    });
    const clock = change === "role" ? null : vi.spyOn(Date, "now").mockReturnValue(permission.readAuthority.deadline - 1_000);
    const pending = permission.planning.loadDetail({ area });
    try {
      await held;
      if (change === "role") await f.db.query("update public.profiles set platform_role='viewer' where id=$1", [f.actors.founder.profileId]);
      else clock!.mockReturnValue(permission.readAuthority.deadline);
      release();
      const result = await pending;
      expect(result.status).toBe("forbidden");
      expect(result).not.toHaveProperty("model");
    } finally {
      release(); await pending.catch(() => undefined);
      clock?.mockRestore(); vi.stubGlobal("fetch", transport);
      if (change === "role") await f.db.query("update public.profiles set platform_role='founder' where id=$1", [f.actors.founder.profileId]);
    }
  }
  expect((await f.db.query("select count(*)::int count from workspace_private.request_permits where user_id=any($1)", [Object.values(f.actors).map(actor => actor.userId)])).rows[0].count).toBe(0);
}, "linking"));

test("detail cancellation reaches the SDK signal while the actual SQL read remains blocked", () => withPlanningCredentialDatabase(async f => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: f.request("founder", `/api/tasks/${f.initiativeId}/detail-data?area=target`) }, action: "planning.task.read", targetId: f.initiativeId });
  if (!permission.ok) throw new Error("Fresh detail admission unavailable");
  let entered!: () => void;
  const dispatched = new Promise<void>(resolve => { entered = resolve; });
  const io: { signal?: AbortSignal | null; open: boolean; abortWhileOpen: boolean } = { open: false, abortWhileOpen: false };
  const transport = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    if (!path.endsWith("/task_links")) return transport(input, init);
    io.signal = init?.signal;
    io.open = true;
    entered();
    io.signal?.addEventListener("abort", () => { io.abortWhileOpen = io.open; }, { once: true });
    try { return await transport(input, init); } finally { io.open = false; }
  });
  await f.db.query("begin");
  await f.db.query("lock table public.task_links in access exclusive mode");
  const cancellation = new AbortController();
  const options = { area: "target" as const, signal: cancellation.signal };
  const pending: Promise<import("@/features/tasks/model/task-detail-read-model").TaskDetailLoadResult> = permission.planning.loadDetail(options);
  try {
    const first = await Promise.race([dispatched.then(() => "io-dispatched"), pending.then(result => "read-settled-"+result.status)]);
    expect(first).toBe("io-dispatched");
    await vi.waitFor(async () => {
      await f.db.query("select pg_stat_clear_snapshot()");
      expect((await f.db.query("select exists(select 1 from pg_stat_activity where pid<>pg_backend_pid() and wait_event_type='Lock' and query ilike '%task_links%') blocked")).rows[0].blocked).toBe(true);
    }, { timeout: 10_000 });
    expect(io.open).toBe(true);
    expect(io.signal?.aborted).toBe(false);
    cancellation.abort();
    expect(io.abortWhileOpen).toBe(true);
    expect(io.signal?.aborted).toBe(true);
  } finally { await f.db.query("rollback"); await pending.catch(() => undefined); }
  const result = await pending;
  expect(result).not.toHaveProperty("model");
}, "linking"));
