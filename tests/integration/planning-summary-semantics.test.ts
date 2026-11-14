import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("complete summary predicates preserve negative relationship blocker dependency and raw-evidence semantics", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, local, request }) => {
    const key = `${prefix}-summary-semantics`, open = `${prefix}-open-endpoint`, closed = `${prefix}-closed-endpoint`;
    const trashed = `${prefix}-trashed-endpoint`, project = `${prefix}-foreign-project`, foreign = `${prefix}-foreign-endpoint`;
    const foreignEpic = `${prefix}-foreign-epic`, foreignInitiative = `${prefix}-foreign-initiative`, sprint = `${prefix}-evidence-sprint`;
    const cases = [
      { id: "reverse-outgoing", signals: [] }, { id: "reverse-incoming", signals: [] }, { id: "neutral", signals: [] },
      { id: "closed-outgoing", signals: [] }, { id: "closed-incoming", signals: [] }, { id: "foreign", signals: [] }, { id: "trashed", signals: [] },
      { id: "legacy-note", signals: [] }, { id: "empty-note", signals: [] }, { id: "two-empty-notes", signals: [] },
      { id: "no-blocker", signals: ["blocker-missing"] }, { id: "closed-blocker", signals: ["blocker-missing"] }, { id: "open-blocker", signals: [] },
      { id: "evidence-raw-whitespace", signals: [] }, { id: "evidence-raw-invalid", signals: [] },
      { id: "evidence-absent", signals: ["evidence-missing"] }, { id: "evidence-invalid-link", signals: ["evidence-missing"] },
      { id: "evidence-last-valid", signals: [] }, { id: "issue-raw-whitespace", signals: [] },
    ];
    const id = (suffix: string) => `${key}-${suffix}`;
    try {
      await db.query("insert into public.sprints(id,project_id,name) values($1,'findmydoc-founder-execution','Synthetic evidence Sprint')", [sprint]);
      for (const [index, example] of cases.entries()) await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner,acceptance_criteria,definition_of_done,sprint_id,evidence_link,issue_url,sort_order)
        values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved',$3,'P2',$4,'Synthetic AC','Synthetic DoD',$5,$6,$7,$8)`,
      [id(example.id), initiativeId, example.id.endsWith("blocker") ? "Blockiert" : "Offen", actors.founder.profileId,
        example.id.startsWith("evidence-") || example.id.startsWith("issue-") ? sprint : null,
        example.id === "evidence-raw-whitespace" ? " \t" : example.id === "evidence-raw-invalid" ? "not a URL" : null,
        example.id === "issue-raw-whitespace" ? " " : null, index]);
      for (const [endpoint, status] of [[open, "Offen"], [closed, "Erledigt"], [trashed, "Offen"]]) await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
        values($1,'findmydoc-founder-execution','Synthetic supporting endpoint','deliverable',$2,'approved',$3,'P2',$4)`, [endpoint, initiativeId, status, actors.other.profileId]);
      await db.query("insert into public.projects(id,name) values($1,'Synthetic foreign project')", [project]);
      await db.query("insert into public.tasks(id,project_id,title,task_type,status,owner) values($1,$2,'Foreign Epic','epic','Offen',$3)", [foreignEpic, project, actors.other.profileId]);
      await db.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner) values($1,$2,'Foreign Initiative','initiative',$3,'approved','Offen','P2',$4)", [foreignInitiative, project, foreignEpic, actors.other.profileId]);
      await db.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner) values($1,$2,'Foreign endpoint','deliverable',$3,'approved','Offen','P2',$4)", [foreign, project, foreignInitiative, actors.other.profileId]);
      for (const [source, target, relation] of [
        [id("reverse-outgoing"), open, "blocks"], [open, id("reverse-incoming"), "blocked_by"], [id("neutral"), open, "relates_to"],
        [id("closed-outgoing"), closed, "blocked_by"], [closed, id("closed-incoming"), "blocks"],
        [id("foreign"), foreign, "blocked_by"], [id("trashed"), trashed, "blocked_by"],
      ]) await db.query("insert into public.task_relationship_edges(task_id,related_task_id,relation_type) values($1,$2,$3)", [source, target, relation]);
      await db.query("select set_config('founderops.trash_lifecycle_write','on',false)");
      try { await db.query("update public.tasks set trashed_at=now(),trashed_by=$2,trash_reason='Synthetic excluded endpoint',trash_cause='withdrawn',purge_after=now()+interval '90 days',trash_root_type='deliverable',trash_root_id=id,trash_revision=1 where id=$1", [trashed, actors.ceo.profileId]); }
      finally { await db.query("select set_config('founderops.trash_lifecycle_write','off',false)"); }
      for (const [suffix, status] of [["closed-blocker", "resolved"], ["open-blocker", "open"]]) await db.query("insert into public.task_blockers(task_id,profile_id,reason,status) values($1,$2,'Synthetic blocker',$3)", [id(suffix), actors.founder.profileId, status]);
      for (const [suffix, note] of [["legacy-note", "Synthetic dependency"], ["empty-note", ""], ["two-empty-notes", ""], ["two-empty-notes", ""]]) await db.query("insert into public.task_dependencies(task_id,note) values($1,$2)", [id(suffix), note]);
      await db.query("insert into public.task_links(task_id,type,label,url) values($1,'evidence','Synthetic invalid evidence','not a URL')", [id("evidence-invalid-link")]);
      // The only valid candidate is beyond both the UI's 20-link convention
      // and a provider's 1000-row page. No such cap belongs to this aggregate.
      await db.query(`insert into public.task_links(task_id,type,label,url,position)
        select $1,'evidence','Synthetic evidence candidate',case when n=1001 then $2 else 'invalid-candidate-'||n end,n
        from generate_series(1,1001) n`, [id("evidence-last-valid"), " \thttps:example.test/last-valid\n"]);
      const query = { view: "board" as const, filters: { query: key } };
      const context = { authorized: true, actorProfileId: actors.founder.profileId, query };
      const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
      const { projectPlanningBoard } = await importTestModule("src/features/planning/server/planning-board-projection.ts", { "server-only": {} });
      const referenceClient = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const complete = await loadPlanningWorkspaceModel(referenceClient, { ...context, query: { view: "complete" } });
      expect(complete.status).toBe("ready");
      if (complete.status !== "ready") throw new Error("Complete legacy negative-signal reference was unavailable");
      const reference = projectPlanningBoard(complete.model, context);
      expect(reference.status).toBe("ready");
      if (reference.status !== "ready") throw new Error("Complete legacy negative-signal projection was unavailable");
      expect(new Set(reference.model.board!.cardIds)).toEqual(new Set(cases.map(example => id(example.id))));
      for (const example of cases) expect(reference.model.board!.attentionById![id(example.id)].map((signal: { id: string }) => signal.id), example.id).toEqual(example.signals);
      expect(reference.model.board!.metrics.blocked).toBe(5);
      const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
      const input = request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(query))}`);
      input.headers.set("accept", "application/x-ndjson");
      const response = await GET(input);
      expect(response.status).toBe(200);
      const frames = (await response.text()).trim().split("\n").map((line: string) => JSON.parse(line));
      const summary = frames.find((frame: { kind: string }) => frame.kind === "summaries");
      expect(new Set(summary.cardIds)).toEqual(new Set(cases.map(example => id(example.id))));
      for (const example of cases) expect(summary.attentionById[id(example.id)].map((signal: { id: string }) => signal.id), example.id).toEqual(example.signals);
      expect(summary.attentionById).toEqual(reference.model.board!.attentionById);
      expect(frames[0].model.board.metrics.blocked).toBe(5);
      expect(JSON.stringify(summary)).not.toContain("last-valid");
      expect(summary).not.toHaveProperty("attention_inputs");
    } finally {
      await db.query("select set_config('founderops.trash_lifecycle_write','on',false)");
      await db.query("delete from public.tasks where project_id=$1", [project]);
      await db.query("delete from public.projects where id=$1", [project]);
    }
  });
}, 120_000);
