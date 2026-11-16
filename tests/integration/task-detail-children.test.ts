import { createClient } from "@supabase/supabase-js";
import { expect, test } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("independent direct children enumerate above provider limits with complete progress and canonical navigation", () => withPlanningCredentialDatabase(async f => {
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,owner,sort_order,approval_status)
    select $1||'-child-'||lpad(n::text,4,'0'),'findmydoc-founder-execution','Synthetic direct child','Private full child content','deliverable',$2,
      case when n=1008 then 'Offen' else 'Erledigt' end,'P2',$3,0,'approved' from generate_series(1,1008) n`,
  [f.prefix, f.initiativeId, f.actors.founder.profileId]);
  const firstChild = `${f.prefix}-child-0001`, lastChild = `${f.prefix}-child-1008`;
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner)
    values($1,'findmydoc-founder-execution','Synthetic descendant','sub_issue',$2,'Offen','P2',$3)`,
  [`${f.prefix}-grandchild`, lastChild, f.actors.founder.profileId]);
  const { GET } = await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts", { "server-only": {} });
  const read = (id: string, area: string) => GET(f.request("founder", `/api/tasks/${id}/detail-data?area=${area}`), { params: Promise.resolve({ id }) });
  // Use the established complete TypeScript migration reference independently
  // from the authenticated scoped API and its original per-request deadline.
  const { loadPlanningWorkspaceModel } = await importTestModule("src/features/planning-items/server/planning-workspace-read-source.ts", { "server-only": {} });
  const referenceClient = createClient(f.local.API_URL, f.local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const complete = await loadPlanningWorkspaceModel(referenceClient, { authorized: true, actorProfileId: f.actors.founder.profileId, query: { view: "complete" } });
  expect(complete.status).toBe("ready");
  if (complete.status !== "ready") throw new Error("Complete TypeScript child reference was unavailable");
  const referenceChildren = complete.model.items.filter((item: { parentTaskId: string }) => item.parentTaskId === f.initiativeId);
  expect(referenceChildren).toHaveLength(1008);
  const before = f.observed.length;
  const response: Response = await read(f.initiativeId, "children");
  expect(response.status).toBe(200);
  const { taskDetail: model, readAuthority } = await response.json();
  expect(model.readArea).toBe("children");
  expect(model.coverage.children).toBe("complete");
  expect(model.children).toHaveLength(1008);
  expect(model.children.map((child: { id: string }) => child.id)).toEqual(referenceChildren.map((child: { id: string }) => child.id));
  expect(model.children[0].id).toBe(firstChild);
  expect(model.children[1007].id).toBe(lastChild);
  expect(new Set(model.children.map((child: { id: string }) => child.id)).size).toBe(1008);
  expect(model.children.some((child: { id: string }) => child.id === `${f.prefix}-grandchild`)).toBe(false);
  expect(model.childProgress).toEqual({ completed: 1007, total: 1008, unfinished: 1, percentage: 100 });
  expect(model.children.every((child: { detailAvailability: string }) => child.detailAvailability === "summary")).toBe(true);
  expect(model.children[0]).not.toHaveProperty("description");
  expect(model.authorityDeadline).toBe(readAuthority.deadline);
  expect(model.readActor).toEqual({ profileId: f.actors.founder.profileId, platformRole: "founder" });
  expect(f.observed.slice(before).some(entry => /\/(task_comments|task_external_comments|task_audit_timeline|task_reviews|task_relationship_edges|task_links|planning_item_strategy|planning_item_raci_assignments)$/.test(entry.path))).toBe(false);
  const opened: Response = await read(lastChild, "target");
  expect(opened.status).toBe(200);
  expect((await opened.json()).taskDetail.item).toMatchObject({ id: lastChild, description: "Private full child content" });
}), 120_000);
