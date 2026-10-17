import { expect, it } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

const mocks = { "server-only": {}, "next/cache": { unstable_cache: (load: unknown) => load, revalidateTag() {} } };
const context = (id: string) => ({ params: Promise.resolve({ id }) });

it.each(["legacy", "linking"] as const)("Events %s HTTP writes preserve role, participants, administrator permits and expiry", mode => withPlanningCredentialDatabase(async f => {
  const create = await importTestModule("src/app/api/events/route.ts", mocks);
  const update = await importTestModule("src/app/api/events/[id]/route.ts", mocks);
  const payload = { title: "Synthetic resource event", startsAt: "2099-01-12T10:00", audienceMode: "selected", participantProfileIds: [f.actors.founder.profileId] };
  const ids: number[] = [];
  try {
    for (const actor of ["founder", "viewer", "unmapped"] as const) expect((await create.POST(f.request(actor, "/api/events", "POST", payload))).status).toBe(403);
    for (const actor of ["ceo", "administrator"] as const) {
      const response = await create.POST(f.request(actor, "/api/events", "POST", payload));
      expect(response.status).toBe(200);
      const event = (await response.json()).event; ids.push(event.id);
      const stored = (await f.db.query("select title,created_by,participant_profile_ids from public.founder_events where id=$1", [event.id])).rows[0];
      expect(stored).toEqual({ title: payload.title, created_by: f.actors[actor].profileId, participant_profile_ids: [f.actors.founder.profileId] });
      expect((await update.PATCH(f.request("deputy", `/api/events/${event.id}`, "PATCH", { title: "Deputy correction" }), context(String(event.id)))).status).toBe(200);
    }
    const administratorWrites = f.observed.filter(operation => operation.path === "/rest/v1/founder_events" && operation.method === "POST" && operation.actor === "administrator");
    expect(administratorWrites).toHaveLength(1); expect(administratorWrites[0].permit).toBe(mode === "linking");
    if (mode === "linking") {
      const direct = await f.nativeFetch(`${f.local.API_URL}/rest/v1/founder_events`, { method: "POST", headers: { apikey: f.local.ANON_KEY, authorization: `Bearer ${f.actors.administrator.token}`, "content-type": "application/json" }, body: JSON.stringify({ title: "No permit", starts_at: "2099-01-12T10:00:00Z" }) });
      expect(direct.status).toBe(403);
    }
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", mocks);
    const held = await authorizeCredentialAction({ credential: { kind: "session-request", request: f.request("administrator", "/api/events") }, action: "events.update", targetId: String(ids[0]) });
    if (!held.ok) throw new Error("Expected admitted administrator event operation");
    const observed = await held.resource.readEvent(); expect(observed.error).toBeNull();
    await f.db.query("update public.administrator_access_grants set active_until=now()-interval '1 second' where profile_id=$1", [f.actors.administrator.profileId]);
    const rejected = await held.resource.saveEvent({ ...observed.data, title: "Expired correction", updated_at: new Date().toISOString() }, {});
    expect(rejected.participantError).toBeTruthy();
    expect(rejected.data).toBeNull();
    expect((await f.db.query("select title from public.founder_events where id=$1", [ids[0]])).rows[0].title).toBe("Deputy correction");
    expect((await f.db.query("select count(*)::int as count from public.audit_log where actor_profile_id=$1 and action='founder_event.create'", [f.actors.administrator.profileId])).rows[0].count).toBe(1);
  } finally { await f.db.query("delete from public.founder_events where id=any($1::bigint[])", [ids]); }
}, mode), 30_000);

it.each(["legacy", "linking"] as const)("Tools %s operations retain contributors without administrator inheritance and recheck held authority", mode => withPlanningCredentialDatabase(async f => {
  const route = await importTestModule("src/app/api/tools/route.ts", mocks), ids: string[] = [];
  const payload = { name: `${f.prefix} Tool`, description: "A synthetic useful resource.", url: "https://example.test/tool" };
  try {
    expect((await route.POST(f.request("viewer", "/api/tools", "POST", payload))).status).toBe(403);
    await f.db.query("update public.profiles set platform_role='viewer' where id=$1", [f.actors.administrator.profileId]);
    expect((await route.POST(f.request("administrator", "/api/tools", "POST", payload))).status).toBe(403);
    const created = await route.POST(f.request("founder", "/api/tools", "POST", payload)); expect(created.status).toBe(200);
    const tool = (await created.json()).tool; ids.push(tool.id);
    const patch = await importTestModule("src/app/api/tools/[id]/route.ts", mocks);
    expect((await patch.PATCH(f.request("other", `/api/tools/${tool.id}`, "PATCH", { ...payload, name: "Other contributor edit" }), context(tool.id))).status).toBe(200);
    expect((await f.db.query("select name from public.fmd_tools where id=$1", [tool.id])).rows[0].name).toBe("Other contributor edit");
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", mocks);
    const held = await authorizeCredentialAction({ credential: { kind: "session-request", request: f.request("founder", "/api/tools") }, action: "tools.update", targetId: tool.id });
    if (!held.ok) throw new Error("Expected admitted tool update");
    const read = await held.resource.readTool(); expect(read.error).toBeNull();
    await f.db.query("update public.profiles set platform_role='viewer' where id=$1", [f.actors.founder.profileId]);
    expect(await held.resource.saveTool({ ...read.data, name: "Lost authority edit" }, {})).toMatchObject({ ok: false, status: 500 });
    expect((await f.db.query("select name from public.fmd_tools where id=$1", [tool.id])).rows[0].name).toBe("Other contributor edit");
  } finally { await f.db.query("delete from public.fmd_tools where id=any($1::text[])", [ids]); }
}, mode), 30_000);

