import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("signed summaries reject same-count and supporting-source changes without claiming discussion coverage", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request }) => {
    const parent = `${prefix}-summary-source`, child = `${prefix}-child-open`, done = `${prefix}-child-done`;
    const endpoint = `${prefix}-endpoint`, replacement = `${prefix}-replacement`, sprint = `${prefix}-summary-sprint`;
    await db.query("insert into public.sprints(id,project_id,name,start_date,end_date) values($1,'findmydoc-founder-execution','Synthetic source Sprint','2030-01-01','2030-01-14')", [sprint]);
    for (const [id, title] of [[parent, parent], [endpoint, "Synthetic supporting endpoint"], [replacement, "Synthetic replacement endpoint"]]) {
      await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner,acceptance_criteria,definition_of_done,sprint_id,evidence_link)
        values($1,'findmydoc-founder-execution',$2,'deliverable',$3,'approved',$4,'P2',$5,'Synthetic AC','Synthetic DoD',$6,'https://example.test/evidence')`,
      [id, title, initiativeId, id === parent ? "Blockiert" : "Offen", actors.other.profileId, id === parent ? sprint : null]);
    }
    for (const [id, status, owner] of [[child, "Offen", actors.founder.profileId], [done, "Erledigt", actors.other.profileId]]) await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner)
      values($1,'findmydoc-founder-execution','Synthetic off-page child','sub_issue',$2,$3,'P2',$4)`, [id, parent, status, owner]);
    await db.query("insert into public.task_relationship_edges(task_id,related_task_id,relation_type) values($1,$2,'blocked_by')", [parent, endpoint]);
    await db.query("insert into public.task_blockers(task_id,profile_id,reason) values($1,$2,'Synthetic open blocker')", [parent, actors.founder.profileId]);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const query = { view: "board", column: "Blockiert", filters: { query: parent } };
    const read = async () => {
      const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.model.board.cardIds).toEqual([parent]);
      expect(body.model.items.some((item: { id: string }) => item.id === child || item.id === done)).toBe(false);
      expect(body.model.board.childProgressById[parent]).toEqual({ completed: 1, total: 2, unfinished: 1, percentage: 50 });
      return body;
    };
    expect((await read()).model.board.viewerOpenSubIssueIdsByDeliverableId[parent]).toEqual([child]);
    const changes: Array<{ name: string; mutate(): Promise<unknown> }> = [
      { name: "same-count child identity change", mutate: () => db.query("update public.tasks set status=case when id=$1 then 'Erledigt' else 'Offen' end where id=any($2)", [child, [child, done]]) },
      { name: "same-count relationship replacement", mutate: () => db.query("update public.task_relationship_edges set related_task_id=$2 where task_id=$1", [parent, replacement]) },
      { name: "blocker resolution", mutate: () => db.query("update public.task_blockers set status='resolved',resolved_at=now() where task_id=$1", [parent]) },
      { name: "evidence links", mutate: () => db.query("insert into public.task_links(task_id,type,label,url) values($1,'evidence','Synthetic evidence','https:example.test/scoped-evidence')", [parent]) },
      { name: "dependency notes", mutate: () => db.query("insert into public.task_dependencies(task_id,note) values($1,'Synthetic dependency')", [parent]) },
      { name: "parent strategy", mutate: () => db.query("insert into public.planning_item_strategy(task_id,goal) values($1,'Synthetic source goal')", [initiativeId]) },
      { name: "parent RACI", mutate: () => db.query("insert into public.planning_item_raci_assignments(task_id,profile_id,role) values($1,$2,'accountable')", [initiativeId, actors.founder.profileId]) },
      { name: "profile display source", mutate: () => db.query("update public.profiles set focus='Synthetic source focus' where id=$1", [actors.founder.profileId]) },
      { name: "Sprint source", mutate: () => db.query("update public.sprints set name='Synthetic updated source Sprint' where id=$1", [sprint]) },
      { name: "actor preferences", mutate: () => db.query("insert into public.profile_ui_preferences(profile_id,expanded_item_ids) values($1,array[$2])", [actors.founder.profileId, parent]) },
      { name: "avatar identity", mutate: () => db.query("update auth.identities set identity_data=jsonb_set(identity_data,'{picture}','\"https://example.test/avatar.png\"') where user_id=$1 and provider='google'", [actors.founder.userId]) },
      { name: "off-page endpoint lifecycle", mutate: async () => {
        await db.query("select set_config('founderops.trash_lifecycle_write','on',false)");
        try { await db.query("update public.tasks set trashed_at=now(),trashed_by=$2,trash_reason='Synthetic source lifecycle',trash_cause='withdrawn',purge_after=now()+interval '90 days',trash_root_type='deliverable',trash_root_id=id,trash_revision=1 where id=$1", [replacement, actors.ceo.profileId]); }
        finally { await db.query("select set_config('founderops.trash_lifecycle_write','off',false)"); }
      } },
    ];
    for (const change of changes) {
      const before = await read(), token = before.model.board.summaryRequests[0].token;
      await change.mutate();
      const stale = await GET(request("founder", `/api/planning-board-data?summaries=${encodeURIComponent(token)}`));
      expect(stale.status, change.name).toBe(409);
      expect(await stale.json(), change.name).not.toHaveProperty("summaries");
    }
    const current = await read(), token = current.model.board.summaryRequests[0].token;
    expect(current.model.board.viewerOpenSubIssueIdsByDeliverableId).toEqual({});
    expect(current.model.board.attentionById[parent].map((signal: { id: string }) => signal.id)).toEqual(["blocker-missing"]);
    await db.query("insert into public.task_comments(task_id,profile_id,comment,github_delivery_applicable) values($1,$2,'Synthetic separate discussion',false)", [parent, actors.founder.profileId]);
    const unchanged = await GET(request("founder", `/api/planning-board-data?summaries=${encodeURIComponent(token)}`));
    expect(unchanged.status).toBe(200);
    const body = await unchanged.json();
    expect(body.summaries.childProgressById).toEqual(current.model.board.childProgressById);
    expect(body.summaries.attentionById).toEqual(current.model.board.attentionById);
  });
}, 120_000);

