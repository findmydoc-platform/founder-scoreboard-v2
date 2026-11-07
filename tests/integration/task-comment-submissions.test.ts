import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

it("legacy text-only comments retain truncation while identified submissions reject oversized content", () => withPlanningCredentialDatabase(async f => {
  const next = await import("next/server");
  const route = await importTestModule("src/app/api/tasks/[id]/comments/route.ts", { "server-only": {}, "next/server": { ...next, after: () => undefined } });
  const path = `/api/tasks/${f.initiativeId}/comments`;
  const comment = ` ${"x".repeat(4000)}y `;
  const legacy = await route.POST(f.request("founder", path, "POST", { comment }), context(f.initiativeId));
  expect(legacy.status).toBe(200);
  const receipt = await legacy.json();
  expect(receipt.comment.comment).toBe("x".repeat(4000));
  const lookup = await route.GET(f.request("founder", `${path}?submissionId=${receipt.comment.submissionId}`), context(f.initiativeId));
  expect(await lookup.json()).toMatchObject({ outcome: "confirmed", comment: { comment: "x".repeat(4000) } });
  const submissionId = randomUUID();
  const identified = await route.POST(f.request("founder", path, "POST", { comment, submissionId, submittedAt: "2026-11-06T12:00:00Z" }), context(f.initiativeId));
  expect(identified.status).toBe(400);
  expect(await (await route.GET(f.request("founder", `${path}?submissionId=${submissionId}`), context(f.initiativeId))).json()).toEqual({ ok: true, outcome: "unconfirmed" });
}));

