import { expect, it } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

const mocks = { "server-only": {}, "next/cache": { unstable_cache: (load: unknown) => load, revalidateTag() {} } };

it("counts every authorized unread event in the database without a lifecycle scan or write", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", mocks);
  await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status,seen_at)
    select 'task.mention','task',$1,'Own mention',$2,$2,'pending',case when n <= 3 then now() end
    from generate_series(1,1008) n`, [f.initiativeId, f.actors.founder.profileId]);
  await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status)
    values ('task.mention','task',$1,'Resolved',$2,$2,'resolved'),
      ('task.mention','task',$1,'Foreign',$3,$2,'pending'),
      ('task.mention','task',$1,'Global',null,$2,'pending')`,
    [f.initiativeId, f.actors.founder.profileId, f.actors.other.profileId]);

  const count = await GET(f.request("founder", "/api/notifications-data?area=count"));
  expect(count.status).toBe(200);
  expect(await count.json()).toMatchObject({ unreadCount: 1005, readActor: { profileId: f.actors.founder.profileId } });
  expect(f.observed.filter(entry => entry.path === "/rest/v1/rpc/notification_count_fast_path")).toEqual([
    expect.objectContaining({ method: "POST", actor: null }),
  ]);
  expect(f.observed.filter(entry => ["/rest/v1/notification_events", "/rest/v1/active_tasks"].includes(entry.path))).toEqual([]);
  expect(await (await GET(f.request("viewer", "/api/notifications-data?area=count"))).json()).toMatchObject({ unreadCount: 0 });
  expect(await (await GET(f.request("ceo", "/api/notifications-data?area=count"))).json()).toMatchObject({ unreadCount: 1 });
  expect(await (await GET(f.request("deputy", "/api/notifications-data?area=count"))).json()).toMatchObject({ unreadCount: 1 });
  expect((await GET(f.request("unmapped", "/api/notifications-data?area=count"))).status).toBe(403);
}, "linking"), 90_000);

