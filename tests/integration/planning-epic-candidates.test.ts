import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("Epic discovery orders the complete authorized scope before paging and resolves its active default outside the page and search", () => withPlanningCredentialDatabase(async f => {
  const search = `${f.prefix} 50%_Ä Epic`, activeId = `${f.prefix}-epic-choice-1008`;
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,sort_order,approval_status,owner)
    select $1||'-epic-choice-'||lpad(n::text,4,'0'),'findmydoc-founder-execution',
      $2||case when n=1 then ' sparse' else ' '||n end,'epic',
      case when n=1008 then 'In Arbeit' when n=1007 then 'Erledigt' else 'Offen' end,'P2',n,'approved',$3
    from generate_series(1,1008) n`, [f.prefix, search, f.actors.founder.profileId]);
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reference = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: f.actors.founder.profileId, query: { view: "complete" } });
  expect(reference.status).toBe("ready");
  if (reference.status !== "ready") throw new Error("Complete Epic reference was unavailable");
  const epics = reference.model.items.filter((item: { taskType: string }) => item.taskType === "epic");
  const expected = Array.from({ length: 1008 }, (_, index) => `${f.prefix}-epic-choice-${String(index + 1).padStart(4, "0")}`);
  expect(epics.filter((item: { title: string }) => item.title.toLocaleLowerCase("de").includes(search.toLocaleLowerCase("de"))).map((item: { id: string }) => item.id)).toEqual(expected);
  expect(epics.find((item: { status: string }) => item.status === "In Arbeit")?.id).toBe(activeId);
  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
  const read = (query: string, continuation?: string) => GET(f.request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify({ view: "candidates", kind: "epic", query, limit: 20, continuation }))}`));
  const before = f.observed.length;
  const first = await read(search); expect(first.status).toBe(200);
  const body = await first.json();
  expect(body.candidates.items.map((item: { id: string }) => item.id)).toEqual(expected.slice(0, 20));
  expect(body.candidates.items.every((item: { taskType: string }) => item.taskType === "epic")).toBe(true);
  expect(body.candidates.total).toBe(1008); expect(body.candidates.coverage).toBe("partial");
  expect(body.candidates.defaultCandidate).toMatchObject({ id: activeId, title: `${search} 1008`, taskType: "epic" });
  expect(body.readActor).toEqual({ profileId: f.actors.founder.profileId, platformRole: "founder" });
  expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  const second = await read(search, body.candidates.continuation); expect(second.status).toBe(200);
  const next = await second.json(); expect(next.candidates.items.map((item: { id: string }) => item.id)).toEqual(expected.slice(20, 40));
  expect(next.candidates.defaultCandidate).toEqual(body.candidates.defaultCandidate);
  expect(next.candidates.sourceRevision).toBe(body.candidates.sourceRevision);
  expect(next.readAuthority.deadline).toBeLessThanOrEqual(body.readAuthority.deadline);
  const sparse = await read(`${search} sparse`); expect(sparse.status).toBe(200);
  const filtered = await sparse.json(); expect(filtered.candidates.items.map((item: { id: string }) => item.id)).toEqual([expected[0]]);
  expect(filtered.candidates.defaultCandidate).toEqual(body.candidates.defaultCandidate);
  await f.db.query("update public.tasks set status='Offen' where id=$1", [activeId]);
  const fallback = await read(`${search} sparse`); expect(fallback.status).toBe(200);
  expect((await fallback.json()).candidates.defaultCandidate.id).toBe(epics[0].id);
  expect(f.observed.slice(before).some(entry => /\/(active_tasks|tasks)$/.test(entry.path))).toBe(false);
}), 120_000);

test("Epic discovery retains all mapped reader roles and denies unmapped or direct user RPC access", () => withPlanningCredentialDatabase(async f => {
  await f.db.query("update public.tasks set title=$1 where id=$2", [`${f.prefix} permitted Epic`, `${f.prefix}-epic`]);
  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
  const scope = { view: "candidates", kind: "epic", query: f.prefix, limit: 20 };
  for (const actor of ["ceo", "deputy", "founder", "viewer", "administrator"] as const) {
    const response = await GET(f.request(actor, `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
    expect(response.status).toBe(200);
    const body = await response.json(); expect(body.candidates.items.map((item: { id: string }) => item.id)).toEqual([`${f.prefix}-epic`]);
    expect(body.readActor).toEqual({ profileId: f.actors[actor].profileId, platformRole: actor === "administrator" ? "founder" : actor });
    expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  }
  const denied = await GET(f.request("unmapped", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
  expect(denied.status).toBe(403); expect(await denied.json()).not.toHaveProperty("candidates");
  for (const actor of ["founder", "unmapped", "anonymous"] as const) {
    const response = await f.rpc("planning_item_candidates", { p_actor_profile_id: f.actors.founder.profileId, p_kind: "epic", p_query: "", p_limit: 20 }, actor);
    expect(response.status).toBe(actor === "anonymous" ? 401 : 403);
  }
}), 120_000);
