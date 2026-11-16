import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";
import { buildBacklogTableViewModel, DEFAULT_BACKLOG_FILTERS } from "@/features/backlog/model/backlog-view-model";

test("explicit Backlog rank actions resolve global neighbors and boundaries before page limits without replacing the shown source version", () => withPlanningCredentialDatabase(async f => {
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,sort_order,approval_status,owner)
    select $1||'-rank-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Rank source '||n,'deliverable',$2,'Offen','P2',n,'approved',$3
    from generate_series(1,1008)n`, [f.prefix, f.initiativeId, f.actors.founder.profileId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,sort_order,approval_status,owner)
    values($1,'findmydoc-founder-execution','Zero tie Z','deliverable',$3,'Offen','P2',0,'proposed',$4),
    ($2,'findmydoc-founder-execution','Zero tie umlaut','deliverable',$3,'Offen','P2',0,'approved',$4),
    ($5,'findmydoc-founder-execution','Completed excluded','deliverable',$3,'Erledigt','P2',-1,'approved',$4)`,
    [`${f.prefix}-z`, `${f.prefix}-ä`, f.initiativeId, f.actors.founder.profileId, `${f.prefix}-completed`]);
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reference = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: f.actors.ceo.profileId, query: { view: "complete" } });
  expect(reference.status).toBe("ready"); if (reference.status !== "ready") throw new Error("Complete rank reference unavailable");
  const full = buildBacklogTableViewModel({ revision: reference.model.revision, items: reference.model.items, people: reference.model.people,
    sprints: reference.model.sprints, commitments: [], coverage: { items: "complete" } }, DEFAULT_BACKLOG_FILTERS);
  const expected = [`${f.prefix}-ä`, `${f.prefix}-z`, ...Array.from({ length: 1008 }, (_, i) => `${f.prefix}-rank-${String(i + 1).padStart(4, "0")}`)];
  expect(full.orderedTasks.map(task => task.id)).toEqual(expected);
  const { GET: versionGET } = await importTestModule("src/app/api/planning-source-version/route.ts", { "server-only": {} });
  const version = async () => { const response = await versionGET(f.request("ceo", "/api/planning-source-version")); expect(response.status).toBe(200); return (await response.json()).version; };
  const sourceRevision = await version();
  const { GET } = await importTestModule("src/app/api/backlog-data/route.ts", { "server-only": {} });
  const read = (index: number, action: "up" | "down" | "top" | "bottom", revision = sourceRevision, updatedAt = full.orderedTasks[index].updatedAt) =>
    GET(f.request("ceo", `/api/backlog-data?scope=${encodeURIComponent(JSON.stringify({ view: "backlog-rank", sourceId: expected[index], sourceUpdatedAt: updatedAt, sourceRevision: revision, action }))}`));
  for (const [action, targetIndex] of [["up", 19], ["down", 21], ["top", 0], ["bottom", 1009]] as const) {
    const response = await read(20, action); expect(response.status).toBe(200); const body = await response.json();
    expect(body.model.rankTarget).toMatchObject({ sourceId: expected[20], sourceUpdatedAt: full.orderedTasks[20].updatedAt,
      targetId: expected[targetIndex], action, placement: action === "top" || action === "up" ? "before" : "after", sourceRevision, noop: false });
    expect(body.model.items.map((task: { id: string }) => task.id)).toEqual([expected[targetIndex]]);
    expect(body.model.items[0].updatedAt).toBe(full.orderedTasks[targetIndex].updatedAt);
    expect(body.model.coverage.items).toBe("partial");
    expect(body.readActor).toEqual({ profileId: f.actors.ceo.profileId, platformRole: "ceo" });
    expect(Date.parse(body.model.rankTarget.validUntil)).toBeLessThanOrEqual(body.readAuthority.deadline);
  }
  for (const [index, action] of [[0, "top"], [0, "up"], [1009, "bottom"], [1009, "down"]] as const) {
    const response = await read(index, action); expect(response.status).toBe(200); const body = await response.json();
    expect(body.model.rankTarget).toMatchObject({ sourceId: expected[index], action, targetId: null, noop: true });
    expect(body.model.items).toEqual([]);
  }
  await f.db.query("update public.tasks set title='Independent source change' where id=$1", [expected[100]]);
  expect((await read(20, "bottom")).status).toBe(409);
  const freshSource = await version();
  await f.db.query("update public.tasks set updated_at=updated_at+interval '1 millisecond' where id=$1", [expected[20]]);
  expect((await read(20, "bottom", await version())).status).toBe(409);
  expect(freshSource).not.toBe(sourceRevision);
}), 120_000);
