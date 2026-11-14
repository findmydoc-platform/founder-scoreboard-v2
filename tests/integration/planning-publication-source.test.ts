import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("selected JSON publication reads its live actor and source together without a second service source dispatch", async () => {
  await withPlanningCredentialDatabase(async ({ db, prefix, initiativeId, actors, request, observed }) => {
    const parent = `${prefix}-publication-parent`;
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,approval_status,status,priority,owner)
      values($1,'findmydoc-founder-execution',$1,'deliverable',$2,'approved','Offen','P2',$3)`,
    [parent, initiativeId, actors.founder.profileId]);
    const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
    const scope = { view: "board", column: "Offen", filters: { query: parent } };
    const response = await GET(request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.model.board.cardIds).toEqual([parent]);
    expect(body.model.board.childProgressById[parent]).toEqual({ completed: 0, total: 0, unfinished: 0, percentage: 0 });
    expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
    // This is a dispatch budget at the real database boundary, not a timing
    // threshold. The complete result still needs a fresh publication check.
    const publication = observed.filter(entry => entry.path.endsWith("/rpc/planning_board_publication_context"));
    expect(publication).toEqual([expect.objectContaining({ actor: "founder", permit: true })]);
    expect(observed.filter(entry => entry.path.endsWith("/rpc/planning_source_version"))).toEqual([]);
    expect(body).not.toHaveProperty("publicationContext");
    expect((await db.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1", [actors.founder.userId])).rows[0].remaining).toBe(0);
  }, "linking");
}, 120_000);
