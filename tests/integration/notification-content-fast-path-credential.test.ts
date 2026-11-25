import { expect, it } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

const mocks = { "server-only": {}, "next/cache": { unstable_cache: (load: unknown) => load, revalidateTag() {} } };

it("publishes bounded authorized content independently of the count and retains a consistent remaining page", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", mocks);
  const actor = f.actors.founder;
  const time = "2026-11-20T08:00:00.123456Z";
  const own = (await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status,seen_at,created_at)
    select 'task.mention','task',$1,'Own notice',$2,$2,case n when 44 then 'sent' when 45 then 'failed' else 'pending' end,
      case n when 43 then now() end,$3
    from generate_series(1,45) n returning id`,
    [f.initiativeId, actor.profileId, time])).rows.map(row => Number(row.id));
  await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status,created_at)
    select 'task.mention','task',$1,'Foreign notice',$2,$2,'pending',$3 from generate_series(1,60)`,
    [f.initiativeId, f.actors.other.profileId, time]);
  await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status,created_at)
    values ('task.mention','task',$1,'Global notice',null,$2,'pending',$3),
      ('planning_item.rejected','task',$4,'Missing reference',$2,$2,'pending',$3)`,
    [f.initiativeId, actor.profileId, time, f.prefix + "-missing"]);
  const missing = Number((await f.db.query("select id from public.notification_events where recipient_profile_id=$1 and title='Missing reference'", [actor.profileId])).rows[0].id);

  const preview = await GET(f.request("founder", "/api/notifications-data?area=preview"));
  expect(preview.status).toBe(200);
  const previewBody = await preview.json();
  expect(previewBody.items.map((item: { id: number }) => item.id)).toEqual([missing, ...own.slice(0, 42).reverse().slice(0, 11)]);
  expect(previewBody).not.toHaveProperty("unreadCount");

  const inbox = await GET(f.request("founder", "/api/notifications-data?area=inbox"));
  expect(inbox.status).toBe(200);
  const first = await inbox.json();
  expect(first).toMatchObject({ coverage: "partial", referenceCoverage: "partial", references: [{ itemId: f.initiativeId }] });
  expect(first.events.map((event: { id: number }) => event.id)).toEqual([missing, ...own.slice().reverse().slice(0, 39)]);
  expect(first.events.slice(1, 3).map((event: { status: string }) => event.status)).toEqual(["failed", "sent"]);
  expect(f.observed.filter(entry => entry.path === "/rest/v1/rpc/notification_content_fast_path")).toHaveLength(2);
  expect(f.observed.filter(entry => entry.path === "/rest/v1/rpc/notification_count_fast_path" || entry.path === "/rest/v1/notification_events")).toEqual([]);
  expect(f.observed.filter(entry => entry.path === "/rest/v1/active_tasks")).toHaveLength(1);

  const pageUrl = `/api/notifications-data?area=inbox&continuation=${encodeURIComponent(first.continuation)}`;
  const next = await GET(f.request("founder", pageUrl));
  expect(next.status).toBe(200);
  const tail = await next.json();
  expect(tail).toMatchObject({ coverage: "complete", continuation: null, sourceRevision: first.sourceRevision, observedAt: first.observedAt, validUntil: first.validUntil });
  expect(tail.events.map((event: { id: number }) => event.id)).toEqual(own.slice(0, 6).reverse());
  expect(f.observed.filter(entry => entry.path === "/rest/v1/rpc/notification_content_fast_path")).toHaveLength(2);
  expect((await GET(f.request("other", pageUrl))).status).toBe(409);

  expect(await (await GET(f.request("ceo", "/api/notifications-data?area=preview"))).json())
    .toMatchObject({ items: [{ title: "Global notice" }] });
  expect(await (await GET(f.request("viewer", "/api/notifications-data?area=preview"))).json()).toMatchObject({ items: [] });
  await f.db.query("update public.notification_events set seen_at=now() where id=$1", [own[0]]);
  expect((await GET(f.request("founder", pageUrl))).status).toBe(409);
}, "linking"), 90_000);
