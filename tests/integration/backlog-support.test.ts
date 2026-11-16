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
