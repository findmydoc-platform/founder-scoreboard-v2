import { expect, test, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { buildSprintScoreViewModel } from "@/features/sprint/model/sprint-score-view-model";
import { sprintWorkspaceModelToPlanningShellState } from "@/features/sprint/model/sprint-planning-shell-projection";
import { mapFounderSprintScore, mapMeeting, mapMeetingAttendance, mapScoreObjection, mapSprint, mapSprintCommitment } from "@/lib/planning-row-mappers";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

const snapshot = "/rest/v1/rpc/planning_sprint_assessment_snapshot";
const publication = "/rest/v1/rpc/planning_sprint_assessment_publication_context";
const route = "src/app/api/sprint-data/route.ts";

test("selected Sprint assessment keeps full Item and support sets above the provider limits", () => withPlanningCredentialDatabase(async f => {
  const sprint = f.prefix + "-assessment";
  const outsideSprint = f.prefix + "-outside";
  const founder = f.actors.founder.profileId;
  await f.db.query(`insert into public.sprints(id,project_id,name,start_date,end_date,review_due_at) values
    ($1,'findmydoc-founder-execution','Assessment','2000-01-01','2099-12-31',now()+interval '10 minutes'),
    ($2,'findmydoc-founder-execution','Unrelated','2000-01-01','2099-12-31',null)`, [sprint, outsideSprint]);
  await f.db.query("update public.profiles set weekly_capacity=27 where id=$1", [founder]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,assignee,owner,
    sprint_id,estimate_hours,definition_of_done,score_relevant,review_status,score_points,score_final)
    select $1||'-item-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Scoring Item','deliverable',
      case when n=1003 then 'Erledigt' else 'In Arbeit' end,'P2','approved',$2,
      case when n>=1003 then $3 else $6 end,case when n>=1003 then $3 else $6 end,
      case when n=1005 then $5 else $4 end,1,
      case when n in (1003,1004) then 'Complete form' else '' end,true,
      case when n=1003 then 'accepted' else 'not_requested' end,case when n=1003 then 10 else 0 end,n=1003
    from generate_series(1,1005) n`, [f.prefix, f.initiativeId, founder, sprint, outsideSprint, f.actors.other.profileId]);
  await f.db.query("insert into public.task_links(task_id,type,label,url) values($1,'evidence','Accepted proof','https://example.invalid/complete')", [f.prefix + "-item-1003"]);
  await f.db.query(`with added as (
    insert into public.meetings(sprint_id,title,meeting_at,status)
    select $1,'Weekly witness','2001-01-01T00:00:00Z'::timestamptz+n*interval '1 day',
      case when n=1 then 'cancelled' else 'planned' end
    from generate_series(1,1004) n returning id,meeting_at
  )
  insert into public.meeting_attendance(meeting_id,profile_id,status,points)
    select id,$2,'present',case when meeting_at<'2001-01-05T00:00:00Z'::timestamptz then 2 else 0 end from added`, [sprint, founder]);
  await f.db.query("insert into public.sprint_commitments(sprint_id,profile_id,commitment_level,weekly_hours) values($1,$2,'Away',0)", [sprint, f.actors.other.profileId]);
  await f.db.query("insert into public.founder_sprint_scores(sprint_id,profile_id,delivery_points,form_points,weekly_points,total_points,fulfilled,finalized_by,finalized_at) values($1,$2,6,2,1,9,false,$3,now())",
    [sprint, f.actors.deputy.profileId, f.actors.ceo.profileId]);
  await f.db.query("insert into public.score_objections(sprint_id,profile_id,comment) values($1,$2,'Kept in assessment basis')", [sprint, founder]);

  const { GET } = await importTestModule(route, { "server-only": {} });
  const path = (area = "assessment", id = sprint) => `/api/sprint-data?area=${area}&sprintId=${id}`;
  const response = await GET(f.request("founder", path()));
  expect(response.status).toBe(200);
  const read = await response.json();
  expect(read).toMatchObject({ sprintId: sprint, scoreLocked: false,
    inputCounts: { items: 1004, commitments: 1, scores: 1, objections: 1, meetings: 1004, attendance: 1004 },
    readActor: { profileId: founder, platformRole: "founder" }, readAuthority: { userId: f.actors.founder.userId },
  });
  const byProfile = new Map<string, unknown>(read.scoreRows.map((row: { profile:{ id:string } }) => [row.profile.id,row]));
  expect(byProfile.get(founder)).toMatchObject({
    committed: 2, hours: 2, finalPoints: 10, openScore: 1, openScoreObjections: 1,
    commitment: { id: 0, commitmentLevel: "Standard", weeklyHours: 27 },
    v21Score: { deliveryPoints: 6, formPoints: 3, weeklyPoints: 4, totalPoints: 13, fulfilled: true },
  });
  expect(byProfile.get(f.actors.other.profileId)).toMatchObject({ committed:1002, hours:1002, v21Score: { awayNeutral: true, totalPoints: 0 } });
  expect(byProfile.get(f.actors.deputy.profileId)).toMatchObject({ v21Score: { totalPoints: 9, deliveryPoints: 6 } });
  expect(f.observed.filter(row => row.path === snapshot)).toHaveLength(1);
  expect(f.observed.filter(row => row.path === publication).map(row => row.actor)).toEqual(["founder"]);
  expect(f.observed.filter(row => ["/rest/v1/active_tasks", "/rest/v1/tasks", "/rest/v1/rpc/planning_sprint_task_scope"].includes(row.path))).toEqual([]);

  const observed = await GET(f.request("founder", path("assessment-source")));
  expect(await observed.json()).toEqual({ sprintId: sprint, sourceRevision: read.sourceRevision, readAuthority: read.readAuthority, readActor: read.readActor });
  expect(f.observed.filter(row => row.path === snapshot)).toHaveLength(1);
  for (const actor of ["ceo", "deputy", "viewer"] as const) {
    const allowed = await GET(f.request(actor, path("assessment-source")));
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ readActor: { platformRole: actor } });
  }
  expect((await GET(f.request("unmapped", path()))).status).toBe(403);
  expect((await GET(f.request("ceo", path("assessment-source", f.prefix + "-missing")))).status).toBe(404);

  const { createCompletePlanningReference } = await importTestModule("tests/helpers/complete-planning-reference.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const legacy = await createCompletePlanningReference(client).load({ authorized: true, actorProfileId: founder, query: { view: "complete" } });
  if (legacy.status !== "ready") throw Error("Complete TypeScript Item reference unavailable");
  expect(legacy.model.coverage?.items).toBe("complete");
  expect(legacy.model.scopeRevision).toBe(read.sourceRevision);
  expect(legacy.model.items.filter((item: { sprintId:string }) => item.sprintId === sprint)).toHaveLength(1004);
  // Read supporting tables without PostgREST's old array limits. The legacy
  // TypeScript calculation receives each complete set in its established shape.
  const support = async (query: string) => (await f.db.query(query,[sprint])).rows.map(row => row.source);
  const [sprints, commitments, scores, objections, meetings, attendance] = await Promise.all([
    support("select to_jsonb(src) as source from public.sprints src where id=$1"),
    support("select to_jsonb(src) as source from public.sprint_commitments src where sprint_id=$1"),
    support("select to_jsonb(src) as source from public.founder_sprint_scores src where sprint_id=$1"),
    support("select to_jsonb(src) as source from public.score_objections src where sprint_id=$1"),
    support("select to_jsonb(src) as source from public.meetings src where sprint_id=$1"),
    support("select to_jsonb(src) as source from public.meeting_attendance src join public.meetings meeting on meeting.id=src.meeting_id where meeting.sprint_id=$1"),
  ]);
  const expected = buildSprintScoreViewModel({
    data:sprintWorkspaceModelToPlanningShellState({
      revision:read.sourceRevision, project:legacy.model.project, people:legacy.model.people, items:legacy.model.items,
      sprints:sprints.map(mapSprint), commitments:commitments.map(mapSprintCommitment), scores:scores.map(mapFounderSprintScore),
      strikeStates:[], strikeEvents:[], objections:objections.map(mapScoreObjection),
      meetings:meetings.map(mapMeeting), attendance:attendance.map(mapMeetingAttendance),
    }),
    selectedSprintId:sprint,
  }).scoreRows;
  const sort = <T extends { profile: { id:string } }>(rows: T[]) => rows.toSorted((a,b) => a.profile.id.localeCompare(b.profile.id));
  expect(sort(read.scoreRows)).toEqual(sort(expected));
}));

test("support races, missing sets and temporal expiry cannot certify an assessment", () => withPlanningCredentialDatabase(async f => {
  const sprint = f.prefix + "-assessment";
  const founder = f.actors.founder.profileId;
  await f.db.query("insert into public.sprints(id,project_id,name,start_date,end_date,review_due_at) values($1,'findmydoc-founder-execution','Bound','2000-01-01','2099-12-31',now()+interval '1 minute')", [sprint]);
  const { GET } = await importTestModule(route, { "server-only": {} });
  const path = (area = "assessment") => `/api/sprint-data?area=${area}&sprintId=${sprint}`;
  const read = () => GET(f.request("founder", path()));
  const initialResponse = await read();
  expect(initialResponse.status).toBe(200);
  const initial = await initialResponse.json();
  expect(initial.inputCounts).toMatchObject({ items: 0, meetings: 0, attendance: 0, commitments: 0, scores: 0 });
  expect(initial.scoreRows.find((row: { profile: { id: string } }) => row.profile.id === founder)).toMatchObject({ v21Score: { totalPoints: 0 } });

  const realFetch = globalThis.fetch;
  let race = true;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (race && new URL(request.url).pathname === publication) {
      race = false;
      await f.db.query("insert into public.meetings(sprint_id,title,meeting_at) values($1,'Supporting change',now())", [sprint]);
    }
    return realFetch(request);
  });
  const changed = await read();
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({ code: "stale_sprint_assessment" });
  vi.stubGlobal("fetch", realFetch);
  const replacement = await (await read()).json();
  expect(replacement.sourceRevision).not.toBe(initial.sourceRevision);
  expect(replacement.inputCounts.meetings).toBe(1);

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const response = await realFetch(request);
    if (new URL(request.url).pathname !== snapshot) return response;
    const raw = await response.json();
    delete raw.attendance;
    return Response.json(raw);
  });
  const partial = await read();
  expect(partial.status).toBe(503);
  expect(await partial.json()).not.toHaveProperty("scoreRows");
  vi.stubGlobal("fetch", realFetch);

  const time = vi.spyOn(Date, "now").mockReturnValue(Date.parse(replacement.validUntil)+1);
  try {
    const stale = await read();
    expect(stale.status).toBe(409);
    expect(await stale.json()).not.toHaveProperty("scoreRows");
  } finally { time.mockRestore(); }
  const finalSource = await (await GET(f.request("founder", path("assessment-source")))).json();
  expect(finalSource.sourceRevision).toBe(replacement.sourceRevision);
  await f.db.query("update public.sprints set score_locked=true where id=$1", [sprint]);
  const locked = await read();
  expect(await locked.json()).toMatchObject({ scoreLocked:true, sourceRevision:expect.not.stringMatching(replacement.sourceRevision) });
}));

test("an authenticated session without the Workspace dispatch grant cannot observe assessment metadata", () => withPlanningCredentialDatabase(async f => {
  const sprint = f.prefix + "-assessment";
  await f.db.query("insert into public.sprints(id,project_id,name) values($1,'findmydoc-founder-execution','Bound')", [sprint]);
  const direct = await f.rpc("planning_sprint_assessment_publication_context",{ p_sprint_id:sprint },"founder");
  expect(direct.status).toBe(403);
  const { GET } = await importTestModule(route, { "server-only": {} });
  const response = await GET(f.request("founder", `/api/sprint-data?area=assessment-source&sprintId=${sprint}`));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ sprintId:sprint,readActor:{ profileId:f.actors.founder.profileId } });
  expect(f.observed.filter(row => row.path === publication)).toMatchObject([{ actor:"founder",permit:true }]);
}, "linking"));
