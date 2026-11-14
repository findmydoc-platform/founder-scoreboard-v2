import { expect, test, vi } from "vitest";
import { DEFAULT_PLANNING_FILTERS, normalizePlanningBoardQuery } from "@/features/planning/model/planning-board-query";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { createClient } from "@supabase/supabase-js";

test("the actual selected API preserves saved personal defaults and discovers options outside hydrated cards", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const root = `${prefix}-personal-parent`, child = `${prefix}-personal-child`, hidden = `${prefix}-hidden`, otherInitiative = `${prefix}-other-initiative`, sprint = `${prefix}-other-sprint`;
    const epic = (await db.query("select parent_task_id from public.tasks where id=$1", [initiativeId])).rows[0].parent_task_id;
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,assignee,owner,workstream) values($1,'findmydoc-founder-execution',$2,'deliverable','Offen','P1','approved',$3,$4,$4,'Visible workstream')", [root, `${prefix} personal parent`, initiativeId, actors.other.profileId]);
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,parent_task_id,owner) values($1,'findmydoc-founder-execution','Synthetic personal child','sub_issue','Offen','P0',$2,$3)", [child, root, actors.founder.profileId]);
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner) values($1,'findmydoc-founder-execution','Off-page Initiative','initiative','Offen','P2','approved',$2,$3)", [otherInitiative, epic, actors.other.profileId]);
    await db.query("insert into public.sprints(id,project_id,name,start_date,end_date) values($1,'findmydoc-founder-execution','Off-page Sprint','2030-01-01','2030-01-14')", [sprint]);
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,assignee,owner,workstream,sprint_id) values($1,'findmydoc-founder-execution',$2,'deliverable','Erledigt','P4','approved',$3,$4,$4,'Off-page workstream',$5)", [hidden, `${prefix} hidden completed`, otherInitiative, actors.other.profileId, sprint]);
    await db.query("insert into public.profile_ui_preferences(profile_id,default_workspace,default_task_view,planning_filters) values($1,'planning','board',$2)", [actors.founder.profileId, { ...DEFAULT_PLANNING_FILTERS, query: prefix, priority: "P1", quick: ["mine"] }]);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const read = (scope: unknown) => GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    const response = await read({ view: "board" }); expect(response.status).toBe(200);
    const initial = (await response.json()).model;
    expect(initial.query.filters).toMatchObject({ query: prefix, priority: "P1", assignee: "Alle", quick: ["mine"] });
    expect(initial.board.cardIds).toEqual([root]);
    expect(initial.board.viewerOpenSubIssueIdsByDeliverableId).toEqual({ [root]: [child] });
    expect(initial.items.some((item: { id: string }) => [child, hidden, otherInitiative].includes(item.id))).toBe(false);
    expect(initial.board.workstreams).toEqual(["Off-page workstream", "Visible workstream"]);
    expect(initial.board.initiativeOptions).toEqual([{ id: initiativeId, title: "Synthetic acceptance Initiative" }, { id: otherInitiative, title: "Off-page Initiative" }]);
    expect(initial.sprints.some((value: { id: string }) => value.id === sprint)).toBe(true);
    expect(observed.some(value => value.path.endsWith("/active_tasks"))).toBe(false);
    const explicit = await read({ view: "board", filters: { query: prefix, status: "Erledigt", assignee: actors.other.profileId } }); expect(explicit.status).toBe(200);
    expect((await explicit.json()).model.board.cardIds).toEqual([hidden]);
    await db.query("update public.profile_ui_preferences set default_task_view='table' where profile_id=$1", [actors.founder.profileId]);
    const complete = await read({}); expect(complete.status).toBe(200);
    const completeModel = (await complete.json()).model;
    expect(completeModel.board).toBeUndefined();
    expect(completeModel.coverage.items).toBe("complete");
    expect(completeModel.items.map((item: { id: string }) => item.id)).toEqual(expect.arrayContaining([root, child, hidden]));
  });
}, 120_000);

