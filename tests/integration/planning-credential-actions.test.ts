import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

const context = (id: string) => ({ params: Promise.resolve({ id }) });

it.each(["legacy", "linking"] as const)("Planning %s reads and corrections retain actual owner, revision, permit and administrator boundaries", mode => withPlanningCredentialDatabase(async f => {
  const own = `${f.prefix}-own`, foreign = `${f.prefix}-foreign`;
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,assignee,owner,review_status,score_final,parent_task_id)
    values($1,'findmydoc-founder-execution','Own planning task','deliverable','In Arbeit','P2','approved',$3,$3,'not_requested',false,$5),
    ($2,'findmydoc-founder-execution','Foreign planning task','deliverable','In Arbeit','P2','approved',$4,$4,'not_requested',false,$5)`, [own, foreign, f.actors.founder.profileId, f.actors.other.profileId, f.initiativeId]);
  const revision = async (id: string) => (await f.db.query("select to_jsonb(updated_at)#>>'{}' as updated_at from public.tasks where id=$1", [id])).rows[0].updated_at as string;
  const before = await revision(own);
  const { GET } = await importTestModule("src/app/api/planning-revision/route.ts", { "server-only": {} });
  expect((await GET(f.request("viewer", "/api/planning-revision"))).status).toBe(200);
  expect((await GET(f.request("unmapped", "/api/planning-revision"))).status).toBe(403);
  const route = await importTestModule("src/app/api/tasks/[id]/route.ts", { "server-only": {} });
  const update = (actor: "founder" | "other" | "viewer" | "administrator", id: string, expectedUpdatedAt: string, title: string) => route.PATCH(f.request(actor, `/api/tasks/${id}`, "PATCH", { expectedUpdatedAt, title }), context(id));
  expect((await update("founder", own, before, "Owner revision saved")).status).toBe(200);
  expect((await f.db.query("select title from public.tasks where id=$1", [own])).rows[0].title).toBe("Owner revision saved");
  expect((await update("founder", own, before, "Stale overwrite")).status).toBe(409);
  expect((await update("other", own, await revision(own), "Foreign overwrite")).status).toBe(403);
  expect((await update("viewer", own, await revision(own), "Viewer overwrite")).status).toBe(403);
  expect((await update("administrator", foreign, await revision(foreign), "Administrator correction")).status).toBe(200);

  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const held = await authorizeCredentialAction({ credential: { kind: "session-request", request: f.request("administrator", `/api/tasks/${foreign}`) }, action: "planning.task.update", targetId: foreign });
  expect(held.ok).toBe(true);
  await f.db.query("update public.administrator_access_grants set active_until=now()-interval '1 second' where profile_id=$1", [f.actors.administrator.profileId]);
  if (!held.ok) throw new Error("Expected administrator correction capability");
  expect(await held.planning.revise({ expectedUpdatedAt: await revision(foreign), title: "Expired overwrite" })).toMatchObject({ ok: false, error: { kind: "forbidden", code: "administrator_access_expired" } });
  expect((await f.db.query("select title from public.tasks where id=$1", [foreign])).rows[0].title).toBe("Administrator correction");
  const correction = f.observed.filter(request => request.path.endsWith("/update_administrator_planning_task_transaction_v2"));
  expect(correction).toHaveLength(1);
  expect(correction[0]).toMatchObject({ actor: "administrator", method: "POST", permit: mode === "linking" });
  if (mode === "linking") {
    const direct = await f.nativeFetch(`${f.local.API_URL}/rest/v1/active_tasks?select=id&id=eq.${own}`, { headers: { apikey: f.local.ANON_KEY, authorization: `Bearer ${f.actors.founder.token}` } });
    expect(direct.status).toBe(403);
    expect(f.observed.some(request => request.actor === "founder" && request.path.endsWith("/current_authenticated_profile") && request.permit)).toBe(true);
  }
  await f.db.query("delete from auth.sessions where id=$1", [f.actors.founder.sessionId]);
  expect((await update("founder", own, await revision(own), "Revoked overwrite")).status).toBe(401);
}, mode), 30_000);

it("ordinary creation, approval and trash retain contributor proposals, CEO approval and lead-only restoration", () => withPlanningCredentialDatabase(async f => {
  const create = await importTestModule("src/app/api/tasks/route.ts", { "server-only": {} });
  const payload = { creationRequestId: randomUUID(), taskType: "deliverable", title: "Synthetic ordinary proposal", parentTaskId: f.initiativeId, ownerId: f.actors.founder.profileId,
    problemStatement: "A testable planning boundary needs evidence.", intendedOutcome: "The approved owner can propose work.", scopeConstraints: "Synthetic acceptance fixture only.", acceptanceCriteria: "The stored actor and approval remain authoritative.", evidenceRequired: "An isolated transaction assertion.", definitionOfDone: "The owner and role controls pass." };
  expect((await create.POST(f.request("viewer", "/api/tasks", "POST", payload))).status).toBe(403);
  const response = await create.POST(f.request("founder", "/api/tasks", "POST", payload));
  const body = await response.json();
  expect(response.status, body.error).toBe(200);
  let id = body.task.id as string;
  expect(id.startsWith(f.prefix)).toBe(true);
  expect((await f.db.query("select created_by,approval_status from public.tasks where id=$1", [id])).rows[0]).toMatchObject({ created_by: f.actors.founder.profileId, approval_status: "proposed" });
  const approval = await importTestModule("src/app/api/tasks/[id]/approval/route.ts", { "server-only": {} });
  expect((await approval.POST(f.request("founder", `/api/tasks/${id}/approval`, "POST", { action: "approve", expectedRevision: 1 }), context(id))).status).toBe(403);
  expect((await approval.POST(f.request("ceo", `/api/tasks/${id}/approval`, "POST", { action: "approve", expectedRevision: 1 }), context(id))).status).toBe(200);
  const approvedRevision = (await f.db.query("select approval_revision from public.tasks where id=$1", [id])).rows[0].approval_revision;
  expect((await approval.POST(f.request("ceo", `/api/tasks/${id}/approval`, "POST", { action: "return_to_draft", expectedRevision: approvedRevision, note: "An approved proposal cannot re-enter this decision transaction." }), context(id))).status).toBe(409);
  expect((await f.db.query("select approval_status from public.tasks where id=$1", [id])).rows[0].approval_status).toBe("approved");
  const withdrawable = await create.POST(f.request("founder", "/api/tasks", "POST", { ...payload, creationRequestId: randomUUID(), title: "Synthetic withdrawable proposal" }));
  expect(withdrawable.status).toBe(200);
  id = (await withdrawable.json()).task.id;
  const withdraw = await importTestModule("src/app/api/tasks/[id]/withdraw/route.ts", { "server-only": {} });
  const approved = (await f.db.query("select approval_revision from public.tasks where id=$1", [id])).rows[0].approval_revision;
  expect((await withdraw.POST(f.request("other", `/api/tasks/${id}/withdraw`, "POST", { expectedRevision: approved, reason: "Foreign owner must not withdraw this proposal." }), context(id))).status).toBe(403);
  expect((await withdraw.POST(f.request("founder", `/api/tasks/${id}/withdraw`, "POST", { expectedRevision: approved, reason: "Withdraw the isolated test proposal." }), context(id))).status).toBe(200);
  const trashed = (await f.db.query("select trashed_at,trash_revision from public.tasks where id=$1", [id])).rows[0];
  expect(trashed.trashed_at).not.toBeNull();
  const restore = await importTestModule("src/app/api/tasks/[id]/restore/route.ts", { "server-only": {} });
  expect((await restore.POST(f.request("founder", `/api/tasks/${id}/restore`, "POST", { expectedTrashRevision: trashed.trash_revision }), context(id))).status).toBe(403);
  expect((await restore.POST(f.request("deputy", `/api/tasks/${id}/restore`, "POST", { expectedTrashRevision: trashed.trash_revision }), context(id))).status).toBe(200);
  expect((await f.db.query("select trashed_at from public.tasks where id=$1", [id])).rows[0].trashed_at).toBeNull();
  const epicPayload = { creationRequestId: randomUUID(), taskType: "epic", title: "Synthetic strategic Epic" };
  expect((await create.POST(f.request("founder", "/api/tasks", "POST", epicPayload))).status).toBe(403);
  const epicResponse = await create.POST(f.request("deputy", "/api/tasks", "POST", epicPayload));
  expect(epicResponse.status).toBe(200);
  const epic = (await epicResponse.json()).task;
  const taskRoute = await importTestModule("src/app/api/tasks/[id]/route.ts", { "server-only": {} });
  const deletion = { expectedUpdatedAt: epic.updatedAt };
  expect((await taskRoute.DELETE(f.request("founder", `/api/tasks/${epic.id}`, "DELETE", deletion), context(epic.id))).status).toBe(403);
  expect((await taskRoute.DELETE(f.request("deputy", `/api/tasks/${epic.id}`, "DELETE", deletion), context(epic.id))).status).toBe(200);
  expect((await f.db.query("select count(*)::int as count from public.tasks where id=$1", [epic.id])).rows[0].count).toBe(0);
}), 30_000);

it("review, relationship and human comment operations preserve the observed actor and task ownership", () => withPlanningCredentialDatabase(async f => {
  const own = `${f.prefix}-review`, related = `${f.prefix}-related`;
  await f.db.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,assignee,owner,review_owner_profile_id,evidence_link,parent_task_id)
    values($1,'findmydoc-founder-execution','Owner review','deliverable','In Arbeit','P2','approved',$3,$3,$4,'https://example.test/evidence',$5),
    ($2,'findmydoc-founder-execution','Related task','deliverable','In Arbeit','P2','approved',$4,$4,$3,null,$5)`, [own, related, f.actors.founder.profileId, f.actors.other.profileId, f.initiativeId]);
  const revision = async () => (await f.db.query("select to_jsonb(updated_at)#>>'{}' as updated_at from public.tasks where id=$1", [own])).rows[0].updated_at;
  const relationships = await importTestModule("src/app/api/tasks/[id]/relationships/route.ts", { "server-only": {} });
  const relationPayload = { relationType: "blocked_by", relatedTaskId: related, note: "Owned dependency", expectedUpdatedAt: await revision() };
  expect((await relationships.POST(f.request("other", `/api/tasks/${own}/relationships`, "POST", relationPayload), context(own))).status).toBe(403);
  expect((await relationships.POST(f.request("founder", `/api/tasks/${own}/relationships`, "POST", relationPayload), context(own))).status).toBe(200);
  const review = await importTestModule("src/app/api/tasks/[id]/route.ts", { "server-only": {} });
  const reviewPayload = { expectedUpdatedAt: await revision(), status: "Review", reviewStatus: "requested", evidenceLinks: ["https://example.test/evidence"] };
  expect((await review.PATCH(f.request("other", `/api/tasks/${own}`, "PATCH", reviewPayload), context(own))).status).toBe(403);
  expect((await review.PATCH(f.request("founder", `/api/tasks/${own}`, "PATCH", reviewPayload), context(own))).status).toBe(200);
  expect((await f.db.query("select review_status from public.tasks where id=$1", [own])).rows[0].review_status).toBe("requested");
  const withdraw = await importTestModule("src/app/api/tasks/[id]/review/withdraw/route.ts", { "server-only": {} });
  expect((await withdraw.POST(f.request("founder", `/api/tasks/${own}/review/withdraw`, "POST", { expectedUpdatedAt: await revision(), reason: "Add the missing isolated evidence." }), context(own))).status).toBe(200);
  const comments = await importTestModule("src/app/api/tasks/[id]/comments/route.ts", { "server-only": {} });
  expect((await comments.POST(f.request("viewer", `/api/tasks/${own}/comments`, "POST", { comment: "Viewer must not publish a comment." }), context(own))).status).toBe(403);
  const comment = await comments.POST(f.request("founder", `/api/tasks/${own}/comments`, "POST", { comment: "Synthetic owner collaboration evidence." }), context(own));
  expect(comment.status).toBe(200);
  const stored = (await f.db.query("select task_id,profile_id,comment from public.task_comments where id=$1", [(await comment.json()).comment.id])).rows[0];
  expect(stored).toEqual({ task_id: own, profile_id: f.actors.founder.profileId, comment: "Synthetic owner collaboration evidence." });
}), 30_000);

