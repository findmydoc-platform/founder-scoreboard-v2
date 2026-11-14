import { expect, test, vi } from "vitest";
import fixture from "../fixtures/planning-reads/contract.json";
import materialized from "../fixtures/planning-reads/materialized-deliverables.json";
import { DEFAULT_PLANNING_FILTERS, normalizePlanningBoardQuery } from "@/features/planning/model/planning-board-query";
import { buildPlanningTaskTableViewModel } from "@/features/planning/model/planning-task-table-view-model";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { PlanningFilterPreferences, PlanningShellState, Task } from "@/lib/types";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { createClient } from "@supabase/supabase-js";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";

test("real Deliverable selection preserves the frozen complete reference and independent literal expectations before its page limit", async () => {
  await withPlanningCredentialDatabase(async ({ db, local }) => {
    const taskIds = fixture.tasks.map(task => task.id), profileIds = fixture.profiles.map(profile => profile.id), sprintIds = fixture.sprints.map(sprint => sprint.id);
    expect((await db.query("select id from public.tasks where id=any($1) union all select id from public.profiles where id=any($2) union all select id from public.sprints where id=any($3)", [taskIds, profileIds, sprintIds])).rows).toEqual([]);
    await db.query("begin");
    try {
      for (const profile of fixture.profiles) await db.query("insert into public.profiles(id,name,platform_role) values($1,$2,$3)", [profile.id, profile.name, profile.platformRole]);
      for (const sprint of fixture.sprints) await db.query("insert into public.sprints(id,project_id,name,status,start_date,end_date) values($1,'findmydoc-founder-execution',$2,$3,$4,$5)", [sprint.id, sprint.name, sprint.status, sprint.startDate, sprint.endDate]);
      const tasks = fixture.tasks.map(task => ({ ...fixture.taskDefaults, ...task })) as Task[];
      for (const task of tasks) {
        await db.query(`insert into public.tasks(id,project_id,title,description,status,priority,assignee,owner,workstream,fixed_date,target_date,definition_of_done,task_type,parent_task_id,approval_status,sprint_id,review_status,review_owner_profile_id,score_final,github_repo,github_issue_number,github_issue_url,issue_number,issue_url,evidence_link,sort_order)
          values($1,'findmydoc-founder-execution',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
        [task.id, task.title, task.description, task.status, task.priority, task.assigneeId || null, task.ownerId || null, task.workstream, task.fixedDate || null, task.targetDate || null, task.definitionOfDone, task.taskType, task.parentTaskId || null, task.approvalStatus, task.sprintId || null, task.reviewStatus, task.reviewOwnerProfileId || null, task.scoreFinal, task.githubRepo || null, task.githubIssueNumber, task.githubIssueUrl || null, String(task.issueNumber || ""), task.issueUrl || null, task.evidenceLink || null, task.order]);
        if (task.strategy) await db.query("insert into public.planning_item_strategy(task_id,goal) values($1,$2)", [task.id, task.strategy.goal]);
        if (task.dependsOn) await db.query("insert into public.task_dependencies(task_id,note) values($1,$2)", [task.id, task.dependsOn]);
        await db.query("set local session_replication_role = replica");
        await db.query("update public.tasks set updated_at=$2 where id=$1", [task.id, task.updatedAt]);
        await db.query("set local session_replication_role = origin");
      }
      for (const edge of fixture.relationships) await db.query("insert into public.task_relationship_edges(task_id,related_task_id,relation_type) values($1,$2,$3)", [edge.taskId, edge.relatedTaskId, edge.relationType]);
      const data = { ...emptyPlanningShellState, tasks, profiles: fixture.profiles, sprints: fixture.sprints, taskRelations: fixture.relationships } as PlanningShellState;
      const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
      const { projectPlanningBoard } = await importTestModule("src/features/planning/server/planning-board-projection.ts", { "server-only": {} });
      const legacyClient = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      // The public provider cannot see this transaction's uncommitted fixture.
      // Commit only this isolated fixture before observing the complete legacy
      // source. The finally block removes these exact fixed synthetic identities.
      await db.query("commit");
      const legacy = await loadPlanningWorkspaceModel(legacyClient, { authorized: true, actorProfileId: fixture.profiles[0].id, query: { view: "complete" } });
      expect(legacy.status).toBe("ready");
      if (legacy.status !== "ready") throw new Error("Complete legacy database reference was unavailable");
      const legacyData = planningWorkspaceModelToPlanningShellState(legacy.model);
      vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(fixture.evaluationTime));
      try {
        for (const example of fixture.searchCases) {
          const filters = { ...DEFAULT_PLANNING_FILTERS, ...example.filters } as PlanningFilterPreferences;
          const reference = buildPlanningTaskTableViewModel({ data, filters, currentProfile: data.profiles[0], includeAssignedSubIssueParents: true }).visibleTasks.filter(task => task.taskType === "deliverable").map(task => task.id);
          expect(reference, example.name).toEqual(example.ids);
          const legacyReference = buildPlanningTaskTableViewModel({ data: legacyData, filters, currentProfile: legacyData.profiles.find(profile => profile.id === fixture.profiles[0].id)!, includeAssignedSubIssueParents: true }).visibleTasks.filter(task => task.taskType === "deliverable");
          const overrides = materialized.caseOverrides as Record<string, { ids: string[] }>;
          const expectedIds = overrides[example.name]?.ids || example.ids;
          expect(legacyReference.map(task => task.id), `${example.name}: independent persisted membership`).toEqual(expectedIds);
          const legacyBoard = projectPlanningBoard(legacy.model, { authorized: true, actorProfileId: fixture.profiles[0].id, query: { filters } });
          expect(legacyBoard.status).toBe("ready");
          if (legacyBoard.status !== "ready") throw new Error("Complete legacy Board reference was unavailable");
          const expectedOrder = materialized.boardOrder.filter(id => expectedIds.includes(id));
          expect(legacyBoard.model.board!.cardIds, `${example.name}: independent persisted Board order`).toEqual(expectedOrder);
          const result = (await db.query("select public.planning_deliverable_selection($1,$2,null,0,20,null,$3) as selection", [fixture.profiles[0].id, normalizePlanningBoardQuery({ filters }), fixture.evaluationTime])).rows[0].selection;
          expect(result.status, example.name).toBe("ready");
          expect(result.card_ids, `${example.name}: actual SQL against legacy projection and independent order`).toEqual(expectedOrder);
          expect(result.metrics.total, example.name).toBe(expectedIds.length);
          expect(result.rows.every((row: { id: string }) => result.context_ids.includes(row.id))).toBe(true);
        }
      } finally { vi.useRealTimers(); }
    } finally {
      await db.query("rollback");
      await db.query("select set_config('founderops.trash_lifecycle_write','on',false)");
      await db.query("delete from public.tasks where id=any($1)", [taskIds]);
      await db.query("delete from public.sprints where id=any($1)", [sprintIds]);
      await db.query("delete from public.profiles where id=any($1)", [profileIds]);
    }
  });
}, 120_000);

test("real SQL selects before all card and provider boundaries and traverses stable completed ties without omissions", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors }) => {
    for (const size of [19, 20, 21, 999, 1000, 1001, 1027]) {
      await db.query("begin");
      try {
        const key = `${prefix}-boundary`;
        await db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,approval_status,status,priority,assignee,sort_order)
          select $1||'-'||lpad(n::text,4,'0'),'findmydoc-founder-execution',case when n=$4-1 then $1||' 100%_ready\\[x]' else $1||' ordinary' end,
            repeat('Synthetic long content ',100),'deliverable',$2,'approved','Erledigt',case when n%2=0 then 'P0' else 'P4' end,$3,n/3
          from generate_series(0,$4::integer-1) n`, [key, initiativeId, actors.founder.profileId, size]);
        await db.query("set local session_replication_role = replica");
        await db.query("update public.tasks set updated_at='2020-01-01T00:00:00Z' where id like $1", [`${key}-%`]);
        await db.query("set local session_replication_role = origin");
        const query = normalizePlanningBoardQuery({ filters: { query: key, status: "Erledigt" } });
        const select = async (offset = 0, source: string | null = null, evaluatedAt: string | null = null) => (await db.query("select public.planning_deliverable_selection($1,$2,'Erledigt',$3,20,$4,$5) as selection", [actors.founder.profileId, query, offset, source, evaluatedAt])).rows[0].selection;
        const first = await select();
        expect(first.status).toBe("ready");
        expect(first.columns.Erledigt.total).toBe(size);
        expect(first.card_ids).toEqual(Array.from({ length: Math.min(size, 20) }, (_, index) => `${key}-${String(index).padStart(4, "0")}`));
        expect(first.rows).toHaveLength(Math.min(size, 20) + 2);
        expect(first.rows.every((row: Record<string, unknown>) => !("description" in row) && !("definition_of_done" in row) && !("creation_request_payload" in row))).toBe(true);
        const ids: string[] = [];
        for (let offset = 0; offset < size; offset += 20) {
          const page = offset === 0 ? first : await select(offset, first.source_revision, first.evaluated_at);
          expect(page.status).toBe("ready"); ids.push(...page.card_ids);
        }
        expect(ids).toEqual(Array.from({ length: size }, (_, index) => `${key}-${String(index).padStart(4, "0")}`));
        expect(new Set(ids).size).toBe(size);
        const literal = (await db.query("select public.planning_deliverable_selection($1,$2,'Erledigt',0,20,null,null) as selection", [actors.founder.profileId, normalizePlanningBoardQuery({ filters: { query: "100%_ready\\[x]", status: "Erledigt" } })])).rows[0].selection;
        expect(literal.card_ids).toEqual([`${key}-${String(size - 1).padStart(4, "0")}`]);
        await db.query("update public.tasks set sort_order=10000 where id=$1", [`${key}-0000`]);
        expect((await select(20, first.source_revision, first.evaluated_at)).status).toBe("staleContinuation");
      } finally { await db.query("rollback"); }
    }
  });
}, 120_000);