test("selection continuations reject every contributing source change but do not pretend to observe discussion", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors }) => {
    const root = `${prefix}-source`, related = `${prefix}-related`;
    for (const id of [root, related]) await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner) values($1,'findmydoc-founder-execution',$2,'deliverable','Offen','P2','approved',$3,$4)", [id, id, initiativeId, actors.founder.profileId]);
    await db.query("insert into public.task_relationship_edges(task_id,related_task_id,relation_type) values($1,$2,'blocked_by')", [root, related]);
    const query = normalizePlanningBoardQuery({ filters: { query: root } });
    const select = async (revision: string | null = null) => (await db.query("select public.planning_deliverable_selection($1,$2,'Offen',0,20,$3,null) as selection", [actors.founder.profileId, query, revision])).rows[0].selection;
    const changes: [string, unknown[]][] = [
      ["update public.tasks set title=title||' same-count' where id=$1", [root]],
      ["insert into public.planning_item_strategy(task_id,goal) values($1,'Synthetic changed goal')", [initiativeId]],
      ["insert into public.planning_item_raci_assignments(task_id,profile_id,role) values($1,$2,'accountable')", [initiativeId, actors.founder.profileId]],
      ["update public.task_relationship_edges set note='Synthetic changed relation' where task_id=$1", [root]],
      ["insert into public.task_links(task_id,type,label,url) values($1,'evidence','Synthetic','https://example.test/evidence')", [root]],
      ["insert into public.task_dependencies(task_id,note) values($1,'Synthetic changed dependency')", [root]],
      ["insert into public.task_blockers(task_id,profile_id,reason) values($1,$2,'Synthetic changed blocker')", [root, actors.founder.profileId]],
      ["update public.profiles set focus='Synthetic changed focus' where id=$1", [actors.founder.profileId]],
      ["insert into public.sprints(id,project_id,name) values($1,'findmydoc-founder-execution','Synthetic source Sprint')", [`${prefix}-sprint`]],
      ["insert into public.profile_ui_preferences(profile_id,expanded_item_ids) values($1,array[$2])", [actors.founder.profileId, root]],
      ["update auth.identities set identity_data=jsonb_set(identity_data,'{picture}','\"https://example.test/avatar.png\"') where user_id=$1 and provider='google'", [actors.founder.userId]],
    ];
    for (const [sql, values] of changes) {
      const previous = await select(); expect(previous.status).toBe("ready");
      await db.query(sql, values);
      expect((await select(previous.source_revision)).status, sql).toBe("staleContinuation");
      expect((await select()).source_revision, sql).not.toBe(previous.source_revision);
    }
    const beforeComment = await select();
    await db.query("insert into public.task_comments(task_id,profile_id,comment,github_delivery_applicable) values($1,$2,'Synthetic separate discussion',false)", [root, actors.founder.profileId]);
    expect((await select(beforeComment.source_revision)).status).toBe("ready");
  });
}, 120_000);

