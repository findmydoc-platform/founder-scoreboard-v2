import { expect, it } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

const mocks = { "server-only": {}, "next/cache": { unstable_cache: (load: unknown) => load, revalidateTag() {} } };

it("reads exact authorized unread counts independently of the bounded notification preview", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", mocks);
  const ownIds = (await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status,created_at)
    select 'synthetic.resource','task',$1,'Synthetic owned notification',$2,$2,'pending',now() - (n * interval '1 second')
    from generate_series(1, 25) n returning id`, [f.initiativeId, f.actors.founder.profileId])).rows.map(row => Number(row.id));
  const foreign = (await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status)
    values ('synthetic.resource','task',$1,'Synthetic foreign notification',$2,$2,'pending') returning id`, [f.initiativeId, f.actors.other.profileId])).rows[0].id;
  const global = (await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,actor_profile_id,status)
    values ('synthetic.resource','task',$1,'Synthetic global notification',$2,'pending') returning id`, [f.initiativeId, f.actors.founder.profileId])).rows[0].id;
  async function read(actor: "founder" | "other" | "ceo" | "unmapped", area: "preview" | "count") {
    return GET(f.request(actor, `/api/notifications-data?area=${area}`));
  }
  const count = await read("founder", "count");
  expect(count.status).toBe(200);
  const countBody = await count.json();
  expect(countBody).toMatchObject({ unreadCount: 25, readActor: { profileId: f.actors.founder.profileId } });
  expect(countBody).not.toHaveProperty("items");
  const preview = await read("founder", "preview");
  expect(preview.status).toBe(200);
  const previewBody = await preview.json();
  const ids = previewBody.items.map((item: { id: number }) => item.id);
  expect(ids.length).toBeGreaterThan(0);
  expect(ids.length).toBeLessThan(ownIds.length);
  expect(ids.every((id: number) => ownIds.includes(id))).toBe(true);
  expect(ids).not.toContain(Number(foreign));
  expect(ids).not.toContain(Number(global));
  expect(previewBody).not.toHaveProperty("unreadCount");
  const other = await read("other", "count");
  expect(other.status).toBe(200);
  expect((await other.json()).unreadCount).toBe(1);
  const lead = await read("ceo", "count");
  expect(lead.status).toBe(200);
  expect((await lead.json()).unreadCount).toBe(1);
  for (const area of ["preview", "count"] as const) expect((await read("unmapped", area)).status).toBe(403);
  await f.db.query("delete from auth.sessions where id=$1", [f.actors.founder.sessionId]);
  for (const area of ["preview", "count"] as const) {
    const response = await read("founder", area);
    expect([401, 403]).toContain(response.status);
    const body = await response.json();
    expect(body).not.toHaveProperty("items");
    expect(body).not.toHaveProperty("unreadCount");
  }
}, "linking"), 60_000);

it("paginates authorized inbox rows in stable order and rejects stale or foreign continuations", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", mocks);
  const insert = async (recipient: string | null, count: number, entity: string) => (await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status,created_at)
    select 'synthetic.resource','task',$1,'Synthetic inbox notification',$2,$3,'pending','2026-01-01T12:00:00Z'::timestamptz
    from generate_series(1,$4::integer) returning id`, [entity, recipient, f.actors.ceo.profileId, count])).rows.map(row => Number(row.id));
  const own = await insert(f.actors.ceo.profileId, 45, f.initiativeId);
  const missing = await insert(f.actors.ceo.profileId, 1, `${f.prefix}-missing-target`);
  const globals = await insert(null, 2, f.initiativeId);
  const foreign = await insert(f.actors.other.profileId, 60, f.initiativeId);
  const get = (actor: "ceo" | "founder" | "unmapped", continuation?: string) => GET(f.request(actor, `/api/notifications-data?area=inbox${continuation ? `&continuation=${encodeURIComponent(continuation)}` : ""}`));
  const first = await get("ceo");
  expect(first.status).toBe(200);
  const page = await first.json();
  expect(page.events).toHaveLength(40);
  expect(page.coverage).toBe("partial");
  expect(page.referenceCoverage).toBe("partial");
  expect(page.references).toContainEqual(expect.objectContaining({ itemId: f.initiativeId }));
  expect(typeof page.continuation).toBe("string");
  const expected = [...own, ...missing, ...globals].sort((a, b) => b - a);
  expect(page.events.map((event: { id: number }) => event.id)).toEqual(expected.slice(0, 40));
  expect(page.events.some((event: { id: number }) => foreign.includes(event.id))).toBe(false);
  const second = await get("ceo", page.continuation);
  expect(second.status).toBe(200);
  const tail = await second.json();
  expect(tail.coverage).toBe("complete");
  expect(tail.continuation).toBeNull();
  expect([...page.events, ...tail.events].map((event: { id: number }) => event.id)).toEqual(expected);
  const changed = `${page.continuation.startsWith("A") ? "B" : "A"}${page.continuation.slice(1)}`;
  expect((await get("ceo", changed)).status).toBe(409);
  expect((await get("founder", page.continuation)).status).toBe(409);
  expect((await get("unmapped")).status).toBe(403);
  await f.db.query("update public.notification_events set seen_at=now() where id=$1", [own[0]]);
  expect((await get("ceo", page.continuation)).status).toBe(409);
}, "linking"), 90_000);

it("counts authorized unread events beyond the PostgREST row limit", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", mocks);
  await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status)
    select 'synthetic.resource','task',$1,'Synthetic count beyond provider limit',$2,$2,'pending' from generate_series(1,1005)`, [f.initiativeId, f.actors.founder.profileId]);
  await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status)
    values ('synthetic.resource','task',$1,'Synthetic foreign count boundary',$2,$2,'pending')`, [f.initiativeId, f.actors.other.profileId]);
  const count = await GET(f.request("founder", "/api/notifications-data?area=count"));
  expect(count.status).toBe(200);
  expect((await count.json()).unreadCount).toBe(1005);
  const preview = await GET(f.request("founder", "/api/notifications-data?area=preview"));
  expect(preview.status).toBe(200);
  const body = await preview.json();
  expect(body.items.length).toBeGreaterThan(0);
  expect(body.items.length).toBeLessThan(1005);
  expect(body).not.toHaveProperty("unreadCount");
}, "linking"), 120_000);
