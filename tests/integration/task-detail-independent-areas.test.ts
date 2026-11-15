import { expect, test, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

test("canonical target and root-first ancestors are usable before requested discussion and timeline", () => withPlanningCredentialDatabase(async f => {
  const taskId = `${f.prefix}-independent-detail`;
  await f.db.query(`insert into public.tasks(id,project_id,title,description,task_type,parent_task_id,status,priority,owner,assignee,acceptance_criteria,definition_of_done)
    values($1,'findmydoc-founder-execution','Independent synthetic target','Complete synthetic content','deliverable',$2,'Offen','P2',$3,$3,'Synthetic AC','Synthetic DoD')`, [taskId, f.initiativeId, f.actors.founder.profileId]);
  const transport = globalThis.fetch;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { entered = resolve; });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const next = new Request(input, init);
    if (/\/(task_comments|task_external_comments|task_audit_timeline|task_reviews)$/.test(new URL(next.url).pathname)) { entered(); await gate; }
    return transport(next);
  });
  const { GET } = await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts", { "server-only": {} });
  const initial: Promise<Response> = GET(f.request("founder", `/api/tasks/${taskId}/detail-data?area=target`), { params: Promise.resolve({ id: taskId }) });
  try {
    const first = await Promise.race([initial.then(response => ({ kind: "target" as const, response })), held.then(() => ({ kind: "secondary" as const }))]);
    expect(first.kind).toBe("target");
    if (first.kind !== "target") throw new Error("Canonical detail waited for unrelated secondary content");
    expect(first.response.status).toBe(200);
    const { taskDetail } = await first.response.json();
    expect(taskDetail.item).toMatchObject({ id: taskId, description: "Complete synthetic content", acceptanceCriteria: "Synthetic AC", definitionOfDone: "Synthetic DoD", ownerId: f.actors.founder.profileId });
    expect(taskDetail.ancestors.map((item: { id: string }) => item.id)).toEqual([`${f.prefix}-epic`, f.initiativeId]);
    expect(taskDetail.coverage).not.toHaveProperty("discussion");
    expect(taskDetail.coverage).not.toHaveProperty("timeline");
  } finally { release(); await initial; }
}));

test("a contributing source change during target hydration cannot publish the earlier detail", () => withPlanningCredentialDatabase(async f => {
  const transport = globalThis.fetch;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { entered = resolve; });
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const next = new Request(input, init);
    if (new URL(next.url).pathname.endsWith("/task_links")) { entered(); await gate; }
    return transport(next);
  });
  const { GET } = await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts", { "server-only": {} });
  const pending: Promise<Response> = GET(f.request("founder", `/api/tasks/${f.initiativeId}/detail-data?area=target`), { params: Promise.resolve({ id: f.initiativeId }) });
  await held;
  try {
    await f.db.query("update public.tasks set description='Concurrent canonical content' where id=$1", [f.initiativeId]);
  } finally { release(); }
  const response = await pending;
  expect(response.status).toBe(409);
  expect(await response.json()).not.toHaveProperty("taskDetail");
}));

test("discussion has independent source evidence for comment-only changes without a timeline read", () => withPlanningCredentialDatabase(async f => {
  const { GET } = await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts", { "server-only": {} });
  const read = (area: string) => GET(f.request("founder", `/api/tasks/${f.initiativeId}/detail-data?area=${area}`), { params: Promise.resolve({ id: f.initiativeId }) });
  const coreBefore = await (await read("target")).json();
  const before = f.observed.length;
  const response = await read("discussion");
  expect(response.status).toBe(200);
  const discussionBefore = await response.json();
  expect(discussionBefore.taskDetail.coverage).toEqual({ discussion: "complete" });
  expect(f.observed.slice(before).some(entry => /\/(task_audit_timeline|task_reviews)$/.test(entry.path))).toBe(false);
  await f.db.query("insert into public.task_comments(task_id,profile_id,comment) values($1,$2,'Comment-only source change')", [f.initiativeId, f.actors.founder.profileId]);
  const discussionAfter = await (await read("discussion")).json();
  const coreAfter = await (await read("target")).json();
  expect(discussionAfter.taskDetail.discussion.comments).toMatchObject([{ comment: "Comment-only source change" }]);
  expect(discussionAfter.taskDetail.sourceRevision).not.toBe(discussionBefore.taskDetail.sourceRevision);
  expect(coreAfter.taskDetail.item.updatedAt).toBe(coreBefore.taskDetail.item.updatedAt);
  expect(coreAfter.taskDetail.sourceRevision).toBe(coreBefore.taskDetail.sourceRevision);
}));