test("real SQL week membership has inclusive boundaries and an expired temporal continuation without a source write", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors }) => {
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), sprint = `${prefix}-time-sprint`, id = `${prefix}-time-card`;
    const start = new Date(`${yesterday}T00:00:00Z`); start.setUTCDate(start.getUTCDate() - 7);
    await db.query("insert into public.sprints(id,project_id,name,start_date,end_date) values($1,'findmydoc-founder-execution','Synthetic temporal Sprint',$2,$3)", [sprint, start.toISOString().slice(0, 10), yesterday]);
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,sprint_id) values($1,'findmydoc-founder-execution',$1,'deliverable','Offen','P2','approved',$2,$3,$4)", [id, initiativeId, actors.founder.profileId, sprint]);
    const query = normalizePlanningBoardQuery({ filters: { query: id, quick: ["week"] } });
    const select = async (at: string, source: string | null = null) => (await db.query("select public.planning_deliverable_selection($1,$2,'Offen',0,20,$3,$4) as selection", [actors.founder.profileId, query, source, at])).rows[0].selection;
    const inclusive = await select(`${yesterday}T00:00:00.000Z`);
    if (!Array.isArray(inclusive.card_ids)) {
      const probe = (await db.query(`select
        exists(select 1 from public.profiles where id=$1 and auth_user_id=$2) as actor_bound,
        $3::jsonb #>> '{filters,query}' = $4 as query_bound,
        $5::timestamptz <= statement_timestamp() as expired,
        public.planning_deliverable_column($1,array[$4]::text[],$6,$7,$5)->>'status' as column_status`,
      [actors.founder.profileId, actors.founder.userId, query, id, inclusive.valid_until, inclusive.source_revision, inclusive.evaluated_at])).rows[0];
      throw new Error(`Temporal selection protocol mismatch: ${JSON.stringify({
        topStatus: ["ready", "forbidden", "staleContinuation"].includes(inclusive.status) ? inclusive.status : "other",
        hasCardIds: false, validUntilExpired: probe.expired === true,
        directColumnStatus: ["ready", "forbidden", "staleContinuation"].includes(probe.column_status) ? probe.column_status : "other",
        actorBound: probe.actor_bound === true, queryBound: probe.query_bound === true,
      })}`);
    }
    expect(inclusive.card_ids).toEqual([id]);
    expect(Date.parse(inclusive.valid_until)).toBe(Date.parse(`${yesterday}T00:00:00.001Z`));
    expect((await select(`${yesterday}T00:00:00.001Z`)).card_ids).toEqual([]);
    expect((await select(inclusive.evaluated_at, inclusive.source_revision)).status).toBe("staleContinuation");
    expect((await select(`${yesterday}T00:00:00.001Z`)).source_revision).toBe(inclusive.source_revision);
    const weekStart = new Date(start); weekStart.setUTCDate(weekStart.getUTCDate() - 7);
    expect((await select(new Date(weekStart.getTime() - 1).toISOString())).card_ids).toEqual([]);
    expect((await select(weekStart.toISOString())).card_ids).toEqual([id]);
  });
}, 120_000);