it("replayed authenticated submissions retain one comment, notification set and durable delivery job", () => withPlanningCredentialDatabase(async f => {
  const taskId = `${f.prefix}-comment`;
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,owner,assignee,parent_task_id)
    values($1,'findmydoc-founder-execution','Comment acceptance','deliverable','In Arbeit','P2',$2,$2,$3)`, [taskId, f.actors.founder.profileId, f.initiativeId]);
  const scheduled: Array<() => Promise<void>> = [];
  const next = await import("next/server");
  const route = await importTestModule("src/app/api/tasks/[id]/comments/route.ts", { "server-only": {}, "next/server": { ...next, after: (callback: () => Promise<void>) => scheduled.push(callback) } });
  const submitted = { comment: "Durable discussion evidence", submissionId: randomUUID(), submittedAt: "2026-11-06T12:00:00.000Z" };
  const send = (body = submitted) => route.POST(f.request("founder", `/api/tasks/${taskId}/comments`, "POST", body), context(taskId));
  const responses = await Promise.all([send(), send(), send()]);
  expect(responses.map(response => response.status)).toEqual([200, 200, 200]);
  const receipts = await Promise.all(responses.map(response => response.json()));
  expect(new Set(receipts.map(receipt => receipt.comment.id)).size).toBe(1);
  expect(receipts[0].comment).toMatchObject({ submissionId: submitted.submissionId, submittedAt: submitted.submittedAt, githubDeliveryStatus: "waiting_for_issue" });
  const id = receipts[0].comment.id;
  // Framework callbacks are intentionally held: app confirmation is already complete.
  expect(scheduled.length).toBeGreaterThan(0);
  expect((await f.db.query("select count(*)::int as count from public.task_comment_github_deliveries where task_comment_id=$1", [id])).rows[0].count).toBe(1);
  const notifications = (await f.db.query("select recipient_profile_id from public.notification_events where entity_id=$1 and type='task.comment'", [taskId])).rows;
  expect(notifications.map(row => row.recipient_profile_id).sort()).toEqual([f.actors.ceo.profileId, f.actors.deputy.profileId].sort());
  const lookup = await route.GET(f.request("founder", `/api/tasks/${taskId}/comments?submissionId=${submitted.submissionId}`), context(taskId));
  expect(await lookup.json()).toMatchObject({ outcome: "confirmed", comment: { id, submissionId: submitted.submissionId } });
  const details = await importTestModule("src/app/api/tasks/[id]/detail-data/route.ts", { "server-only": {} });
  const reloaded = await details.GET(f.request("founder", `/api/tasks/${taskId}/detail-data`), context(taskId));
  expect((await reloaded.json()).taskDetail.discussion.comments).toMatchObject([{ id, submissionId: submitted.submissionId, submittedAt: submitted.submittedAt }]);
  expect((await send({ ...submitted, comment: "Changed immutable content" })).status).toBe(409);
  expect((await send({ ...submitted, submittedAt: "2026-11-06T12:00:01.000Z" })).status).toBe(409);
  const intentional = await send({ ...submitted, submissionId: randomUUID() });
  expect((await intentional.json()).comment.id).not.toBe(id);
  for (const deliver of scheduled) await deliver();
  expect(await (await route.GET(f.request("founder", `/api/tasks/${taskId}/comments?submissionId=${submitted.submissionId}`), context(taskId))).json()).toMatchObject({ outcome: "confirmed", comment: { id } });
}));

it("an in-flight submission stays unresolved until commit and a lost response is recovered by identity", () => withPlanningCredentialDatabase(async f => {
  const next = await import("next/server");
  const route = await importTestModule("src/app/api/tasks/[id]/comments/route.ts", { "server-only": {}, "next/server": { ...next, after: () => undefined } });
  const submissionId = randomUUID(), taskId = f.initiativeId;
  await f.db.query("select pg_advisory_lock(hashtextextended($1,614))", [submissionId]);
  const writing = route.POST(f.request("founder", `/api/tasks/${taskId}/comments`, "POST", { submissionId, submittedAt: "2026-11-06T12:00:00Z", comment: "Lost response can be recovered" }), context(taskId));
  try {
    await vi.waitFor(() => expect(f.observed.some(entry => entry.path === "/rest/v1/rpc/create_task_comment_submission")).toBe(true));
    const unresolved = await route.GET(f.request("founder", `/api/tasks/${taskId}/comments?submissionId=${submissionId}`), context(taskId));
    expect(await unresolved.json()).toEqual({ ok: true, outcome: "unconfirmed" });
  } finally { await f.db.query("select pg_advisory_unlock(hashtextextended($1,614))", [submissionId]); }
  // Discard the POST body, as when the transport loses the successful response.
  expect((await writing).status).toBe(200);
  const receipt = await route.GET(f.request("founder", `/api/tasks/${taskId}/comments?submissionId=${submissionId}`), context(taskId));
  expect(await receipt.json()).toMatchObject({ outcome: "confirmed", comment: { submissionId, comment: "Lost response can be recovered", githubDeliveryStatus: "not_applicable" } });
}));

it("submission lookup and replay preserve actor, item, session and direct Data API boundaries", () => withPlanningCredentialDatabase(async f => {
  const next = await import("next/server");
  const route = await importTestModule("src/app/api/tasks/[id]/comments/route.ts", { "server-only": {}, "next/server": { ...next, after: () => undefined } });
  const taskId = f.initiativeId, submissionId = randomUUID();
  const body = { submissionId, submittedAt: "2026-11-06T12:00:00Z", comment: "Protected submission" };
  expect((await route.POST(f.request("founder", `/api/tasks/${taskId}/comments`, "POST", body), context(taskId))).status).toBe(200);
  expect((await route.POST(f.request("other", `/api/tasks/${taskId}/comments`, "POST", body), context(taskId))).status).toBe(409);
  const otherItem = `${f.prefix}-epic`;
  expect((await route.POST(f.request("founder", `/api/tasks/${otherItem}/comments`, "POST", body), context(otherItem))).status).toBe(409);
  for (const actor of ["other", "ceo", "deputy"] as const) {
    expect(await (await route.GET(f.request(actor, `/api/tasks/${taskId}/comments?submissionId=${submissionId}`), context(taskId))).json()).toEqual({ ok: true, outcome: "unconfirmed" });
  }
  for (const actor of ["viewer", "unmapped"] as const) {
    expect((await route.GET(f.request(actor, `/api/tasks/${taskId}/comments?submissionId=${submissionId}`), context(taskId))).status).toBe(403);
    expect((await route.POST(f.request(actor, `/api/tasks/${taskId}/comments`, "POST", body), context(taskId))).status).toBe(403);
  }
  expect((await route.GET(new next.NextRequest(`http://localhost:3000/api/tasks/${taskId}/comments?submissionId=${submissionId}`), context(taskId))).status).toBe(401);
  expect((await route.GET(f.request("founder", `/api/tasks/${taskId}/comments?submissionId=invalid`), context(taskId))).status).toBe(400);
  expect((await route.POST(f.request("founder", `/api/tasks/${taskId}/comments`, "POST", { ...body, submissionId: "invalid" }), context(taskId))).status).toBe(400);
  expect((await route.POST(f.request("founder", `/api/tasks/${taskId}/comments`, "POST", { ...body, submissionId: randomUUID(), comment: "x".repeat(4001) }), context(taskId))).status).toBe(400);
  for (const actor of ["founder", "ceo", "deputy", "viewer", "unmapped", "anonymous"] as const) {
    const direct = await f.rpc("create_task_comment_submission", { p_submission_id: randomUUID(), p_submitted_at: body.submittedAt, p_task_id: taskId, p_profile_id: f.actors.founder.profileId, p_comment: body.comment, p_deliver_to_github: false }, actor);
    expect([401, 403]).toContain(direct.status);
  }
  await f.db.query("delete from auth.sessions where id=$1", [f.actors.founder.sessionId]);
  expect((await route.GET(f.request("founder", `/api/tasks/${taskId}/comments?submissionId=${submissionId}`), context(taskId))).status).toBe(401);
}));
