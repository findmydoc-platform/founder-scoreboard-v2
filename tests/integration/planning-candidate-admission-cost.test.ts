import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("Initiative candidates retain their complete DTO and continuation with one fresh profile guard at dispatch", () => withPlanningCredentialDatabase(async f => {
  const query = `${f.prefix} candidate admission`, epicId = `${f.prefix}-epic`;
  const ids = Array.from({ length: 21 }, (_, index) => `${f.prefix}-admission-${String(index + 1).padStart(2, "0")}`);
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,sort_order,approval_status,owner)
    select $1||'-admission-'||lpad(n::text,2,'0'),'findmydoc-founder-execution',$2||' '||n,'initiative',$3,
      case when n=1 then 'Erledigt' else 'Offen' end,'P2',n,'approved',$4 from generate_series(1,21) n`, [f.prefix, query, epicId, f.actors.founder.profileId]);
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
  const client = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const reference = await loadPlanningWorkspaceModel(client, { authorized: true, actorProfileId: f.actors.founder.profileId, query: { view: "complete" } });
  expect(reference.status).toBe("ready");
  if (reference.status !== "ready") throw new Error("Complete Initiative reference unavailable");
  const expected = reference.model.items.filter((item: { taskType: string; title: string }) => item.taskType === "initiative" && item.title.toLocaleLowerCase("de").includes(query.toLocaleLowerCase("de")));
  expect(expected.map((item: { id: string }) => item.id)).toEqual(ids);
  expect(expected[0].status).toBe("Erledigt");
  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
  const scope = { view: "candidates", kind: "initiative", query, limit: 20 };
  const read = (value: object) => GET(f.request("founder", `/api/planning-board-data?scope=${encodeURIComponent(JSON.stringify(value))}`));
  const before = f.observed.length;
  const first = await read(scope);
  expect(first.status).toBe(200);
  const body = await first.json();
  const dispatches = f.observed.slice(before);
  expect(body.candidates).toEqual({ items: expect.any(Array), total: 21, coverage: "partial", continuation: expect.any(String), sourceRevision: expect.any(String), observedAt: expect.any(String), validUntil: expect.any(String) });
  expect(body.candidates.items).toEqual(expected.slice(0, 20).map((item: { id: string; title: string; parentTaskId: string; approvalStatus: string }) => ({ id: item.id, title: item.title, taskType: "initiative", parentTaskId: item.parentTaskId, approvalStatus: item.approvalStatus, updatedAt: expect.any(String) })));
  for (const [index, item] of body.candidates.items.entries()) expect(Date.parse(item.updatedAt)).toBe(Date.parse(expected[index].updatedAt || ""));
  expect(body.readActor).toEqual({ profileId: f.actors.founder.profileId, platformRole: "founder" });
  expect(body.readAuthority.userId).toBe(f.actors.founder.userId);
  const claims = JSON.parse(Buffer.from(f.actors.founder.token.split(".")[1], "base64url").toString());
  expect(body.readAuthority.deadline).toBeGreaterThan(Date.now());
  expect(body.readAuthority.deadline).toBeLessThanOrEqual(claims.exp * 1000);
  expect(Date.parse(body.candidates.observedAt)).toBeLessThanOrEqual(Date.now());
  expect(Date.parse(body.candidates.validUntil)).toBeGreaterThan(Date.now());
  const next = await read({ ...scope, continuation: body.candidates.continuation });
  expect(next.status).toBe(200);
  const second = await next.json();
  expect(second.candidates.items).toEqual([expect.objectContaining({ id: ids[20], title: expected[20].title, taskType: "initiative", parentTaskId: epicId, approvalStatus: "approved" })]);
  expect(second.candidates).toMatchObject({ total: 21, coverage: "complete", continuation: null, sourceRevision: body.candidates.sourceRevision, observedAt: body.candidates.observedAt, validUntil: body.candidates.validUntil });
  expect(second.readActor).toEqual(body.readActor);
  expect(second.readAuthority.userId).toBe(body.readAuthority.userId);
  expect(second.readAuthority.deadline).toBeLessThanOrEqual(body.readAuthority.deadline);
  const rpc = dispatches.findIndex(row => row.path === "/rest/v1/rpc/planning_item_candidates");
  expect(rpc).toBeGreaterThan(-1);
  expect(dispatches.filter(row => row.path === "/rest/v1/rpc/planning_item_candidates")).toHaveLength(1);
  expect(dispatches.filter(row => ["/rest/v1/active_tasks", "/rest/v1/tasks", "/rest/v1/profiles"].includes(row.path))).toEqual([]);
  expect(dispatches.slice(rpc + 1).filter(row => row.path === "/rest/v1/rpc/planning_board_publication_context" && row.actor === "founder")).toHaveLength(1);
  // Initial session admission is separate from the fresh check at the privileged candidate RPC.
  expect(dispatches.slice(0, rpc).filter(row => row.path === "/rest/v1/rpc/current_authenticated_profile" && row.actor === "founder")).toHaveLength(2);
}), 120_000);