test("the real Board API selects bounded completed history, rejects stale continuation and retains live authority and permit cleanup", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, observed, request, rpc }) => {
    for (let index = 0; index < 21; index++) await db.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,assignee,sort_order) values($1,'findmydoc-founder-execution',$2,'deliverable',$3,'approved','Erledigt','P2',$4,$5)", [`${prefix}-done-${String(index).padStart(2, "0")}`, `${prefix} synthetic completed`, initiativeId, actors.founder.profileId, index]);
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      await db.query("update public.tasks set updated_at='2020-01-01T00:00:00Z' where id like $1", [`${prefix}-done-%`]);
      await db.query("commit");
    } catch (error) { await db.query("rollback"); throw error; }
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const query = { view: "board", column: "Erledigt", filters: { query: prefix } };
    const read = (actor: Parameters<typeof request>[0], scope = query) => GET(request(actor, `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    const first = await read("founder");
    expect(first.status).toBe(200);
    const firstPage = await first.json();
    expect(firstPage.model.board.cardIds).toEqual(Array.from({ length: 20 }, (_, index) => `${prefix}-done-${String(index).padStart(2, "0")}`));
    expect(firstPage.model.board.columns.Erledigt).toMatchObject({ total: 21, loaded: 20, completeness: "partial" });
    expect(observed.some(entry => entry.path.endsWith("/rpc/planning_deliverable_selection"))).toBe(true);
    expect(observed.some(entry => entry.path.endsWith("/active_tasks"))).toBe(false);
    const continuation = firstPage.model.board.columns.Erledigt.continuation;
    const second = await read("founder", { ...query, continuation } as typeof query);
    expect(second.status).toBe(200);
    expect((await second.json()).model.board.cardIds).toEqual([`${prefix}-done-20`]);
    await db.query("update public.tasks set title=title || ' same-count change' where id=$1", [`${prefix}-done-20`]);
    expect((await read("founder", { ...query, continuation } as typeof query)).status).toBe(409);
    for (const role of ["ceo", "deputy", "viewer"] as const) expect((await read(role)).status).toBe(200);
    expect((await read("unmapped")).status).toBe(403);
    expect((await GET(request("founder", "/api/planning-board-data?scope=invalid"))).status).toBe(400);
    for (const actor of ["anonymous", "founder", "unmapped"] as const) expect((await rpc("planning_deliverable_selection", { p_actor_profile_id: actors.founder.profileId, p_query: normalizePlanningBoardQuery() }, actor)).ok).toBe(false);
    await db.query("delete from auth.sessions where id=$1", [actors.founder.sessionId]);
    expect((await read("founder")).status).toBeGreaterThanOrEqual(400);
    expect((await db.query("select count(*)::int as count from workspace_private.request_permits where user_id=any($1)", [Object.values(actors).map(actor => actor.userId)])).rows[0].count).toBe(0);
  });
}, 120_000);