it("supporting and Strategic reads retain viewer access while notification writes bind recipients or global-event leads", () => withPlanningCredentialDatabase(async f => {
  for (const path of ["events-data", "tools-data", "team-data", "notifications-data", "strategic-planning-data"]) {
    const { GET } = await importTestModule(`src/app/api/${path}/route.ts`, mocks);
    const response = await GET(f.request("viewer", `/api/${path}`)); expect(response.status).toBe(200);
    expect((await response.json()).currentProfile.id).toBe(f.actors.viewer.profileId);
    expect((await GET(f.request("unmapped", `/api/${path}`))).status).toBe(403);
  }
  const event = (await f.db.query("insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,status) values('synthetic.resource','task',$1,'Recipient boundary',$2,'pending') returning id", [f.initiativeId, f.actors.founder.profileId])).rows[0].id;
  const { PATCH } = await importTestModule("src/app/api/notifications/[id]/route.ts", mocks);
  expect((await PATCH(f.request("other", `/api/notifications/${event}`, "PATCH", { action: "dismiss" }), context(String(event)))).status).toBe(403);
  expect((await f.db.query("select status,seen_at from public.notification_events where id=$1", [event])).rows[0]).toMatchObject({ status: "pending", seen_at: null });
  expect((await PATCH(f.request("founder", `/api/notifications/${event}`, "PATCH", { action: "seen" }), context(String(event)))).status).toBe(200);
  const seen = (await f.db.query("select seen_at from public.notification_events where id=$1", [event])).rows[0].seen_at;
  expect(seen).not.toBeNull();
  expect((await PATCH(f.request("deputy", `/api/notifications/${event}`, "PATCH", { action: "dismiss" }), context(String(event)))).status).toBe(403);
  expect((await PATCH(f.request("founder", `/api/notifications/${event}`, "PATCH", { action: "dismiss" }), context(String(event)))).status).toBe(200);
  const stored = (await f.db.query("select status,seen_at,dismissed_at from public.notification_events where id=$1", [event])).rows[0];
  expect(stored).toMatchObject({ status: "dismissed", seen_at: seen }); expect(stored.dismissed_at).not.toBeNull();
  const globalEvent = (await f.db.query("insert into public.notification_events(type,entity_type,entity_id,title,actor_profile_id,status) values('synthetic.resource','task',$1,'Global lead boundary',$2,'pending') returning id", [f.initiativeId, f.actors.founder.profileId])).rows[0].id;
  expect((await PATCH(f.request("founder", `/api/notifications/${globalEvent}`, "PATCH", { action: "dismiss" }), context(String(globalEvent)))).status).toBe(403);
  expect((await PATCH(f.request("deputy", `/api/notifications/${globalEvent}`, "PATCH", { action: "dismiss" }), context(String(globalEvent)))).status).toBe(200);
  expect((await f.db.query("select status from public.notification_events where id=$1", [globalEvent])).rows[0].status).toBe("dismissed");
}, "linking"), 30_000);