it("sprint, governance, Focus and Weekly operations preserve lead and owner distinctions", () => withPlanningCredentialDatabase(async f => {
  const sprint = `${f.prefix}-sprint`, task = `${f.prefix}-focus`;
  await f.db.query("insert into public.sprints(id,project_id,name,start_date,end_date,review_due_at,status) values($1,'findmydoc-founder-execution','Synthetic acceptance sprint',current_date-28,current_date-15,now()-interval '2 days','review')", [sprint]);
  await f.db.query("insert into public.tasks(id,project_id,title,task_type,status,priority,approval_status,assignee,owner,parent_task_id) values($1,'findmydoc-founder-execution','Owner focus','deliverable','In Arbeit','P2','approved',$2,$2,$3)", [task, f.actors.founder.profileId, f.initiativeId]);
  const meeting = (await f.db.query("insert into public.meetings(sprint_id,title,meeting_at,status) values($1,'Synthetic weekly',now()+interval '1 day','planned') returning id", [sprint])).rows[0].id;
  const destination = `${f.prefix}-destination`;
  await f.db.query("insert into public.sprints(id,project_id,name,start_date,end_date,status) values($1,'findmydoc-founder-execution','Synthetic destination',current_date+7,current_date+20,'planning')", [destination]);
  const assignmentRoute = await importTestModule("src/app/api/tasks/bulk-sprint-assignment/route.ts", { "server-only": {} });
  const assignment = { sprintId: destination, assignments: [{ taskId: task, expectedUpdatedAt: (await f.db.query("select to_jsonb(updated_at)#>>'{}' as updated_at from public.tasks where id=$1", [task])).rows[0].updated_at }] };
  expect((await assignmentRoute.PATCH(f.request("founder", "/api/tasks/bulk-sprint-assignment", "PATCH", assignment))).status).toBe(403);
  expect((await assignmentRoute.PATCH(f.request("deputy", "/api/tasks/bulk-sprint-assignment", "PATCH", assignment))).status).toBe(200);
  expect((await f.db.query("select sprint_id from public.tasks where id=$1", [task])).rows[0].sprint_id).toBe(destination);
  expect((await assignmentRoute.PATCH(f.request("deputy", "/api/tasks/bulk-sprint-assignment", "PATCH", assignment))).status).toBe(409);
  const commitments = await importTestModule("src/app/api/sprint-commitments/route.ts", { "server-only": {} });
  const commitment = { sprintId: sprint, profileId: f.actors.founder.profileId, commitmentLevel: "Standard", weeklyHours: 12, expectedUpdatedAt: null };
  expect((await commitments.PUT(f.request("founder", "/api/sprint-commitments", "PUT", commitment))).status).toBe(200);
  expect((await commitments.PUT(f.request("other", "/api/sprint-commitments", "PUT", commitment))).status).toBe(403);
  const commitmentVersion = (await f.db.query("select to_jsonb(updated_at)#>>'{}' as updated_at from public.sprint_commitments where sprint_id=$1 and profile_id=$2", [sprint, f.actors.founder.profileId])).rows[0].updated_at;
  expect((await commitments.PUT(f.request("deputy", "/api/sprint-commitments", "PUT", { ...commitment, weeklyHours: 16, expectedUpdatedAt: commitmentVersion }))).status).toBe(200);
  expect((await f.db.query("select weekly_hours from public.sprint_commitments where sprint_id=$1 and profile_id=$2", [sprint, f.actors.founder.profileId])).rows[0].weekly_hours).toBe(16);
  const focus = await importTestModule("src/app/api/focus/route.ts", { "server-only": {} });
  expect((await focus.POST(f.request("other", "/api/focus", "POST", { taskId: task }))).status).toBe(403);
  const focused = await focus.POST(f.request("founder", "/api/focus", "POST", { taskId: task, position: 1 }));
  expect(focused.status).toBe(200);
  const focusId = (await focused.json()).focusItem.id;
  expect((await focus.DELETE(f.request("other", `/api/focus?id=${focusId}`, "DELETE"))).status).toBe(403);
  expect((await focus.DELETE(f.request("founder", `/api/focus?id=${focusId}`, "DELETE"))).status).toBe(200);
  const attendance = await importTestModule("src/app/api/meetings/[id]/attendance/route.ts", { "server-only": {} });
  expect((await attendance.POST(f.request("founder", `/api/meetings/${meeting}/attendance`, "POST", { status: "present" }), context(String(meeting)))).status).toBe(403);
  const selfReport = await attendance.POST(f.request("founder", `/api/meetings/${meeting}/attendance`, "POST", { expectedUpdatedAt: null, status: "excused", absenceReason: "Synthetic acceptance appointment." }), context(String(meeting)));
  expect(selfReport.status).toBe(200);
  const attendanceBasis = (await selfReport.json()).attendance.updatedAt;
  expect((await attendance.POST(f.request("deputy", `/api/meetings/${meeting}/attendance`, "POST", { expectedUpdatedAt: attendanceBasis, profileId: f.actors.founder.profileId, status: "present" }), context(String(meeting)))).status).toBe(200);
  expect((await f.db.query("select profile_id,points from public.meeting_attendance where meeting_id=$1", [meeting])).rows).toEqual([{ profile_id: f.actors.founder.profileId, points: 2 }]);
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  for (const actor of ["deputy", "administrator"] as const) expect(await authorizeCredentialAction({ credential: { kind: "session-request", request: f.request(actor, "/api/sprints/lock") }, action: "planning.sprint.lock", targetId: sprint })).toMatchObject({ ok: false, status: 403 });
  const lock = await authorizeCredentialAction({ credential: { kind: "session-request", request: f.request("ceo", "/api/sprints/lock") }, action: "planning.sprint.lock", targetId: sprint });
  if (!lock.ok) throw new Error("Expected CEO sprint lock capability");
  const observed = await lock.planning.readSprintLock();
  expect(observed.error).toBeNull();
  const values = { expectedUpdatedAt: observed.data.updated_at, taskUpdates: [], acceptedBlockerTaskIds: [], carryoverInserts: [], notifications: [], scoreRows: [], strikeStateRows: [], strikeEvents: [], resultData: { source: "synthetic acceptance" } };
  expect((await lock.planning.commitSprintLock({ ...values, taskUpdates: [{ id: task }] }, {})).error?.code).toBe("42501");
  expect((await lock.planning.commitSprintLock(values, {})).error).toBeNull();
  expect((await f.db.query("select score_locked from public.sprints where id=$1", [sprint])).rows[0].score_locked).toBe(true);
}), 30_000);