test("a valid empty streamed query proves zero totals without reading or inventing card summaries", async () => {
  await withPlanningCredentialDatabase(async ({ prefix, request, observed }) => {
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const input = request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({ view: "board", filters: { query: `no-match-${prefix}` } }))}`);
    input.headers.set("accept", "application/x-ndjson");
    const response = await GET(input);
    expect(response.status).toBe(200);
    const frames = (await response.text()).trim().split("\n").map((line: string) => JSON.parse(line));
    expect(frames.map((frame: { kind: string }) => frame.kind)).toEqual(["basis", "end"]);
    const model = frames[0].model;
    expect(model.items).toEqual([]);
    expect(model.board.cardIds).toEqual([]);
    expect(model.board.metrics).toEqual({ total: 0, open: 0, done: 0, blocked: 0 });
    expect(model.board.childProgressById).toEqual({});
    expect(model.board.attentionById).toEqual({});
    expect(model.board.summaryRequests).toEqual([]);
    for (const column of Object.values(model.board.columns)) expect(column).toEqual({ total: 0, loaded: 0, availability: "ready", completeness: "complete", continuation: null });
    expect(observed.some(entry => /\/(planning_deliverable_summaries|planning_deliverable_column|active_tasks)$/.test(entry.path))).toBe(false);
  });
}, 120_000);

test("summary reads retain supported roles and direct RPC denial without leaking revoked or unmapped data", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, rpc }) => {
    const parent = `${prefix}-summary-grants`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`, [parent, initiativeId, actors.founder.profileId]);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", column: "Offen", filters: { query: parent } };
    let founderToken = "";
    for (const role of ["ceo", "deputy", "founder", "viewer"] as const) {
      const response = await GET(request(role, `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
      expect(response.status, role).toBe(200);
      const body = await response.json(), token = body.model.board.summaryRequests[0].token;
      if (role === "founder") founderToken = token;
      const allowed = await GET(request(role, `/api/planning-board-data?summaries=${encodeURIComponent(token)}`));
      expect(allowed.status, role).toBe(200);
      expect((await allowed.json()).summaries.childProgressById[parent]).toEqual({ completed: 0, total: 0, unfinished: 0, percentage: 0 });
      const forbidden = await rpc("planning_deliverable_summaries", { p_actor_profile_id: actors[role].profileId,
        p_selected_ids: [parent], p_source_revision: body.model.scopeRevision, p_evaluated_at: body.model.board.observedAt, p_valid_until: null }, role);
      expect(forbidden.status, role).toBe(403);
    }
    expect((await GET(request("viewer", `/api/planning-board-data?summaries=${encodeURIComponent(founderToken)}`))).status).toBe(409);
    const unmapped = await GET(request("unmapped", `/api/planning-board-data?summaries=${encodeURIComponent(founderToken)}`));
    expect(unmapped.status).toBe(403);
    expect(await unmapped.json()).not.toHaveProperty("summaries");
    const anonymous = request("founder", `/api/planning-board-data?summaries=${encodeURIComponent(founderToken)}`);
    anonymous.headers.delete("authorization");
    expect((await GET(anonymous)).status).toBe(401);
    expect((await rpc("planning_deliverable_summaries", { p_actor_profile_id: actors.founder.profileId, p_selected_ids: [], p_source_revision: "unverified", p_evaluated_at: new Date().toISOString() }, "anonymous")).status).toBe(401);
    expect((await GET(request("founder", "/api/planning-board-data?summaries=invalid"))).status).toBe(409);
    expect((await GET(request("founder", `/api/planning-board-data?summaries=${encodeURIComponent(founderToken)}&scope={}`))).status).toBe(400);
    await db.query("delete from auth.sessions where id=$1", [actors.founder.sessionId]);
    const revoked = await GET(request("founder", `/api/planning-board-data?summaries=${encodeURIComponent(founderToken)}`));
    expect(revoked.status).toBeGreaterThanOrEqual(400);
    const denied = await revoked.json();
    expect(denied).not.toHaveProperty("summaries");
    expect(denied).not.toHaveProperty("readAuthority");
  });
}, 120_000);
