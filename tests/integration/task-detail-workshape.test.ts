import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("canonical detail keeps its content read shape across independent history, child and directed fanout changes", () => withPlanningCredentialDatabase(async f => {
  const target = `${f.prefix}-shape-target`, donor = `${f.prefix}-shape-donor`;
  const endpoints = [`${f.prefix}-shape-left`, `${f.prefix}-shape-right`];
  const children = [`${f.prefix}-shape-child-1`, `${f.prefix}-shape-child-2`];
  for (const id of [target, donor, ...endpoints]) await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,owner,assignee,approval_status)
    values($1,'findmydoc-founder-execution','Canonical shape fixture','Complete independent content','deliverable',$2,'Offen','P2',$3,$3,'approved')`, [id, f.initiativeId, f.actors.founder.profileId]);
  for (const id of children) await f.db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner)
    values($1,'findmydoc-founder-execution','Fixed child reservoir','sub_issue',$2,'Offen','P2',$3)`, [id, donor, f.actors.founder.profileId]);
  const transport = globalThis.fetch, content: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (/\/rest\/v1\/(active_tasks|task_links|planning_item_strategy|planning_item_raci_assignments|task_relationship_edges|task_blockers|task_dependencies|task_comments|task_external_comments|task_audit_timeline|task_reviews)$/.test(url.pathname)) {
      url.searchParams.sort(); content.push(url.pathname + url.search);
    }
    return transport(request);
  });
  const { GET } = await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts", { "server-only": {} });
  const canonical = async () => {
    content.splice(0);
    const response: Response = await GET(f.request("founder", `/api/tasks/${target}/detail-data?area=target`), { params: Promise.resolve({ id: target }) });
    expect(response.status).toBe(200);
    const { taskDetail: model } = await response.json();
    expect(model.item).toMatchObject({ id: target, description: "Complete independent content" });
    expect(model.ancestors.map((item: { id: string }) => item.id)).toEqual([`${f.prefix}-epic`, f.initiativeId]);
    expect(model.children).toEqual([]); expect(model.relatedItems).toEqual([]);
    expect(model.relationships).toEqual([]); expect(model.coverage).toEqual({});
    expect(content.some(value => /\/(task_relationship_edges|task_blockers|task_dependencies|task_comments|task_external_comments|task_audit_timeline|task_reviews)(\?|$)/.test(value))).toBe(false);
    const taskReads = content.filter(value => value.startsWith("/rest/v1/active_tasks?"));
    expect(taskReads).toHaveLength(3);
    expect(taskReads.every(value => new URL(value, "http://localhost:3000").searchParams.has("id"))).toBe(true);
    return { item: model.item, ancestors: model.ancestors, content: [...content].sort() };
  };
  const counts = async () => (await f.db.query(`select
    (select count(*)::integer from public.tasks where id like $2||'-shape-history-%') as history,
    (select count(*)::integer from public.tasks where parent_task_id=$1) as children,
    (select count(*)::integer from public.task_relationship_edges where task_id=$1 or related_task_id=$1) as fanout`, [target, f.prefix])).rows[0];
  const before = await canonical(); expect(await counts()).toEqual({ history: 0, children: 0, fanout: 0 });
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority)
    select $1||'-shape-history-'||n,'findmydoc-founder-execution','Unrelated completed history','epic','Erledigt','P2' from generate_series(1,40) n`, [f.prefix]);
  expect(await counts()).toEqual({ history: 40, children: 0, fanout: 0 }); expect(await canonical()).toEqual(before);
  const types = async () => (await f.db.query("select task_type,count(*)::integer as total from public.tasks where id like $1||'%' group by task_type order by task_type", [f.prefix])).rows;
  const fixedTypes = await types();
  await f.db.query("update public.tasks set parent_task_id=$1 where id=any($2)", [target, children]);
  expect(await counts()).toEqual({ history: 40, children: 2, fanout: 0 }); expect(await types()).toEqual(fixedTypes); expect(await canonical()).toEqual(before);
  await f.db.query("insert into public.task_relationship_edges(task_id,related_task_id,relation_type) values($1,$2,'blocked_by'),($3,$1,'blocked_by')", [target, endpoints[0], endpoints[1]]);
  expect(await counts()).toEqual({ history: 40, children: 2, fanout: 2 }); expect(await types()).toEqual(fixedTypes); expect(await canonical()).toEqual(before);
}));
