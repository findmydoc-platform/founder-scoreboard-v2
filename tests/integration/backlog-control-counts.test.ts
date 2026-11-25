import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { buildBacklogViewModel } from "@/features/backlog/model/backlog-view-model";

test("Backlog control counts use the complete unfinished class independently of pages and filters", () => withPlanningCredentialDatabase(async f => {
  const sprintId = `${f.prefix}-counts-sprint`;
  await f.db.query("insert into public.sprints(id,project_id,name,status) values($1,'findmydoc-founder-execution','Synthetic counts Sprint','active')", [sprintId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,sort_order,approval_status,owner,assignee,sprint_id)
    select $1||'-count-item-'||n,'findmydoc-founder-execution','Count item '||n,'deliverable',$2,'Offen','P2',n,
      case when n%3=1 then 'proposed' else 'approved' end,$3,$3,case when n%3=2 then $4 else null end from generate_series(1,1008)n`,
    [f.prefix, f.initiativeId, f.actors.founder.profileId, sprintId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner)
    values($1,'findmydoc-founder-execution','Completed excluded from every scope','deliverable',$2,'Erledigt','P2','approved',$3)`,
    [`${f.prefix}-completed-count`, f.initiativeId, f.actors.founder.profileId]);
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reference = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: f.actors.founder.profileId, query: { view: "complete" } });
  expect(reference.status).toBe("ready"); if (reference.status !== "ready") throw new Error("Complete control reference unavailable");
  const full = buildBacklogViewModel({ revision: reference.model.revision, items: reference.model.items, people: reference.model.people,
    sprints: reference.model.sprints, commitments: [], coverage: { items: "complete", people: "complete", sprints: "complete", commitments: "complete" } }, "all");
  const literal = { all: 1008, proposals: 336, ready: 336, unscheduled: 672 };
  expect(full.scopeCounts).toEqual(literal); expect(full.allItems).toHaveLength(1008);
  const { GET } = await importTestModule("src/app/api/backlog-data/route.ts", { "server-only": {} });
  for (const filters of [undefined, { query: "No page matches", scope: "proposals", assignee: "Nobody" }]) {
    const scope = { view: "backlog-support", area: "controls", day: "2026-11-17", filters };
    const response = await GET(f.request("founder", `/api/backlog-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(response.status).toBe(200); const body = await response.json();
    expect(body.model.controls.scopeCounts).toEqual(full.scopeCounts); expect(body.model.controls.scopeCounts).toEqual(literal);
    expect(body.model.items).toEqual([]); expect(body.model.coverage.items).toBe("partial");
  }
}), 120_000);
