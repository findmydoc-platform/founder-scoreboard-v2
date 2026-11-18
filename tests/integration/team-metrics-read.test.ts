import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { teamMemberStats } from "@/features/team/model/team-profile-view-model";

test("Team aggregates retain complete association, open-priority and all-hours scopes beyond the provider page", () => withPlanningCredentialDatabase(async f => {
  const target = f.actors.other.profileId, foreign = f.actors.founder.profileId, sprint = `${f.prefix}-historical-sprint`;
  const id = (index: number) => `${f.prefix}-metric-${String(index).padStart(4, "0")}`;
  await f.db.query(`insert into public.sprints(id,project_id,name,status,start_date,end_date)
    values($1,'findmydoc-founder-execution','Historical metric scope','planning','2020-01-06','2020-01-10')`, [sprint]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner,assignee,estimate_hours,sprint_id)
    select $1||'-metric-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Associated metric work '||n,'deliverable',$2,
      'Offen','P2','approved',$3,$3,2,case when n=1008 then $4 else null end
    from generate_series(1,1008) n`, [f.prefix, f.initiativeId, target, sprint]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner,assignee,estimate_hours,sprint_id)
    values($1||'-metric-proposal','findmydoc-founder-execution','Associated proposal','deliverable',$2,'Offen','P0','proposed',$3,$3,3,null),
      ($1||'-metric-done','findmydoc-founder-execution','Completed associated work','deliverable',$2,'Erledigt','P1','approved',$3,$3,5,null),
      ($1||'-metric-child','findmydoc-founder-execution','Associated Sub-Issue','sub_issue',$5,'Offen','P1',null,$3,$3,7,null),
      ($1||'-metric-owner','findmydoc-founder-execution','Owner fallback','deliverable',$2,'Offen','P0','approved',$3,null,11,null),
      ($1||'-metric-foreign','findmydoc-founder-execution','Foreign assignee takes precedence','deliverable',$2,'Offen','P0','approved',$3,$4,13,null),
      ($1||'-metric-old-done','findmydoc-founder-execution','Completed historical Sprint work','deliverable',$2,'Erledigt','P0','approved',$3,$3,17,$6)`,
  [f.prefix, f.initiativeId, target, foreign, id(1), sprint]);

  const { createCompletePlanningReference } = await importTestModule("tests/helpers/complete-planning-reference.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reference = await createCompletePlanningReference(client).load({ authorized: true, actorProfileId: f.actors.ceo.profileId, query: { view: "complete" } });
  expect(reference.status).toBe("ready");
  if (reference.status !== "ready") throw new Error("Complete Team metric reference unavailable");
  expect(reference.model.coverage?.items).toBe("complete");
  const data = planningWorkspaceModelToPlanningShellState(reference.model);
  expect(data.tasks).toHaveLength(1016);
  const profile = data.profiles.find(person => person.id === target)!;
  const expected = { openTasks: 1011, highPriorityTasks: 3, loadHours: 2059 };
  expect(teamMemberStats(data.tasks, profile)).toEqual(expected);
  expect(data.tasks.find(task => task.id === id(1008))?.sprintId).toBe(sprint);
  expect(data.sprints.find(value => value.id === sprint)?.endDate).toBe("2020-01-10");
  expect(data.tasks.find(task => task.id === `${f.prefix}-metric-proposal`)?.approvalStatus).toBe("proposed");
  expect(data.tasks.find(task => task.id === `${f.prefix}-metric-child`)?.taskType).toBe("sub_issue");
  expect(teamMemberStats(data.tasks, data.profiles.find(person => person.id === foreign)!)).toEqual({ openTasks: 2, highPriorityTasks: 1, loadHours: 13 });
  expect(teamMemberStats(data.tasks, data.profiles.find(person => person.id === f.actors.ceo.profileId)!)).toEqual({ openTasks: 1, highPriorityTasks: 0, loadHours: 0 });

  const { GET } = await importTestModule("src/app/api/team-data/route.ts", { "server-only": {} });
  const before = f.observed.length;
  const response = await GET(f.request("ceo", "/api/team-data?area=metrics"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.model.metricsByProfileId).toBeDefined();
  expect(body.model.metricsByProfileId[target]).toEqual(expected);
  for (const person of data.profiles) expect(body.model.metricsByProfileId[person.id]).toEqual(teamMemberStats(data.tasks, person));
  expect(Object.keys(body.model.metricsByProfileId).sort()).toEqual(data.profiles.map(person => person.id).sort());
  expect(body.model.coverage).toBe("complete");
  expect(body.model.scopeRevision).toBe(reference.model.scopeRevision);
  expect(Number.isFinite(Date.parse(body.model.observedAt))).toBe(true);
  expect(body.currentProfile).toMatchObject({ id: f.actors.ceo.profileId, platformRole: "ceo" });
  expect(body.readAuthority.userId).toBe(f.actors.ceo.userId);
  expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  const claims = JSON.parse(Buffer.from(f.actors.ceo.token.split(".")[1], "base64url").toString());
  expect(body.readAuthority.deadline).toBeLessThanOrEqual(claims.exp * 1000);
  expect(body.model).not.toHaveProperty("items");
  expect(f.observed.slice(before).filter(row => ["/rest/v1/active_tasks", "/rest/v1/planning_item_strategy", "/rest/v1/planning_item_raci_assignments", "/rest/v1/task_links"].includes(row.path))).toEqual([]);
}), 120_000);