test("a session revoked after selection cannot publish selected cards or retain a dispatch permit", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request }) => {
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner) values($1,'findmydoc-founder-execution',$1,'deliverable','Offen','P2','approved',$2,$3)", [`${prefix}-revoked-card`, initiativeId, actors.founder.profileId]);
    const transport = globalThis.fetch; let revoked = false;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), response = await transport(request);
      if (!revoked && new URL(request.url).pathname.endsWith("/rpc/planning_deliverable_selection")) { revoked = true; await db.query("delete from auth.sessions where id=$1", [actors.founder.sessionId]); }
      return response;
    });
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({ view: "board", filters: { query: prefix } }))}`));
    expect(revoked).toBe(true); expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await response.json()).model).toBeUndefined();
    expect((await db.query("select count(*)::int as count from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].count).toBe(0);
  });
}, 120_000);

test("real active ordering and completed personal parents preserve manual ties ownership precedence and parent filters", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors }) => {
    const active = [
      ["c", "P2", 0], ["a", "P0", 10], ["b", "P0", 2], ["d", "P0", 2], ["e", "P4", 1], ["f", "Urgent", -3],
    ] as const;
    for (const [suffix, priority, order] of active) await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,assignee,sort_order) values($1,'findmydoc-founder-execution',$1,'deliverable','Offen',$2,'approved',$3,$4,$5)", [`${prefix}-active-${suffix}`, priority, initiativeId, actors.other.profileId, order]);
    const selected = async (filters: Parameters<typeof normalizePlanningBoardQuery>[0], column: string, revision: string | null = null) => (await db.query("select public.planning_deliverable_selection($1,$2,$3,0,20,$4,null) as selection", [actors.founder.profileId, normalizePlanningBoardQuery(filters), column, revision])).rows[0].selection;
    expect((await selected({ filters: { query: `${prefix}-active` } }, "Offen")).card_ids).toEqual(["b", "d", "a", "c", "e", "f"].map(suffix => `${prefix}-active-${suffix}`));
    const parent = `${prefix}-personal-old`, precedence = `${prefix}-personal-assignee-wins`, child = `${prefix}-assigned-child`;
    for (const [id, owner] of [[parent, actors.other.profileId], [precedence, actors.founder.profileId]]) await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,assignee,owner) values($1,'findmydoc-founder-execution',$1,'deliverable','Offen','P1','approved',$2,$3,$4)", [id, initiativeId, actors.other.profileId, owner]);
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,parent_task_id,owner) values($1,'findmydoc-founder-execution','Synthetic assigned child','sub_issue','Offen','P0',$2,$3)", [child, parent, actors.founder.profileId]);
    await db.query("update public.tasks set status='Erledigt' where id=any($1)", [[parent, precedence]]);
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      await db.query("update public.tasks set updated_at='2020-01-01T00:00:00Z' where id=$1", [parent]);
      await db.query("commit");
    } catch (error) { await db.query("rollback"); throw error; }
    const query = { filters: { query: `${prefix}-personal`, quick: ["mine"], priority: "P1" } };
    const first = await selected(query, "Erledigt");
    expect(first.card_ids).toEqual([parent]);
    expect(first.personal_children).toEqual({ [parent]: [child] });
    expect(first.rows.some((row: { id: string }) => row.id === child || row.id === precedence)).toBe(false);
    expect((await selected({ filters: { ...query.filters, priority: "P0" } }, "Erledigt")).card_ids).toEqual([]);
    await db.query("update public.tasks set status='Erledigt' where id=$1", [child]);
    expect((await selected(query, "Erledigt", first.source_revision)).status).toBe("staleContinuation");
    expect((await selected(query, "Erledigt")).card_ids).toEqual([]);
  });
}, 120_000);

test("selected records search discovery relationships and summaries stay within the active Planning project", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request }) => {
    const project = `${prefix}-excluded-project`, foreignEpic = `${prefix}-foreign-epic`, foreignInitiative = `${prefix}-foreign-initiative`, foreignCard = `${prefix}-foreign-card`;
    const archived = `${prefix}-archived-initiative`, archivedCard = `${prefix}-archived-card`, cross = `${prefix}-scope-cross-parent`, archiveChild = `${prefix}-scope-archive-child`, target = `${prefix}-scope-target`;
    try {
      await db.query("insert into public.projects(id,name) values($1,'Synthetic excluded project')", [project]);
      await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner) values($1,$2,'Excluded foreign Epic','epic','Offen',null,$3)", [foreignEpic, project, actors.other.profileId]);
      await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,workstream) values($1,$2,'Excluded foreign ancestor','initiative','Offen','P2','approved',$3,$4,'Excluded foreign workstream')", [foreignInitiative, project, foreignEpic, actors.other.profileId]);
      await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,workstream) values($1,$2,'Excluded foreign card','deliverable','Offen','P2','approved',$3,$4,'Excluded foreign workstream')", [foreignCard, project, foreignInitiative, actors.other.profileId]);
      const epic = (await db.query("select parent_task_id from public.tasks where id=$1", [initiativeId])).rows[0].parent_task_id;
      await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,workstream) values($1,'findmydoc-founder-execution','Excluded archived ancestor','initiative','Offen','P2','approved',$2,$3,'Excluded archived workstream')", [archived, epic, actors.other.profileId]);
      for (const [id, parent] of [[cross, foreignInitiative], [archiveChild, archived], [target, initiativeId], [archivedCard, initiativeId]]) await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,workstream) values($1,'findmydoc-founder-execution',$2,'deliverable','Offen','P2','approved',$3,$4,$5)", [id, id === archivedCard ? "Excluded archived card" : "Scope accessible", parent, actors.founder.profileId, id === archivedCard ? "Excluded archived workstream" : "In scope"]);
      for (const related of [target, foreignCard, archivedCard]) await db.query("insert into public.task_relationship_edges(task_id,related_task_id,relation_type,note) values($1,$2,'blocked_by','Synthetic scope edge')", [cross, related]);
      for (const related of [foreignCard, archivedCard]) await db.query("insert into public.task_relationship_edges(task_id,related_task_id,relation_type,note) values($1,$2,'blocked_by','Synthetic excluded wait')", [archiveChild, related]);
      for (const excludedSource of [foreignCard, archivedCard]) await db.query("insert into public.task_relationship_edges(task_id,related_task_id,relation_type,note) values($1,$2,'blocked_by','Synthetic excluded incoming wait')", [excludedSource, archiveChild]);
      await db.query("select set_config('founderops.trash_lifecycle_write','on',false)");
      for (const [id, type] of [[archived, "initiative"], [archivedCard, "deliverable"]]) await db.query("update public.tasks set trashed_at=now(),trashed_by=$2,trash_reason='Synthetic excluded lifecycle',trash_cause='withdrawn',purge_after=now()+interval '90 days',trash_root_type=$3,trash_root_id=id,trash_revision=1 where id=$1", [id, actors.ceo.profileId, type]);
      await db.query("select set_config('founderops.trash_lifecycle_write','off',false)");
      const query = normalizePlanningBoardQuery({ filters: { query: "Scope accessible" } });
      const raw = (await db.query("select public.planning_deliverable_selection($1,$2,'Offen') as selection", [actors.founder.profileId, query])).rows[0].selection;
      expect(raw.card_ids).toEqual([archiveChild, cross, target]);
      expect(new Set(raw.context_ids)).toEqual(new Set([archiveChild, cross, target, initiativeId, epic]));
      expect(new Set(raw.rows.map((row: { id: string }) => row.id))).toEqual(new Set([archiveChild, cross, target, initiativeId, epic]));
      expect(raw.relationships.map((edge: { task_id: string; related_task_id: string }) => [edge.task_id, edge.related_task_id])).toEqual([[cross, target]]);
      expect(raw.metrics.total).toBe(3); expect(raw.metrics.blocked).toBe(1); expect(raw.workspace_revision.activeTaskCount).toBe(5);
      for (const extra of [{ risk: "blocked" }, { quick: ["blocked"] }]) {
        const filtered = (await db.query("select public.planning_deliverable_selection($1,$2,'Offen') as selection", [actors.founder.profileId, normalizePlanningBoardQuery({ filters: { query: "Scope accessible", ...extra } })])).rows[0].selection;
        expect(filtered.card_ids).toEqual([cross]); expect(filtered.metrics.total).toBe(1); expect(filtered.metrics.blocked).toBe(1);
      }
      expect(raw.workstreams).not.toEqual(expect.arrayContaining(["Excluded foreign workstream"]));
      expect(raw.workstreams).not.toEqual(expect.arrayContaining(["Excluded archived workstream"]));
      expect(raw.initiative_options.map((value: { id: string }) => value.id)).toEqual([initiativeId]);
      const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
      for (const text of ["Excluded foreign ancestor", "Excluded foreign card", "Excluded archived ancestor", "Excluded archived card"]) {
        const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({ view: "board", filters: { query: text } }))}`));
        expect(response.status).toBe(200); const model = (await response.json()).model;
        expect(model.board.cardIds).toEqual([]); expect(model.board.metrics.total).toBe(0); expect(model.items).toEqual([]); expect(model.relationships).toEqual([]);
      }
    } finally {
      await db.query("select set_config('founderops.trash_lifecycle_write','on',false)");
      await db.query("delete from public.tasks where project_id=$1", [project]);
      await db.query("delete from public.projects where id=$1", [project]);
    }
  });
}, 120_000);

