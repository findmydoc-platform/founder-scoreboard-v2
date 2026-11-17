import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("Backlog controls and five Sprint buckets have complete independent scalar and aggregate bases", () => withPlanningCredentialDatabase(async f => {
  const sprintIds = Array.from({ length: 7 }, (_, i) => `${f.prefix}-bucket-${i}`);
  for (let i = 0; i < sprintIds.length; i++) {
    await f.db.query(`insert into public.sprints(id,project_id,name,status,start_date,end_date)
      values($1,'findmydoc-founder-execution',$2,$3,date '2026-01-01'+($4::int*7),date '2026-01-07'+($4::int*7))`,
      [sprintIds[i], `Synthetic bucket ${i}`, i === 6 ? "closed" : i === 1 ? "active" : "planning", i]);
  }
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner,sprint_id,estimate_hours)
    select $1||'-bucket-item-'||n,'findmydoc-founder-execution','Bucket scalar '||n,'deliverable',$2,'Offen','P2','approved',$3,$4,1
    from generate_series(1,1008)n`, [f.prefix, f.initiativeId, f.actors.founder.profileId, sprintIds[1]]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner,sprint_id,estimate_hours)
    values($1,'findmydoc-founder-execution','Completed hours excluded','deliverable',$2,'Erledigt','P2','approved',$3,$4,99)`,
    [`${f.prefix}-done-hours`, f.initiativeId, f.actors.founder.profileId, sprintIds[1]]);
  const { GET } = await importTestModule("src/app/api/backlog-data/route.ts", { "server-only": {} });
  const read = (area: "controls" | "sprints") => GET(f.request("founder", `/api/backlog-data?scope=${encodeURIComponent(JSON.stringify({ view: "backlog-support", area, day: "2026-01-10" }))}`));
  const controlsResponse = await read("controls"); expect(controlsResponse.status).toBe(200);
  const controls = await controlsResponse.json();
  expect(controls.model.items).toEqual([]);
  expect(controls.model.coverage.items).toBe("partial");
  expect(controls.model.controls.coverage).toBe("complete");
  const counts = (await f.db.query("select task_type,count(*)::int as total from public.active_tasks where project_id='findmydoc-founder-execution' group by task_type")).rows;
  for (const row of counts) expect(controls.model.controls.levelTotals[row.task_type]).toBe(row.total);
  expect(controls.model.controls.initiatives).toContainEqual({ value: f.initiativeId, label: "Synthetic acceptance Initiative" });
  expect(controls.model.controls.assignees).toContainEqual({ value: f.actors.founder.profileId, label: "Synthetic founder" });
  expect(controls.model.controls.statuses.deliverable).toEqual(expect.arrayContaining(["Offen", "Erledigt"]));
  const beforeResponse = await read("sprints"); expect(beforeResponse.status).toBe(200);
  const before = await beforeResponse.json(), basis = before.model.sprintBasis;
  expect(basis.coverage).toBe("complete"); expect(basis.day).toBe("2026-01-10");
  expect(basis.buckets.map((bucket: { sprint: { id: string } }) => bucket.sprint.id)).toEqual(sprintIds.slice(1, 6));
  const peopleHours = Number((await f.db.query("select coalesce(sum(weekly_capacity),0) as hours from public.profiles")).rows[0].hours);
  expect(basis.buckets[0]).toMatchObject({ plannedHours: 1008, plannedHoursComplete: true, capacityHours: Math.round(peopleHours), isCurrent: true });
  for (const body of [controls, before]) {
    expect(body.readActor).toEqual({ profileId: f.actors.founder.profileId, platformRole: "founder" });
    expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
    const receipt = body.model.controls || body.model.sprintBasis;
    expect(receipt.sourceRevision).toBeTruthy(); expect(receipt.scopeRevision).toBeTruthy();
    expect(Date.parse(receipt.validUntil)).toBeLessThanOrEqual(body.readAuthority.deadline);
  }
  const { PUT } = await importTestModule("src/app/api/sprint-commitments/route.ts", { "server-only": {} });
  const saved = await PUT(f.request("founder", "/api/sprint-commitments", "PUT", { sprintId: sprintIds[1], profileId: f.actors.founder.profileId,
    commitmentLevel: "Standard", weeklyHours: 13, note: "", expectedUpdatedAt: null }));
  expect(saved.status).toBe(200);
  const after = await (await read("sprints")).json();
  expect(after.model.sprintBasis.sourceRevision).not.toBe(basis.sourceRevision);
  expect(after.model.sprintBasis.buckets[0]).toMatchObject({ capacityHours: 13, plannedHours: 1008 });
}), 120_000);