it("uses the existing durable transition before reporting a count, including for a previously seen event", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/notifications-data/route.ts", mocks);
  const { rows: [{ id }] } = await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status,seen_at)
    values ('task.mention','task',$1,'Deleted target',$2,$2,'pending',now()) returning id`,
    [f.prefix + "-deleted", f.actors.viewer.profileId]);
  const count = await GET(f.request("viewer", "/api/notifications-data?area=count"));
  expect(count.status).toBe(200);
  expect(await count.json()).toMatchObject({ unreadCount: 0 });
  expect((await f.db.query("select status,resolution_reason from public.notification_events where id=$1", [id])).rows).toEqual([
    { status: "resolved", resolution_reason: "source_deleted" },
  ]);
  expect(f.observed.some(entry => entry.path === "/rest/v1/notification_events" && entry.method === "PATCH")).toBe(true);
}, "linking"), 90_000);

it("denies direct user calls and stale or mismatched identities at the server SQL boundary", () => withPlanningCredentialDatabase(async f => {
  const actor = f.actors.founder;
  const payload = {
    p_user_id: actor.userId, p_session_id: actor.sessionId,
    p_profile_id: actor.profileId, p_platform_role: "founder",
    p_deadline: new Date(Date.now() + 60_000).toISOString(),
  };
  const read = (changes: Partial<typeof payload> = {}) => f.rpc("notification_count_fast_path", { ...payload, ...changes });
  expect(await (await read()).json()).toMatchObject({ status: "ready", unread_count: 0 });
  for (const caller of ["founder", "ceo", "anonymous"] as const) {
    expect([401, 403]).toContain((await f.rpc("notification_count_fast_path", payload, caller)).status);
  }
  for (const changes of [
    { p_session_id: f.actors.other.sessionId }, { p_profile_id: f.actors.other.profileId },
    { p_platform_role: "ceo" }, { p_deadline: new Date(Date.now() - 60_000).toISOString() },
  ]) expect(await (await read(changes)).json()).toEqual({ status: "forbidden" });
  await f.db.query("delete from auth.sessions where id=$1", [actor.sessionId]);
  expect(await (await read()).json()).toEqual({ status: "forbidden" });
}, "linking"), 60_000);

it("proves task, sprint, meeting and event lifecycle evidence before publishing a count", () => withPlanningCredentialDatabase(async f => {
  const actor = f.actors.ceo;
  const base = f.prefix + "-";
  const task = base + "deliverable", rework = base + "rework", sprint = base + "sprint";
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,review_status,review_owner_profile_id,fixed_date)
    values ($1,'findmydoc-founder-execution','Requested','deliverable','Review','P2','proposed',$3,$4,'requested',$4,(now() at time zone 'Europe/Berlin')::date),
      ($2,'findmydoc-founder-execution','Rework','deliverable','Nacharbeit','P2','approved',$3,$4,'changes_requested',$4,null)`,
    [task, rework, f.initiativeId, actor.profileId]);
  await f.db.query("insert into public.task_blockers(task_id,reason) values($1,'A blocker is open')", [task]);
  await f.db.query(`insert into public.sprints(id,project_id,name,status,review_due_at)
    values ($1,'findmydoc-founder-execution','Review evidence','review',now()-interval '1 day')`, [sprint]);
  const { rows: [{ id: meeting }] } = await f.db.query(`insert into public.meetings(sprint_id,title,meeting_at)
    values($1,'Attendance fixture',now()) returning id`, [sprint]);
  const { rows: [{ id: eventId, starts_at: startsAt }] } = await f.db.query(`insert into public.founder_events(title,starts_at,audience_mode,participant_profile_ids)
    values ('Reminder fixture',now()+interval '2 minutes','selected',array[$1]::text[]) returning id, starts_at`, [actor.profileId]);

  try {
    const pending: [string, string, string][] = [
      ["task.comment", "task", task], ["task.mention", "task", task],
      ["task.review_completed", "task", task], ["task.review_reopened", "task", task],
      ["sprint.task_carried_over", "task", task], ["task.review_requested", "task", task],
      ["task.review_rework", "task", rework], ["task.blocker_reported", "task", task],
      ["task.deadline_overdue", "task", task], ["task.proposed", "task", task],
      ["sprint.review_due", "sprint", sprint], ["event.upcoming", "founder_event", String(eventId)],
      ["meeting.attendance_updated", "meeting", String(meeting)], ["platform_release.published", "platform_release", base + "release"],
      ["planning_item.rejected", "task", task], ["task.review_withdrawn", "task", task],
    ];
    await f.db.query(`insert into public.notification_events(type,entity_type,entity_id,title,recipient_profile_id,actor_profile_id,status)
      select item.type,item.entity_type,item.entity_id,'Lifecycle evidence',$2,$2,'pending'
      from jsonb_to_recordset($1::jsonb) item(type text,entity_type text,entity_id text)`, [
      JSON.stringify(pending.map(([type, entity_type, entity_id]) => ({ type, entity_type, entity_id }))), actor.profileId,
    ]);
    const read = async () => (await f.rpc("notification_count_fast_path", {
      p_user_id: actor.userId, p_session_id: actor.sessionId, p_profile_id: actor.profileId,
      p_platform_role: "ceo", p_deadline: new Date(Date.now() + 60_000).toISOString(),
    })).json();
    const initial = await read();
    expect(initial).toMatchObject({ status: "ready", unread_count: 16 });
    expect(Date.parse(initial.valid_until)).toBeLessThanOrEqual(startsAt.getTime());

    await f.db.query("update public.founder_events set status='cancelled' where id=$1", [eventId]);
    const obsolete = await read();
    expect(obsolete).toMatchObject({ status: "needs_reconcile" });
    expect(obsolete.source_revision).not.toBe(initial.source_revision);
    expect(obsolete).not.toHaveProperty("unread_count");
    expect((await f.db.query("select status from public.notification_events where recipient_profile_id=$1 and type='event.upcoming'", [actor.profileId])).rows).toEqual([{ status: "pending" }]);
  } finally {
    await f.db.query("delete from public.founder_events where id=$1", [eventId]);
    await f.db.query("delete from public.meetings where id=$1", [meeting]);
  }
}, "linking"), 90_000);