test("completed SQL ordering matches the complete JavaScript reference at timestamp precision and English ID ties", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, local }) => {
    const key = `${prefix}-precision`;
    // All .123xxx values have the same Date.parse millisecond. Within that
    // group manual order wins, then English lower-case and punctuation ties.
    const rows = [
      ["case-a", 0, "123001"], ["case-A", 0, "123999"],
      ["punct-a-b", 1, "123888"], ["punct-ab", 1, "123002"],
      ["punct2-a_b", 2, "123009"], ["punct2-ab", 2, "123007"],
      ["newer", 10000, "124000"], ["older", -10000, "122999"],
    ] as const;
    for (const [suffix, order] of rows) await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,sort_order) values($1,'findmydoc-founder-execution',$2,'deliverable','Erledigt','P2','approved',$3,$4,$5)", [`${key}-${suffix}`, key, initiativeId, actors.founder.profileId, order]);
    await db.query("begin");
    try {
      await db.query("set local session_replication_role = replica");
      for (const [suffix, , micros] of rows) await db.query("update public.tasks set updated_at=$2 where id=$1", [`${key}-${suffix}`, `2020-01-01T00:00:00.${micros}Z`]);
      await db.query("commit");
    } catch (error) { await db.query("rollback"); throw error; }
    const expected = ["newer", "case-a", "case-A", "punct-a-b", "punct-ab", "punct2-a_b", "punct2-ab", "older"].map(suffix => `${key}-${suffix}`);
    const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
    const { projectPlanningBoard } = await importTestModule("src/features/planning/server/planning-board-projection.ts", { "server-only": {} });
    const client = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const legacy = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: actors.founder.profileId, query: { view: "complete" } });
    expect(legacy.status).toBe("ready");
    if (legacy.status !== "ready") throw new Error("Complete legacy ordering reference unavailable");
    const input = { view: "board" as const, column: "Erledigt" as const, filters: { query: key } };
    const reference = projectPlanningBoard(legacy.model, { authorized: true, actorProfileId: actors.founder.profileId, query: input });
    expect(reference.status).toBe("ready");
    if (reference.status !== "ready") throw new Error("Complete legacy Board ordering unavailable");
    expect(reference.model.board!.cardIds, "Independent millisecond/manual/English-ID order against genuine legacy HTTP reference").toEqual(expected);
    const actual = (await db.query("select public.planning_deliverable_selection($1,$2,'Erledigt') as selection", [actors.founder.profileId, normalizePlanningBoardQuery(input)])).rows[0].selection;
    expect(actual.card_ids, `Actual SQL order: ${JSON.stringify(actual.card_ids)}; independently expected: ${JSON.stringify(expected)}`).toEqual(expected);
    expect(actual.rows.find((row: { id: string }) => row.id === `${key}-case-a`).updated_at).toContain(".123001");
  });
}, 120_000);