test("a permitted commitment mutation invalidates the published Planning source while rollback preserves it", () => withPlanningCredentialDatabase(async f => {
  const sprintId = `${f.prefix}-source-sprint`;
  await f.db.query("insert into public.sprints(id,project_id,name,status) values($1,'findmydoc-founder-execution','Synthetic source Sprint','planning')", [sprintId]);
  const { GET } = await importTestModule("src/app/api/planning-source-version/route.ts", { "server-only": {} });
  const source = async () => { const response = await GET(f.request("founder", "/api/planning-source-version")); expect(response.status).toBe(200); return (await response.json()).version; };
  const before = await source();
  const { PUT } = await importTestModule("src/app/api/sprint-commitments/route.ts", { "server-only": {} });
  const response = await PUT(f.request("founder", "/api/sprint-commitments", "PUT", { sprintId, profileId: f.actors.founder.profileId,
    commitmentLevel: "Standard", weeklyHours: 13, note: "", expectedUpdatedAt: null }));
  expect(response.status).toBe(200);
  const changed = await source(); expect(changed).not.toBe(before);
  await f.db.query("begin");
  try {
    await f.db.query("update public.sprint_commitments set weekly_hours=17 where sprint_id=$1 and profile_id=$2", [sprintId, f.actors.founder.profileId]);
    expect((await f.db.query("select public.planning_source_version() as version")).rows[0].version).not.toBe(changed);
  } finally { await f.db.query("rollback"); }
  expect(await source()).toBe(changed);
}), 120_000);

test("Backlog metadata preserves mapped read roles and rejects unmapped and direct-user RPC access", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/backlog-data/route.ts", { "server-only": {} });
  for (const area of ["controls", "sprints"] as const) {
    const scope = { view: "backlog-support", area, day: "2026-01-10" };
    for (const actor of ["ceo", "deputy", "founder", "viewer", "administrator"] as const) {
      const response = await GET(f.request(actor, `/api/backlog-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.readActor).toEqual({ profileId: f.actors[actor].profileId, platformRole: actor === "administrator" ? "founder" : actor });
      expect((body.model.controls || body.model.sprintBasis).coverage).toBe("complete");
      expect(body.model.items).toEqual([]);
    }
    const denied = await GET(f.request("unmapped", `/api/backlog-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(denied.status).toBe(403); expect(await denied.json()).not.toHaveProperty("model");
    for (const actor of ["founder", "unmapped", "anonymous"] as const) {
      const response = await f.rpc("planning_backlog_support", { p_actor_profile_id: f.actors.founder.profileId, p_area: area, p_day: scope.day }, actor);
      expect(response.status).toBe(actor === "anonymous" ? 401 : 403);
    }
  }
}), 120_000);

test("Workspace Backlog controls retain user-bound authority while using grouped dispatch preparation", () => withPlanningCredentialDatabase(async f => {
  const scope={view:"backlog-support",area:"controls",day:"2026-11-17"};
  const reference=(await f.db.query("select public.planning_backlog_support($1,'controls','2026-11-17') value",[f.actors.founder.profileId])).rows[0].value;
  expect(reference.status).toBe("ready");
  const {GET}=await importTestModule("src/app/api/backlog-data/route.ts",{"server-only":{}});
  let founderDispatches:typeof f.observed=[];
  for(const actor of ["ceo","deputy","founder","viewer","administrator"] as const){
    const before=f.observed.length;
    const response=await GET(f.request(actor,`/api/backlog-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(response.status).toBe(200);const body=await response.json(),controls=body.model.controls;
    expect(Object.fromEntries(Object.keys(reference.controls).map(key=>[key,controls[key]]))).toEqual(reference.controls);
    expect(body.model.items).toEqual([]);expect(body.model.coverage.items).toBe("partial");expect(controls.coverage).toBe("complete");
    expect(body.readActor).toEqual({profileId:f.actors[actor].profileId,platformRole:actor==="administrator"?"founder":actor});
    expect(body.readAuthority.userId).toBe(f.actors[actor].userId);expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
    expect(controls.sourceRevision).toBe(reference.source_revision);expect(controls.scopeRevision).toBeTruthy();
    expect(Date.parse(controls.observedAt)).toBeLessThanOrEqual(Date.now());expect(Date.parse(controls.validUntil)).toBeLessThanOrEqual(body.readAuthority.deadline);
    const userBound=f.observed.slice(before).filter(row=>row.actor===actor&&row.path.startsWith("/rest/v1/"));
    expect(userBound.length).toBeGreaterThan(0);expect(userBound.every(row=>row.permit)).toBe(true);
    expect((await f.db.query("select count(*)::int as remaining from workspace_private.request_permits where user_id=$1",[f.actors[actor].userId])).rows[0].remaining).toBe(0);
    if(actor==="founder")founderDispatches=f.observed.slice(before);
  }
  const userBound=founderDispatches.filter(row=>row.actor==="founder"&&row.path.startsWith("/rest/v1/"));
  expect(userBound.filter(row=>row.path==="/rest/v1/rpc/current_authenticated_profile")).toHaveLength(3);
  expect(userBound.filter(row=>row.path==="/rest/v1/rpc/planning_board_publication_context")).toHaveLength(1);
  expect(founderDispatches.filter(row=>row.path==="/rest/v1/rpc/workspace_dispatch_prepare")).toHaveLength(userBound.length);
  expect(founderDispatches.filter(row=>row.path==="/rest/v1/rpc/workspace_issue_permit")).toHaveLength(0);
  expect(founderDispatches.filter(row=>row.path==="/rest/v1/rpc/workspace_access_context")).toHaveLength(1);
},"linking"),120_000);
