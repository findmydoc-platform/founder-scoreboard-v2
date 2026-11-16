import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("Deliverable parent discovery finds sparse Initiative candidates beyond loaded pages in canonical order", () => withPlanningCredentialDatabase(async f => {
  const search = `${f.prefix} Säulen`, first = `${f.prefix}-candidate-1007`, second = `${f.prefix}-candidate-1008`;
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,sort_order,approval_status,owner)
    select $1||'-candidate-'||lpad(n::text,4,'0'),'findmydoc-founder-execution',
      case when n>=1007 then $2||' '||n else 'Unrelated discovery fixture '||n end,
      'initiative',$3,case when n=1007 then 'Erledigt' else 'Offen' end,'P2',n,'approved',$4
    from generate_series(1,1008) n`, [f.prefix, search, `${f.prefix}-epic`, f.actors.founder.profileId]);
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reference = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: f.actors.founder.profileId, query: { view: "complete" } });
  expect(reference.status).toBe("ready");
  if (reference.status !== "ready") throw new Error("Complete candidate reference was unavailable");
  const expected = reference.model.items.filter((item: { taskType: string; title: string }) => item.taskType === "initiative" && item.title.toLocaleLowerCase("de").includes(search.toLocaleLowerCase("de")));
  expect(expected.map((item: { id: string }) => item.id)).toEqual([first, second]);

  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
  const before = f.observed.length;
  const scope = { view: "candidates", kind: "initiative", query: search, limit: 20 };
  const response = await GET(f.request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toHaveProperty("candidates");
  expect(body.candidates.items.map((item: { id: string }) => item.id)).toEqual([first, second]);
  expect(body.candidates.items.map((item: { title: string }) => item.title)).toEqual(expected.map((item: { title: string }) => item.title));
  expect(body.candidates.coverage).toBe("complete");
  expect(body.candidates.continuation).toBeNull();
  expect(body.candidates.total).toBe(2);
  expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  // Discovery must select before hydration, rather than enumerate the workspace.
  expect(f.observed.slice(before).some(entry => /\/(active_tasks|tasks)$/.test(entry.path))).toBe(false);
}), 120_000);

test("candidate discovery retains mapped-role admission and denies direct user RPC access", () => withPlanningCredentialDatabase(async f => {
  await f.db.query("update public.tasks set title=$1 where id=$2", [f.initiativeId, f.initiativeId]);
  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
  const scope = { view: "candidates", kind: "initiative", query: f.initiativeId, limit: 20 };
  const path = `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`;
  for (const role of ["ceo", "deputy", "founder", "viewer", "administrator"] as const) {
    const response = await GET(f.request(role, path));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.candidates.items.map((item: { id: string }) => item.id)).toEqual([f.initiativeId]);
    expect(body.readActor).toEqual({ profileId: f.actors[role].profileId, platformRole: role === "administrator" ? "founder" : role });
    expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  }
  for (const role of ["unmapped"] as const) {
    const response = await GET(f.request(role, path));
    expect(response.status).toBe(403);
    expect(await response.json()).not.toHaveProperty("candidates");
  }
  for (const role of ["founder", "unmapped", "anonymous"] as const) {
    const response = await f.rpc("planning_initiative_candidates", { p_actor_profile_id: f.actors.founder.profileId, p_query: "", p_limit: 20 }, role);
    expect(response.status).toBe(role === "anonymous" ? 401 : 403);
  }
}), 120_000);

test("Initiative pages traverse complete literal search beyond 1000 and reject changed query, actor and source bases", () => withPlanningCredentialDatabase(async f => {
  const search = `${f.prefix} 50%_Ä`;
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,sort_order,approval_status,owner)
    select $1||'-page-'||lpad(n::text,4,'0'),'findmydoc-founder-execution',$2||' '||n,'initiative',$3,
      case when n=1008 then 'Erledigt' else 'Offen' end,'P2',n,'approved',$4 from generate_series(1,1008) n`,
  [f.prefix, search, `${f.prefix}-epic`, f.actors.founder.profileId]);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner)
    values($1,'findmydoc-founder-execution',$2,'initiative',$3,'Offen','P2','approved',$4)`,
  [`${f.prefix}-literal-decoy`, `${f.prefix} 50notliteralXÄ`, `${f.prefix}-epic`, f.actors.founder.profileId]);
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reference = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: f.actors.founder.profileId, query: { view: "complete" } });
  expect(reference.status).toBe("ready");
  if (reference.status !== "ready") throw new Error("Complete traversal reference was unavailable");
  const expected = Array.from({ length: 1008 }, (_, index) => `${f.prefix}-page-${String(index + 1).padStart(4, "0")}`);
  expect(reference.model.items.filter((item: { taskType: string; title: string }) => item.taskType === "initiative" && item.title.toLocaleLowerCase("de").includes(search.toLocaleLowerCase("de"))).map((item: { id: string }) => item.id)).toEqual(expected);
  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
  const read = (scope: object, actor: "founder" | "other" = "founder") => GET(f.request(actor, `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(scope))}`));
  const scope = { view: "candidates", kind: "initiative", query: search, limit: 100 };
  const first = await read(scope); expect(first.status).toBe(200);
  const basis = await first.json(), ids = basis.candidates.items.map((item: { id: string }) => item.id);
  const firstCursor = basis.candidates.continuation;
  expect(ids).toEqual(expected.slice(0, 100)); expect(firstCursor).toEqual(expect.any(String));
  let continuation: string | null = firstCursor, pages = 1;
  while (continuation && pages <= 11) {
    const response = await read({ ...scope, continuation }); expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.candidates.sourceRevision).toBe(basis.candidates.sourceRevision);
    expect(body.candidates.total).toBe(1008);
    expect(body.readAuthority.deadline).toBeLessThanOrEqual(basis.readAuthority.deadline);
    ids.push(...body.candidates.items.map((item: { id: string }) => item.id));
    continuation = body.candidates.continuation; pages++;
  }
  expect(pages).toBe(11); expect(continuation).toBeNull();
  expect(ids).toEqual(expected); expect(new Set(ids).size).toBe(1008);
  for (const response of [await read({ ...scope, query: "other", continuation: firstCursor }), await read({ ...scope, continuation: firstCursor }, "other")]) {
    expect(response.status).toBe(409); expect(await response.json()).not.toHaveProperty("candidates");
  }
  await f.db.query("update public.tasks set title=$1 where id=$2", [`${search} renamed`, expected[1007]]);
  const stale = await read({ ...scope, continuation: firstCursor }); expect(stale.status).toBe(409);
  expect(await stale.json()).not.toHaveProperty("candidates");
  const restarted = await read(scope); expect(restarted.status).toBe(200);
  const replacement = await restarted.json(); expect(replacement.candidates.total).toBe(1008);
  expect(replacement.candidates.sourceRevision).not.toBe(basis.candidates.sourceRevision);
  expect(replacement.candidates.items.map((item: { id: string }) => item.id)).toEqual(expected.slice(0, 100));
}), 120_000);