test("each SQL and public API column has its own exact matching total for mixed and empty status scopes", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request }) => {
    const key = `${prefix}-column-counts`;
    // Independent persisted facts: eight cards, with absent Review/Pausiert
    // statuses and three completed cards in the narrower completed scope.
    const cases = [
      ["Offen", ["open-a", "open-b"]], ["In Arbeit", ["working"]], ["Review", []],
      ["Nacharbeit", ["rework"]], ["Blockiert", ["blocked"]],
      ["Erledigt", ["done-a", "done-b", "done-c"]], ["Pausiert", []],
    ] as const;
    for (const [status, suffixes] of cases) for (const suffix of suffixes) {
      await db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner) values($1,'findmydoc-founder-execution',$2,'deliverable',$3,'P2','approved',$4,$5)", [`${key}-${suffix}`, `${key} ${status === "Erledigt" ? "completed" : "active"}`, status, initiativeId, actors.founder.profileId]);
    }
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    for (const completedOnly of [false, true]) {
      const filters = { query: `${key}${completedOnly ? " completed" : ""}` };
      const expectedTotals = Object.fromEntries(cases.map(([status, ids]) => [status, { total: completedOnly && status !== "Erledigt" ? 0 : ids.length }]));
      for (const [column, suffixes] of cases) {
        const expectedIds = (completedOnly && column !== "Erledigt" ? [] : suffixes).map(suffix => `${key}-${suffix}`);
        const scope = { view: "board" as const, filters, column };
        const raw = (await db.query("select public.planning_deliverable_selection($1,$2,$3) as selection", [actors.founder.profileId, normalizePlanningBoardQuery(scope), column])).rows[0].selection;
        expect(raw.status).toBe("ready");
        expect(raw.columns, `${completedOnly ? "completed" : "mixed"}: independent SQL totals for ${column}`).toEqual(expectedTotals);
        expect(new Set(raw.card_ids)).toEqual(new Set(expectedIds));
        const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
        expect(response.status).toBe(200);
        const model = (await response.json()).model;
        expect(model.board.column).toBe(column);
        expect(model.board.columns[column]).toMatchObject({ total: expectedIds.length, loaded: expectedIds.length, availability: "ready", completeness: "complete", continuation: null });
        expect(new Set(model.board.cardIds)).toEqual(new Set(expectedIds));
        if (!expectedIds.length) expect(model.items).toEqual([]);
        for (const [other] of cases) if (other !== column) expect(model.board.columns[other]).toMatchObject({ total: null, loaded: 0, availability: "not-loaded" });
      }
    }
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  });
}, 120_000);