it("public Health and historical initiative redirect retain fixed server-only data operations", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/health/route.ts", mocks);
  const ready = await GET(); expect(ready.status).toBe(200); expect(ready.headers.get("cache-control")).toBe("no-store");
  expect(await ready.json()).toMatchObject({ status: "ready", checks: { coreTablesReachable: true } });
  const historical = `${f.prefix}-historical`;
  await f.db.query("insert into public.planning_item_historical_links(item_type,historical_id,task_id,project_id,source_snapshot) values('initiative',$1,$2,'findmydoc-founder-execution','{}')", [historical, f.initiativeId]);
  try {
    const page = await importTestModule("src/app/initiatives/[id]/page.tsx", { ...mocks, "next/navigation": { redirect: (value: string) => { throw new Error(`Synthetic redirect ${value}`); } } });
    const props = (id: string, returnTo = "/team/platform-releases/v1.2.3?tab=details") => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({ returnTo }) });
    await expect(page.default(props(historical))).rejects.toThrow(`/tasks/${encodeURIComponent(f.initiativeId)}?returnTo=${encodeURIComponent("/team/platform-releases/v1.2.3?tab=details")}`);
    await expect(page.default(props("unknown legacy id", "https://other.example.test"))).rejects.toThrow("/tasks/unknown%20legacy%20id");
  } finally { await f.db.query("delete from public.planning_item_historical_links where historical_id=$1", [historical]); }
}), 30_000);

it("disconnect HTTP preserves exact confirmed cleanup after owner session loss without touching a foreign private week", () => withPlanningCredentialDatabase(async f => {
  const owner = f.actors.viewer;
  const week = (await f.db.query("select (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7)::text as week")).rows[0].week;
  const json = async (response: Response) => { const text = await response.text(), body = text ? JSON.parse(text) : null; if (!response.ok) throw new Error(`Synthetic fixture RPC failed (${response.status}, ${body?.code || "unknown"})`); return body; };
  const own = await json(await f.rpc("create_private_team_workweek_version", { p_effective_from: week, p_windows: [{ weekday: 6, startMinute: 690, endMinute: 960 }] }, "viewer"));
  const foreign = await json(await f.rpc("create_private_team_workweek_version", { p_effective_from: week, p_windows: [{ weekday: 5, startMinute: 600, endMinute: 900 }] }, "other"));
  await f.db.query("insert into public.google_workspace_connections(profile_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,oauth_scopes,token_type,primary_calendar_id) values($1,$2,$3,now()+interval '1 hour',now()+interval '2 hours',$4,'Bearer','primary')", [owner.profileId, f.encrypt("synthetic-resource-calendar"), f.encrypt("synthetic-resource-refresh"), ["https://www.googleapis.com/auth/calendar.events.owned"]]);
  const events = new Map<string, Record<string, unknown>>(); let deleteCount = 0;
  f.setProvider(async request => {
    const url = new URL(request.url), id = url.pathname.split("/").at(-1)!;
    if (request.method === "GET") return id === "events" ? Response.json({ items: [...events.values()] }) : events.has(id) ? Response.json(events.get(id)) : new Response(null, { status: 404 });
    if (request.method === "POST") { const body = await request.json(); const event = { ...body, etag: '"resource-confirmed"' }; events.set(body.id, event); return Response.json(event); }
    if (request.method === "DELETE") { deleteCount++; events.delete(id); await f.db.query("delete from auth.sessions where id=$1", [owner.sessionId]); return new Response(null, { status: 204 }); }
    throw new Error("Unscripted disconnect provider operation");
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", mocks);
  const publish = await authorizeCredentialAction({ credential: { kind: "session-request", request: f.request("viewer", "/api/team-workweek/publish") }, action: "workweek.publish", targetId: own.id });
  if (!publish.ok) throw new Error("Expected owner publication capability");
  expect(await publish.planning.detectWorkweekConflict()).toMatchObject({ state: "clear" });
  const publication = await publish.planning.publishWorkweek(); expect(publication.status).toBe("published");
  for (const actor of ["viewer", "other"] as const) expect((await f.rpc("prepare_google_workspace_disconnect", { p_owner_profile_id: owner.profileId }, actor)).status).toBe(403);
  const { POST } = await importTestModule("src/app/api/google-workspace/disconnect/route.ts", mocks);
  const response = await POST(f.request("viewer", `/api/google-workspace/disconnect?owner_profile_id=${f.actors.other.profileId}`, "POST", { confirm: true }));
  expect(response.status).toBe(202); expect(await response.json()).toEqual({ result: { state: "remove_pending", recovery: "retry" } });
  expect(deleteCount).toBe(1);
  const operation = (await f.db.query("select id,state from public.google_workspace_disconnect_operations where owner_profile_id=$1", [owner.profileId])).rows[0]; expect(operation.state).toBe("revoke_pending");
  expect((await f.db.query("select state from public.google_workspace_disconnect_series where operation_id=$1", [operation.id])).rows).toEqual([{ state: "confirmed" }]);
  expect((await f.db.query("select count(*)::int as count from public.google_workspace_disconnect_operations where owner_profile_id=$1", [f.actors.other.profileId])).rows[0].count).toBe(0);
  expect((await f.db.query("select owner_profile_id from public.team_workweek_versions where id=$1", [foreign.id])).rows[0].owner_profile_id).toBe(f.actors.other.profileId);
}), 30_000);
