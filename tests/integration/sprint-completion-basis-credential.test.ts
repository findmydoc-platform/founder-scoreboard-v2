import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

type Fixture = Parameters<Parameters<typeof withPlanningCredentialDatabase>[0]>[0];
const sourceRpc = "planning_sprint_completion_publication_context";
const snapshotRpc = "planning_sprint_completion_snapshot";
const commitRpc = "commit_sprint_completion_basis";

async function seed(f: Fixture) {
  const sprint = f.prefix + "-complete";
  const target = f.prefix + "-complete-item";
  const founder = f.actors.founder.profileId;
  await f.db.query(`insert into public.sprints(id,project_id,name,start_date,end_date,review_due_at,status)
    values($1,'findmydoc-founder-execution','Completion','2000-01-01','2000-01-14',now()-interval '1 hour','review')`, [sprint]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,
    assignee,owner,sprint_id,definition_of_done,evidence_link,review_status,score_points,score_final)
    values($1,'findmydoc-founder-execution','Completed evidence','deliverable',$2,'Erledigt','P2','approved',$3,$3,$4,
      'Complete evidence','https://example.invalid/proof','accepted',10,true)`, [target,f.initiativeId,founder,sprint]);
  const { rows: [{ id: meeting }] } = await f.db.query(`insert into public.meetings(sprint_id,title,meeting_at,status)
    values($1,'Completion attendance','2000-01-05T09:00:00Z','done') returning id`, [sprint]);
  await f.db.query("insert into public.meeting_attendance(meeting_id,profile_id,status,points) values($1,$2,'present',2)", [meeting,founder]);
  const { GET, POST } = await importTestModule("src/app/api/sprints/[id]/lock/route.ts", { "server-only": {} });
  const url = `/api/sprints/${sprint}/lock`, context = { params: Promise.resolve({ id:sprint }) };
  const get = (actor: keyof Fixture["actors"] = "ceo", area = "completion") =>
    GET(f.request(actor, area ? `${url}?area=${area}` : url), context);
  const post = (body: unknown, actor: keyof Fixture["actors"] = "ceo") => POST(f.request(actor,url,"POST",body),context);
  const payload = (read: { basis:{ sprint:{updatedAt:string};tasks:{id:string;updatedAt:string}[] }; decision:{ token?:string } }, signed = true) => ({
    expectedUpdatedAt: read.basis.sprint.updatedAt,
    expectedTasks: read.basis.tasks.map(task => ({ id:task.id,updatedAt:task.updatedAt })),
    ...(signed ? { completionBasis:read.decision.token } : {}),
  });
  return { get, post, payload, sprint, target, founder, meeting };
}

test("a completed Sprint uses the verified foundation once and retains old recovery and replay", () => withPlanningCredentialDatabase(async f => {
  const { get,post,payload,sprint,target,founder } = await seed(f);
  const response = await get();
  expect(response.status).toBe(200);
  const read = await response.json();
  expect(read).toMatchObject({
    sprintId:sprint, basis:{sprint:{id:sprint,scoreLocked:false},tasks:[{id:target,title:"Completed evidence"}]},
    tasksComplete:true, receipt:null, openObjections:0, decision:{status:"ready",token:expect.any(String)},
    readActor:{ profileId:f.actors.ceo.profileId, platformRole:"ceo" },
    readAuthority:{ userId:f.actors.ceo.userId },
  });
  expect(f.observed.filter(entry => entry.path === `/rest/v1/rpc/${sourceRpc}`).map(entry => entry.actor)).toEqual(["ceo"]);
  expect(f.observed.filter(entry => entry.path === `/rest/v1/rpc/${snapshotRpc}`)).toHaveLength(1);
  const observed = await get("ceo","completion-source");
  expect(await observed.json()).toEqual({
    sprintId:sprint,sourceRevision:read.sourceRevision,readActor:read.readActor,readAuthority:read.readAuthority,
  });
  expect(f.observed.filter(entry => entry.path === `/rest/v1/rpc/${snapshotRpc}`)).toHaveLength(1);
  for (const actor of ["deputy","founder","viewer","unmapped","administrator"] as const) {
    expect((await get(actor)).status).toBe(403);
    expect((await post(payload(read),actor)).status).toBe(403);
  }
  const denied = await post({ ...payload(read),completionBasis:"invalid" });
  expect(denied.status).toBe(409);
  expect(await denied.json()).toMatchObject({ code:"sprint_lock_basis_stale" });
  const result = await post(payload(read));
  expect(result.status).toBe(200);
  const saved = await result.json();
  expect(saved).toMatchObject({ ok:true,sprint:{id:sprint,status:"closed",scoreLocked:true},carryover:{created:0,evaluated:0} });

  const scores = await f.db.query("select delivery_points,form_points,weekly_points,total_points from public.founder_sprint_scores where sprint_id=$1 and profile_id=$2",[sprint,founder]);
  expect(scores.rows).toEqual([{ delivery_points:12,form_points:4,weekly_points:2,total_points:18 }]);
  const recovered = await (await get("ceo","")).json();
  expect(recovered).toMatchObject({ basis:{sprint:{id:sprint,scoreLocked:true},tasks:[]},tasksComplete:false,receipt:{sprint:saved.sprint} });
  const modernRecovered = await (await get()).json();
  expect(modernRecovered).toMatchObject({ tasksComplete:false,receipt:{sprint:saved.sprint},decision:{status:"blocked",reason:"alreadyLocked"} });
  const replayed = await post({});
  expect(replayed.status).toBe(200);
  expect(await replayed.json()).toMatchObject({ ok:true,replayed:true,sprint:saved.sprint });
  expect(f.observed.filter(entry => entry.path === `/rest/v1/rpc/${commitRpc}`)).toHaveLength(1);
}));

test("changed supports cannot be committed, and the unchanged tokenless transport can retry", () => withPlanningCredentialDatabase(async f => {
  const { get,post,payload,sprint,founder,meeting } = await seed(f);
  const read = await (await get()).json();
  expect(read.decision.status).toBe("ready");
  const realFetch = globalThis.fetch;
  let changed = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input,init);
    if (!changed && new URL(request.url).pathname.endsWith("/" + commitRpc)) {
      changed = true;
      await f.db.query("update public.meeting_attendance set points=1 where meeting_id=$1 and profile_id=$2",[meeting,founder]);
    }
    return realFetch(request);
  });
  const stale = await post(payload(read));
  expect(changed).toBe(true);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ code:"sprint_lock_basis_stale" });
  expect((await f.db.query("select score_locked from public.sprints where id=$1",[sprint])).rows[0].score_locked).toBe(false);

  vi.stubGlobal("fetch",realFetch);
  const next = await (await get()).json();
  expect(next.sourceRevision).not.toBe(read.sourceRevision);
  const olderBrowser = await post(payload(next,false));
  expect(olderBrowser.status).toBe(200);
  expect((await f.db.query("select total_points from public.founder_sprint_scores where sprint_id=$1 and profile_id=$2",[sprint,founder])).rows[0].total_points).toBe(17);
}));

test("window, objections, unavailable support and older schema cannot authorize a completion", () => withPlanningCredentialDatabase(async f => {
  const { get,post,payload,sprint,founder } = await seed(f);
  const read = await (await get()).json();
  await f.db.query("update public.sprints set review_due_at=now()+interval '20 minutes' where id=$1",[sprint]);
  expect(await (await get()).json()).toMatchObject({ decision:{status:"blocked",reason:"reviewWindow"} });
  await f.db.query("update public.sprints set review_due_at=now()-interval '1 hour' where id=$1",[sprint]);
  await f.db.query("insert into public.score_objections(sprint_id,profile_id,comment) values($1,$2,'Blocking objection')",[sprint,founder]);
  const blocked = await (await get()).json();
  expect(blocked).toMatchObject({ decision:{status:"blocked",reason:"objections"},openObjections:1 });
  const refused = await post(payload(blocked,false));
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code:"sprint_lock_objections" });
  await f.db.query("delete from public.score_objections where sprint_id=$1",[sprint]);

  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input,init);
    if (new URL(request.url).pathname.endsWith("/"+snapshotRpc)) {
      return Response.json({ code:"PGRST202", message:"Function missing" },{status:404});
    }
    return realFetch(request);
  });
  expect((await get()).status).toBe(503);
  expect((await post(payload(read,false))).status).toBe(503);
  expect((await get("ceo","")).status).toBe(200);
  expect(f.observed.filter(entry => entry.path === `/rest/v1/rpc/${commitRpc}`)).toHaveLength(0);
}));

test("a lost response is recoverable without committing a second Sprint result", () => withPlanningCredentialDatabase(async f => {
  const { get,post,payload,sprint } = await seed(f);
  const read = await (await get()).json();
  const provider = globalThis.fetch;
  let dropped = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input,init);
    const response = await provider(request);
    if (!dropped && new URL(request.url).pathname.endsWith("/"+commitRpc) && response.ok) {
      dropped = true;
      throw Error("Scripted loss after a confirmed database write");
    }
    return response;
  });
  const unknown = await post(payload(read));
  expect(dropped).toBe(true);
  expect(unknown.status).toBe(500);
  vi.stubGlobal("fetch",provider);
  const recovered = await (await get("ceo","")).json();
  expect(recovered).toMatchObject({ receipt:{sprint:{id:sprint,status:"closed",scoreLocked:true}},tasksComplete:false });
  const late = await post(payload(read));
  expect(late.status).toBe(200);
  expect(await late.json()).toMatchObject({ replayed:true,sprint:recovered.receipt.sprint });
  expect(f.observed.filter(entry => entry.path === `/rest/v1/rpc/${commitRpc}`)).toHaveLength(1);
}));
