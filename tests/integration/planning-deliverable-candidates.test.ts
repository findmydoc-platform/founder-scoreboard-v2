import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("Deliverable parent discovery preserves unapproved options and binds Initiative labels before paging", () => withPlanningCredentialDatabase(async f => {
  const title = `${f.prefix} 50%_Ä Deliverable`, parentTitle = `${f.prefix} Parent Initiative`;
  await f.db.query("update public.tasks set title=$1 where id=$2", [parentTitle, f.initiativeId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,sort_order,approval_status,parent_task_id,owner)
    select $1||'-parent-deliverable-'||lpad(n::text,4,'0'),'findmydoc-founder-execution',$2||' '||n,'deliverable','Offen','P2',n,
      case when n=1008 then 'proposed' else 'approved' end,$3,$4 from generate_series(1,1008) n`, [f.prefix, title, f.initiativeId, f.actors.founder.profileId]);
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reference = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: f.actors.founder.profileId, query: { view: "complete" } });
  expect(reference.status).toBe("ready");
  if (reference.status !== "ready") throw new Error("Complete Deliverable reference was unavailable");
  const expected = Array.from({ length: 1008 }, (_, index) => `${f.prefix}-parent-deliverable-${String(index + 1).padStart(4, "0")}`);
  expect(reference.model.items.filter((item: { taskType: string; title: string }) => item.taskType === "deliverable" && item.title.toLocaleLowerCase("de").includes(title.toLocaleLowerCase("de"))).map((item: { id: string }) => item.id)).toEqual(expected);
  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
  const read = (query: string, continuation?: string) => GET(f.request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({ view: "candidates", kind: "deliverable", query, limit: 100, continuation }))}`));
  const start = f.observed.length;
  const first = await read(title); expect(first.status).toBe(200);
  const body = await first.json();
  expect(body.candidates.items.map((item: { id: string }) => item.id)).toEqual(expected.slice(0,100));
  expect(body.candidates.total).toBe(1008); expect(body.candidates.coverage).toBe("partial");
  expect(body.candidates.items.every((item: { parentTaskId: string; parentTitle: string }) => item.parentTaskId === f.initiativeId && item.parentTitle === parentTitle)).toBe(true);
  expect(body.candidates).not.toHaveProperty("defaultCandidate");
  expect(body.readActor).toEqual({ profileId: f.actors.founder.profileId, platformRole: "founder" });
  const second = await read(title, body.candidates.continuation); expect(second.status).toBe(200);
  const next = await second.json(); expect(next.candidates.items.map((item: { id: string }) => item.id)).toEqual(expected.slice(100,200));
  expect(next.readAuthority.deadline).toBeLessThanOrEqual(body.readAuthority.deadline);
  const sparse = await read(`${title} 1008`); expect(sparse.status).toBe(200);
  const selected = (await sparse.json()).candidates;
  expect(selected.total).toBe(1); expect(selected.items).toEqual([expect.objectContaining({ id: expected[1007], approvalStatus: "proposed", parentTaskId: f.initiativeId, parentTitle })]);
  expect(f.observed.slice(start).some(entry => /\/(active_tasks|tasks)$/.test(entry.path))).toBe(false);
}), 120_000);
