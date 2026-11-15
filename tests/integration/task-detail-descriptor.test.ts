import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("canonical target and exact root-first ancestors share one bounded content batch without publishing its descriptor", () => withPlanningCredentialDatabase(async f => {
  const target = `${f.prefix}-descriptor-target`, epic = `${f.prefix}-epic`;
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,owner,assignee)
    values($1,'findmydoc-founder-execution','Descriptor target','Complete descriptor content','deliverable',$2,'Offen','P2',$3,$3)`, [target, f.initiativeId, f.actors.founder.profileId]);
  const transport = globalThis.fetch, content: string[] = [], certificates: Array<{ source_revision: string; observed_at: string; valid_until: string | null }> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.endsWith("/active_tasks")) content.push(url.searchParams.get("id") || "unbounded");
    const response = await transport(request);
    if (url.pathname.endsWith("/rpc/planning_detail_source")) certificates.push(await response.clone().json());
    return response;
  });
  const { GET } = await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts", { "server-only": {} });
  const response: Response = await GET(f.request("founder", `/api/tasks/${target}/detail-data?area=target`), { params: Promise.resolve({ id: target }) });
  expect(response.status).toBe(200);
  const body = await response.json(), model = body.taskDetail;
  expect(model.item).toMatchObject({ id: target, description: "Complete descriptor content" });
  expect(model.ancestors.map((item: { id: string }) => item.id)).toEqual([epic, f.initiativeId]);
  expect(model.children).toEqual([]); expect(model.relatedItems).toEqual([]); expect(model.coverage).toEqual({});
  expect(model.readActor).toEqual({ profileId: f.actors.founder.profileId, platformRole: "founder" });
  expect(model.authorityDeadline).toBe(body.readAuthority.deadline);
  expect(model.sourceRevision).toBe(certificates[0].source_revision);
  expect(model.observedAt).toBe(certificates[0].observed_at); expect(model.validUntil).toBe(certificates[0].valid_until);
  for (const key of ["target_id", "ancestor_ids", "descriptor"]) { expect(body).not.toHaveProperty(key); expect(model).not.toHaveProperty(key); }
  expect(content).toHaveLength(1);
  expect(content).toEqual([`in.(${target},${epic},${f.initiativeId})`]);
}));
