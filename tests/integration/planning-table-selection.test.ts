import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";
import { buildPlanningTaskTableViewModel } from "@/features/planning/model/planning-task-table-view-model";
import { isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { sortTaskTableRows } from "@/features/tasks/model/task-table-view-model";
import { normalizeStatus } from "@/lib/status";

test("the table pages its own Deliverable scope with the complete stable sort chain and no personal foreign-parent inclusion", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, local, request, observed }) => {
    const key = `${prefix}-table-selection`, title = "Synthetic Table %_needle";
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,assignee,sort_order)
      select $1||'-'||lpad(n::text,4,'0'),'findmydoc-founder-execution',
        case when n>1000 then $4 else 'Synthetic unrelated Deliverable' end,
        'deliverable',$2,'approved','Offen',case when n=1002 then 'P4' else 'P0' end,$3,
        case when n=1001 then 9 else 2 end from generate_series(1,1004) n`, [key, initiativeId, actors.founder.profileId, title]);
    await db.query("update public.tasks set status='Review',review_status='requested',review_owner_profile_id=$2,evidence_link='https://example.test/synthetic-review-evidence',review_requested_at=now() where id=$1", [`${key}-0001`, actors.ceo.profileId]);
    const foreign = `${key}-foreign`, child = `${key}-assigned-child`, draft = `${key}-draft`, epic = `${key}-stored-board-epic`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,assignee)
      values($1,'findmydoc-founder-execution',$2,'deliverable',$3,'approved','Offen','P0',$4),
        ($5,'findmydoc-founder-execution',$2,'deliverable',$3,'draft','Offen','P0',$6)`, [foreign, title, initiativeId, actors.other.profileId, draft, actors.founder.profileId]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,assignee)
      values($1,'findmydoc-founder-execution',$2,'sub_issue',$3,'Offen','P0',$4)`, [child, title, foreign, actors.founder.profileId]);
    await db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,assignee)
      values($1,'findmydoc-founder-execution',$2,'epic','Pausiert','P0',$3)`, [epic, title, actors.founder.profileId]);
    const filters = { ...DEFAULT_PLANNING_FILTERS, query: "Table %_needle", quick: ["mine"], sort: "title", direction: "asc" as const };
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const complete = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: actors.founder.profileId, query: { view: "complete" } });
    if (complete.status !== "ready") throw new Error("Complete table reference unavailable");
    const data = planningWorkspaceModelToPlanningShellState(complete.model);
    const selected = buildPlanningTaskTableViewModel({ data, filters, currentProfile: data.profiles.find(profile => profile.id === actors.founder.profileId)!, includeAssignedSubIssueParents: false });
    const rows = sortTaskTableRows({ tasks: selected.visibleTasks.filter(task => task.taskType === "deliverable" && isTaskPlanningActive(task)), profiles: data.profiles, sprints: data.sprints, sort: "title", direction: "asc" });
    const expected = [1003, 1004, 1002, 1001].map(index => `${key}-${index}`);
    expect(rows.map(row => row.id)).toEqual(expected);
    // The existing Table dropdown uses the complete, unfiltered Item scope,
    // including strategic context, in first-occurrence source order.
    const statusOptions = Array.from(new Set(data.tasks.map(item => normalizeStatus(item.status))));
    expect(statusOptions).toEqual(["Offen", "Pausiert", "Review"]);

    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    // The remembered strategic Board context must not become table membership.
    const query = { view: "table", level: "epic", parentId: epic, filters, limit: 2 };
    const before = observed.length;
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(response.status).toBe(200);
    const { model } = await response.json();
    expect(model.table?.rowIds ?? model.board?.cardIds).toEqual(expected.slice(0, 2));
    expect(model).toHaveProperty("table");
    expect(model.table.page).toMatchObject({ total: 4, loaded: 2, completeness: "partial" });
    expect(model.table.page.continuation).toEqual(expect.any(String));
    expect(model.coverage.items).toBe("partial");
    expect(model.table.statusOptions).toEqual(statusOptions);
    expect(model.items.some((item: { id: string }) => [foreign, child, draft, epic].includes(item.id))).toBe(false);
    const next = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({ ...query, continuation: model.table.page.continuation }))}`));
    expect(next.status).toBe(200);
    const page = (await next.json()).model.table;
    expect(page.rowIds).toEqual(expected.slice(2));
    expect(page.page).toMatchObject({ total: 4, loaded: 2, completeness: "complete", continuation: null });
    expect([...model.table.rowIds, ...page.rowIds]).toEqual(expected);
    expect(observed.slice(before).some(entry => /\/(active_tasks|tasks)$/.test(entry.path))).toBe(false);
    const denied = await GET(request("unmapped", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
    expect(denied.status).toBe(403);
    expect(await denied.json()).not.toHaveProperty("model");
  });
}, 120_000);
