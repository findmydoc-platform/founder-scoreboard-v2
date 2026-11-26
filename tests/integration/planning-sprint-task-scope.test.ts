import { expect, test, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { buildSprintTaskTableRows, DEFAULT_SPRINT_TASK_FILTERS } from "@/features/sprint/model/sprint-task-table-view-model";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";

const scopeRoute = "/api/sprint-data";

test("Sprint separates complete selected members from all searchable other tasks and rejects a moved-assignment continuation", () => withPlanningCredentialDatabase(async f => {
  const selected = `${f.prefix}-selected`, other = `${f.prefix}-other`;
  const owner = f.actors.founder.profileId;
  const id = (index: number) => `${f.prefix}-sprint-task-${String(index).padStart(4, "0")}`;
  await f.db.query(`insert into public.sprints(id,project_id,name,start_date,end_date,review_due_at)
    values($1,'findmydoc-founder-execution','A Sprint','2000-01-01','2099-01-01',now()+interval '10 minutes'),
    ($2,'findmydoc-founder-execution','B Sprint','2099-01-02','2099-01-14',null)`, [selected, other]);
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,sort_order,approval_status,owner,assignee,sprint_id)
    select $1||'-sprint-task-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Ähnliche Aufgabe '||n,
      case when n in (1004,2012) then 'Literal %_Ä' else '' end,'deliverable',$2,'Offen',case when n=1004 then 'P0' else 'P2' end,
      n,'approved',$3,$3,case when n<=1004 then $4 when n in (2011,2012) then $5 else null end
    from generate_series(1,2012) n`, [f.prefix, f.initiativeId, owner, selected, other]);
  const { GET } = await importTestModule("src/app/api/sprint-data/route.ts", { "server-only": {} });
  const read = (scope: string, rest = "") => GET(f.request("ceo", `${scopeRoute}?scope=${scope}&sprintId=${selected}${rest}`));
  const before = f.observed.length;
  const response = await read("selected", "&query=%25_%C3%84&sort=title&direction=desc");
  expect(response.status).toBe(200);
  const selectedRead = await response.json();
  expect(selectedRead.page).toMatchObject({ sprintId: selected, scopeTotal: 1004, matchedTotal: 1, unassignedTotal: 1008,
    sprintTaskCounts: { [selected]: 1004, [other]: 2 }, continuation: null });
  expect(selectedRead.page.items.map((task: { id: string }) => task.id)).toEqual([id(1004)]);
  expect(selectedRead.model.items).toHaveLength(1004);
  expect(selectedRead.model.coverage.items).toBe("partial");
  expect(selectedRead.page.context.map((task: { id: string }) => task.id)).toEqual([`${f.prefix}-epic`, f.initiativeId]);
  expect(f.observed.slice(before).filter(row => row.path === "/rest/v1/rpc/planning_sprint_task_scope")).toHaveLength(1);
  expect(f.observed.slice(before).filter(row => row.path === "/rest/v1/rpc/planning_board_publication_context").map(row => row.actor)).toEqual(["ceo"]);
  expect(f.observed.slice(before).filter(row => row.path === "/rest/v1/active_tasks")).toEqual([]);

  expect(selectedRead.selectionBasis).toEqual(expect.any(String));
  const projectedPath = `${scopeRoute}?scope=selected&sprintId=${selected}&projection=matches&basis=${encodeURIComponent(selectedRead.selectionBasis)}`;
  const projectedBefore = f.observed.length;
  const projectedResponse = await GET(f.request("ceo", `${projectedPath}&query=%25_%C3%84&sort=title&direction=desc`));
  expect(projectedResponse.status).toBe(200);
  expect(await projectedResponse.json()).toEqual({ projection: "matches", sprintId: selected, matchedIds: [id(1004)],
    matchedTotal: 1, scopeTotal: 1004, sourceRevision: selectedRead.page.sourceRevision,
    evaluatedAt: selectedRead.page.evaluatedAt, validUntil: selectedRead.page.validUntil,
    readAuthority: selectedRead.readAuthority, readActor: selectedRead.readActor });
  const dispatches = f.observed.slice(projectedBefore);
  expect(dispatches.filter(row => row.path === "/rest/v1/rpc/planning_sprint_selected_matches")).toHaveLength(1);
  expect(dispatches.filter(row => row.path === "/rest/v1/rpc/planning_board_publication_context").map(row => row.actor)).toEqual(["ceo"]);
  expect(dispatches.filter(row => ["/rest/v1/rpc/planning_sprint_task_scope", "/rest/v1/active_tasks"].includes(row.path))).toEqual([]);
  const fullProjection = await GET(f.request("ceo", `${projectedPath}&sort=priority&direction=asc`));
  const allMembers = await fullProjection.json();
  expect(allMembers.matchedIds).toEqual([id(1004), ...Array.from({ length: 1003 }, (_, i) => id(i + 1))]);
  expect(allMembers.matchedTotal).toBe(1004);
  for (const variant of [projectedPath.replace(selected, other), `${projectedPath}x`]) {
    const invalid = await GET(f.request("ceo", variant));
    expect(invalid.status).toBe(409);
    expect(await invalid.json()).toMatchObject({ code: "stale_selection_basis" });
  }
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.parse(selectedRead.page.validUntil) + 1);
  try {
    const expired = await GET(f.request("ceo", projectedPath));
    expect(expired.status).toBe(409);
    expect(await expired.json()).toMatchObject({ code: "stale_selection_basis" });
  } finally { clock.mockRestore(); }
  const foreign = await GET(f.request("deputy", projectedPath));
  expect(foreign.status).toBe(409);
  expect(await foreign.json()).not.toHaveProperty("matchedIds");


  const { createCompletePlanningReference } = await importTestModule("tests/helpers/complete-planning-reference.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const reference = await createCompletePlanningReference(client).load({ authorized: true, actorProfileId: f.actors.ceo.profileId, query: { view: "complete" } });
  if (reference.status !== "ready") throw new Error("Complete Sprint reference unavailable");
  const data = planningWorkspaceModelToPlanningShellState(reference.model);
  const filters = { ...DEFAULT_SPRINT_TASK_FILTERS, query: "%_Ä", sort: "title" as const, direction: "desc" as const };
  expect(buildSprintTaskTableRows(data.tasks.filter(task => task.sprintId === selected), data, filters).map(task => task.id)).toEqual([id(1004)]);
  expect(buildSprintTaskTableRows(data.tasks.filter(task => task.sprintId !== selected), data, filters).map(task => task.id)).toEqual([id(2012)]);

  const assignment = await read("assignment", "&query=%25_%C3%84&sort=title&direction=desc");
  expect(assignment.status).toBe(200);
  const assignmentRead = await assignment.json();
  expect(assignmentRead).not.toHaveProperty("model");
  expect(assignmentRead).not.toHaveProperty("selectionBasis");
  expect(assignmentRead.page).toMatchObject({ matchedTotal: 1, scopeTotal: 1010, assignmentTargetsByItemId: { [id(2012)]: [selected] } });
  expect(assignmentRead.page.items.map((task: { id: string }) => task.id)).toEqual([id(2012)]);
  expect(assignmentRead.page.items[0].sprintId).toBe(other);
  const jointPath = `${scopeRoute}?scope=assignment&sprintId=${selected}&selectedBasis=${encodeURIComponent(selectedRead.selectionBasis)}`;
  const beforeJoint = f.observed.length;
  const joint = await GET(f.request("ceo", `${jointPath}&query=%25_%C3%84&sort=title&direction=desc`));
  expect(joint.status).toBe(200);
  const combined = await joint.json();
  expect(combined).toMatchObject({ selected: { status: "ready", read: { matchedIds: [id(1004)], scopeTotal: 1004, matchedTotal: 1,
    sourceRevision: selectedRead.page.sourceRevision, evaluatedAt: selectedRead.page.evaluatedAt, validUntil: selectedRead.page.validUntil,
    readActor: selectedRead.readActor, readAuthority: selectedRead.readAuthority } } });
  expect(combined.page).toEqual({ ...assignmentRead.page, evaluatedAt:selectedRead.page.evaluatedAt, validUntil:selectedRead.page.validUntil });
  expect(f.observed.slice(beforeJoint).filter(row => row.path === "/rest/v1/rpc/planning_sprint_assignment_and_selected_matches")).toHaveLength(1);
  expect(f.observed.slice(beforeJoint).filter(row => row.path === "/rest/v1/rpc/planning_board_publication_context").map(row => row.actor)).toEqual(["ceo"]);
  expect(f.observed.slice(beforeJoint).filter(row => ["/rest/v1/rpc/planning_sprint_task_scope", "/rest/v1/rpc/planning_sprint_selected_matches", "/rest/v1/active_tasks"].includes(row.path))).toEqual([]);
  const copiedBasis = await GET(f.request("viewer", jointPath));
  expect(copiedBasis.status).toBe(200);
  expect(await copiedBasis.json()).toMatchObject({page:{scope:"assignment",assignmentTargetsByItemId:{}},selected:{status:"staleSelectionBasis"}});

  const viewer = await GET(f.request("viewer", `${scopeRoute}?scope=assignment&sprintId=${selected}&query=%25_%C3%84`));
  expect((await viewer.json()).page.assignmentTargetsByItemId).toEqual({});

  const initial = (await (await read("assignment")).json()).page;
  expect(initial.items).toHaveLength(20);
  expect(initial.continuation).toBeTruthy();
  const next = (await (await read("assignment", `&continuation=${encodeURIComponent(initial.continuation)}`)).json()).page;
  expect(next.items).toHaveLength(20);
  expect(next.items.map((task: { id: string }) => task.id).some((id: string) => initial.items.some((task: { id: string }) => task.id === id))).toBe(false);
  expect((await read("assignment", `&query=new&continuation=${encodeURIComponent(initial.continuation)}`)).status).toBe(409);
  await f.db.query("update public.tasks set sprint_id=$1 where id=$2", [selected, id(2012)]);
  expect((await read("assignment", `&continuation=${encodeURIComponent(initial.continuation)}`)).status).toBe(409);
  const staleProjection = await GET(f.request("ceo", projectedPath));
  expect(staleProjection.status).toBe(409);
  expect(await staleProjection.json()).toMatchObject({ code: "stale_selection_basis" });
  const staleJoint = await GET(f.request("ceo", `${jointPath}&query=%25_%C3%84`));
  expect(staleJoint.status).toBe(200);
  expect(await staleJoint.json()).toMatchObject({page:{scope:"assignment",items:[],matchedTotal:0},selected:{status:"staleSelectionBasis"}});

  const moved = (await (await read("selected", "&query=%25_%C3%84")).json()).page;
  expect(moved.items.map((task: { id: string }) => task.id)).toEqual([id(1004), id(2012)]);
}), 120_000);

test("Sprint scoped responses fail closed if their support source or original session changes after selection", () => withPlanningCredentialDatabase(async f => {
  const selected = `${f.prefix}-selected`;
  await f.db.query(`insert into public.sprints(id,project_id,name,start_date,end_date)
    values($1,'findmydoc-founder-execution','Current Sprint','2000-01-01','2099-01-01')`, [selected]);
  const { GET } = await importTestModule("src/app/api/sprint-data/route.ts", { "server-only": {} });
  const path = `${scopeRoute}?scope=selected&sprintId=${selected}`;
  const before = await GET(f.request("deputy", path));
  expect(before.status).toBe(200);
  const { page, selectionBasis } = await before.json();
  const projectionPath = `${path}&projection=matches&basis=${encodeURIComponent(selectionBasis)}`;
  expect(page).toMatchObject({ scopeTotal: 0, matchedTotal: 0, items: [] });
  expect((await GET(f.request("unmapped", path))).status).toBe(403);
  const anonymous = f.request("deputy", path);
  anonymous.headers.delete("authorization");
  expect((await GET(anonymous)).status).toBe(401);
  const direct = await f.rpc("planning_sprint_task_scope", { p_actor_profile_id: f.actors.deputy.profileId,
    p_actor_user_id: f.actors.deputy.userId, p_session_id: f.actors.deputy.sessionId, p_platform_role: "deputy",
    p_deadline: new Date(Date.now() + 60_000).toISOString(), p_scope: "selected", p_sprint_id: selected, p_filters: {} }, "deputy");
  expect(direct.status).toBe(403);

  const upstream = globalThis.fetch;
  let transition: "support" | "revocation" | null = "support";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), response = await upstream(request);
    if (new URL(request.url).pathname !== "/rest/v1/rpc/planning_sprint_selected_matches" || !response.ok || !transition) return response;
    const at = transition;
    transition = null;
    if (at === "support") await f.db.query("insert into public.meetings(sprint_id,title,meeting_at) values($1,'Changed supporting meeting',now())", [selected]);
    else await f.db.query("delete from auth.sessions where id=$1", [f.actors.deputy.sessionId]);
    return response;
  });
  const changed = await GET(f.request("deputy", projectionPath));
  expect(changed.status).toBe(409);
  expect(await changed.json()).toMatchObject({ code: "stale_selection_basis" });
  expect(transition).toBeNull();
  const refreshed = await GET(f.request("deputy", path));
  expect(refreshed.status).toBe(200);
  const refreshedBody = await refreshed.json();
  expect(refreshedBody.page.sourceRevision).not.toBe(page.sourceRevision);
  expect(refreshedBody.model.meetings.map((meeting: { title: string }) => meeting.title)).toEqual(["Changed supporting meeting"]);
  transition = "revocation";
  const revoked = await GET(f.request("deputy", `${path}&projection=matches&basis=${encodeURIComponent(refreshedBody.selectionBasis)}`));
  expect(revoked.status).toBe(403);
  expect(await revoked.json()).not.toHaveProperty("page");
  expect(transition).toBeNull();
}, "linking"), 120_000);

test("Joint Sprint filter keeps an authorized Assignment page on a failed Selected fragment and withdraws both after session loss", () => withPlanningCredentialDatabase(async f => {
  const sprint = `${f.prefix}-selected`;
  await f.db.query(`insert into public.sprints(id,project_id,name,start_date,end_date)
    values($1,'findmydoc-founder-execution','Current Sprint','2000-01-01','2099-01-01')`,[sprint]);
  const { GET } = await importTestModule("src/app/api/sprint-data/route.ts", { "server-only": {} });
  const before = await GET(f.request("deputy", `${scopeRoute}?scope=selected&sprintId=${sprint}`));
  expect(before.status).toBe(200);
  const { selectionBasis } = await before.json();
  const path = `${scopeRoute}?scope=assignment&sprintId=${sprint}&selectedBasis=${encodeURIComponent(selectionBasis)}`;
  const transport = globalThis.fetch;
  let mode: "failure" | "source" | "revocation" = "failure";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), response = await transport(request);
    if (new URL(request.url).pathname !== "/rest/v1/rpc/planning_sprint_assignment_and_selected_matches" || !response.ok) return response;
    if (mode === "failure") {
      const payload = await response.json();
      return Response.json({ ...payload, selected:{status:"unavailable"} });
    }
    if (mode === "source") {
      await f.db.query("insert into public.meetings(sprint_id,title,meeting_at) values($1,'Changed supporting meeting',now())", [sprint]);
    } else await f.db.query("delete from auth.sessions where id=$1", [f.actors.deputy.sessionId]);
    return response;
  });
  const partial = await GET(f.request("deputy",path));
  expect(partial.status).toBe(200);
  expect(await partial.json()).toMatchObject({page:{scope:"assignment",sprintId:sprint},selected:{status:"unavailable"}});
  mode = "source";
  const stale = await GET(f.request("deputy",path));
  expect(stale.status).toBe(409);
  expect(await stale.json()).not.toHaveProperty("page");
  mode = "revocation";
  const refreshed = await (await GET(f.request("deputy",`${scopeRoute}?scope=selected&sprintId=${sprint}`))).json();
  const denied = await GET(f.request("deputy",`${scopeRoute}?scope=assignment&sprintId=${sprint}&selectedBasis=${encodeURIComponent(refreshed.selectionBasis)}`));
  expect(denied.status).toBe(403);
  expect(await denied.json()).not.toHaveProperty("selected");
}, "linking"),120_000);
