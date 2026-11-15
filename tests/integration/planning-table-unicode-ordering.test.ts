import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";
import { buildPlanningTaskTableViewModel } from "@/features/planning/model/planning-task-table-view-model";
import { isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { sortTaskTableRows } from "@/features/tasks/model/task-table-view-model";

test("canonical German table titles retain manual and priority ties in both directions", async () => {
  const composed = "äpfel", decomposed = "a\u0308pfel";
  expect(composed).not.toBe(decomposed);
  expect(composed.localeCompare(decomposed, "de"), "The complete table comparator must treat canonical titles as equal").toBe(0);
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, local, request }) => {
    const key = `${prefix}-canonical-title`;
    const rows = [
      { id: "a", title: composed, order: 2, priority: "P0" },
      { id: "b", title: decomposed, order: 1, priority: "P4" },
      { id: "c", title: composed, order: 1, priority: "P0" },
    ];
    for (const row of rows) await db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,approval_status,status,priority,sort_order)
      values($1,'findmydoc-founder-execution',$2,$3,'deliverable',$4,'approved','Offen',$5,$6)`,
    [`${key}-${row.id}`, row.title, key, initiativeId, row.priority, row.order]);
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: actors.founder.profileId, query: { view: "complete" } });
    if (complete.status !== "ready") throw new Error("Complete canonical-title table reference unavailable");
    const data = planningWorkspaceModelToPlanningShellState(complete.model);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    // Canonically equal titles leave manual order ascending in both directions.
    // Equal manual positions retain the complete source's prior priority order.
    const expected = [`${key}-c`, `${key}-b`, `${key}-a`];
    for (const direction of ["asc", "desc"] as const) {
      const filters = { ...DEFAULT_PLANNING_FILTERS, query: key, sort: "title", direction };
      const selected = buildPlanningTaskTableViewModel({ data, filters, currentProfile: data.profiles.find(profile => profile.id === actors.founder.profileId)! });
      const reference = sortTaskTableRows({ tasks: selected.visibleTasks.filter(task => task.taskType === "deliverable" && isTaskPlanningActive(task)), profiles: data.profiles, sprints: data.sprints, sort: "title", direction });
      expect(reference.map(task => task.id), `${direction}: complete persisted TypeScript and independent ties`).toEqual(expected);
      const scope = { view: "table", filters };
      const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
      expect(response.status, `${direction}: public SQL-backed table`).toBe(200);
      const { model } = await response.json();
      expect(model.table.rowIds, `${direction}: SQL and independent canonical-title ties`).toEqual(expected);
      expect(model.table.page).toMatchObject({ total: 3, loaded: 3, completeness: "complete", continuation: null });
    }
  });
}, 120_000);
