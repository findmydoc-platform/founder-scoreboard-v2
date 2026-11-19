import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";
import { buildPlanningTaskTableViewModel } from "@/features/planning/model/planning-task-table-view-model";
import { isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { sortTaskTableRows, type TaskTableSort } from "@/features/tasks/model/task-table-view-model";

test("all table sort keys and directions match complete TypeScript and independent German ordering", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, local, request }) => {
    const key = `${prefix}-table-order`, alpha = `${key}-alpha`, zulu = `${key}-zulu`;
    for (const [id, name, start] of [[alpha, "Alpha", "2030-01-01"], [zulu, "Zulu", "2030-02-01"]]) await db.query(`insert into public.sprints(id,project_id,name,start_date,end_date)
      values($1,'findmydoc-founder-execution',$2,$3,$3::date+interval '13 days')`, [id, name, start]);
    const rows = [
      { id: "a", title: "Äpfel", status: "Offen", priority: "P2", assignee: actors.founder.profileId, owner: null, sprint: zulu, fixed: "2030-03-01", order: 3 },
      { id: "b", title: "Banane", status: "In Arbeit", priority: "P0", assignee: actors.other.profileId, owner: null, sprint: alpha, fixed: "2030-02-01", order: 2 },
      { id: "c", title: "äpfel", status: "Erledigt", priority: "P1", assignee: actors.ceo.profileId, owner: null, sprint: null, fixed: null, order: 1 },
      { id: "d", title: "Aepfel", status: "Blockiert", priority: "P3", assignee: null, owner: actors.founder.profileId, sprint: alpha, fixed: "2030-01-01", order: 0 },
    ];
    for (const row of rows) await db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,approval_status,status,priority,assignee,owner,sprint_id,fixed_date,sort_order)
      values($1,'findmydoc-founder-execution',$2,$3,'deliverable',$4,'approved',$5,$6,$7,$8,$9,$10,$11)`,
    [`${key}-${row.id}`, row.title, key, initiativeId, row.status, row.priority, row.assignee, row.owner, row.sprint, row.fixed, row.order]);
    const literal: Record<TaskTableSort, { asc: string[]; desc: string[] }> = {
      title: { asc: ["d", "c", "a", "b"], desc: ["b", "a", "c", "d"] },
      status: { asc: ["d", "c", "b", "a"], desc: ["a", "b", "c", "d"] },
      assignee: { asc: ["c", "d", "a", "b"], desc: ["b", "d", "a", "c"] },
      priority: { asc: ["b", "c", "a", "d"], desc: ["d", "a", "c", "b"] },
      sprint: { asc: ["c", "d", "b", "a"], desc: ["a", "d", "b", "c"] },
      start: { asc: ["c", "d", "b", "a"], desc: ["a", "d", "b", "c"] },
      fixedDate: { asc: ["c", "d", "b", "a"], desc: ["a", "b", "d", "c"] },
    };
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: actors.founder.profileId, query: { view: "complete" } });
    if (complete.status !== "ready") throw new Error("Complete table sort reference unavailable");
    const data = planningWorkspaceModelToPlanningShellState(complete.model);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    for (const sort of Object.keys(literal) as TaskTableSort[]) for (const direction of ["asc", "desc"] as const) {
      const filters = { ...DEFAULT_PLANNING_FILTERS, query: key, sort, direction };
      const selected = buildPlanningTaskTableViewModel({ data, filters, currentProfile: data.profiles.find(profile => profile.id === actors.founder.profileId)! });
      const reference = sortTaskTableRows({ tasks: selected.visibleTasks.filter(task => task.taskType === "deliverable" && isTaskPlanningActive(task)), profiles: data.profiles, sprints: data.sprints, sort, direction });
      const expected = literal[sort][direction].map(id => `${key}-${id}`);
      expect(reference.map(task => task.id), `${sort}/${direction}: complete persisted TypeScript`).toEqual(expected);
      const query = { view: "table", filters };
      const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
      expect(response.status, `${sort}/${direction}: public SQL result`).toBe(200);
      const table = (await response.json()).model.table;
      expect(table.rowIds, `${sort}/${direction}: SQL and independent literal`).toEqual(expected);
      expect(table.page).toMatchObject({ total: 4, loaded: 4, completeness: "complete", continuation: null });
    }
  });
}, 120_000);
