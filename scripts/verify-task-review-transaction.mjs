import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const client = new pg.Client({
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: "postgres",
  database: "postgres",
  ssl: false,
});

async function expectCode(code, operation) {
  const savepoint = `planning_review_${randomUUID().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await operation();
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    assert.equal(error?.code, code, `Expected ${code}, received ${error?.code || "no SQLSTATE"}.`);
    return;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  throw new Error(`Expected ${code}, but the planning review mutation succeeded.`);
}

async function mutate({
  action,
  taskId,
  expectedUpdatedAt,
  actorId,
  reviewerId = null,
  decision = null,
  comment = null,
  checklist = {},
  points = 0,
  reason = null,
  activityMessages = [],
  notifications = [],
  auditAfterData = {},
}) {
  const result = await client.query(
    `select public.mutate_planning_review_command_transaction(
       $1, $2, $3::timestamptz, $4, $5, $6, $7, $8::jsonb, $9, $10,
       $11::text[], $12::jsonb, $13::jsonb, 'local-verifier', 'Planning review verifier'
     ) as result`,
    [
      action,
      taskId,
      expectedUpdatedAt,
      actorId,
      reviewerId,
      decision,
      comment,
      JSON.stringify(checklist),
      points,
      reason,
      activityMessages,
      JSON.stringify(notifications),
      JSON.stringify(auditAfterData),
    ],
  );
  return result.rows[0]?.result;
}

function notification(type, actorId, recipientId, taskId, title) {
  return {
    type,
    actor_profile_id: actorId,
    recipient_profile_id: recipientId,
    entity_type: "task",
    entity_id: taskId,
    title,
    body: title,
  };
}

await client.connect();
await client.query("begin");

try {
  const suffix = randomUUID().replaceAll("-", "");
  const ceoId = `review-ceo-${suffix}`;
  const ownerId = `review-owner-${suffix}`;
  const reviewerId = `review-reviewer-${suffix}`;
  const otherId = `review-other-${suffix}`;
  const viewerId = `review-viewer-${suffix}`;
  await client.query(
    `insert into public.profiles (id, name, role, platform_role)
     values
       ($1, 'Review CEO', 'admin', 'ceo'),
       ($2, 'Review Owner', 'member', 'founder'),
       ($3, 'Review Reviewer', 'member', 'founder'),
       ($4, 'Review Other', 'member', 'founder'),
       ($5, 'Review Viewer', 'viewer', 'viewer')`,
    [ceoId, ownerId, reviewerId, otherId, viewerId],
  );

  const sprintId = `review-sprint-${suffix}`;
  const lockedSprintId = `review-locked-sprint-${suffix}`;
  await client.query(
    `insert into public.sprints (id, project_id, name, status, score_locked)
     values
       ($1, 'findmydoc-founder-execution', 'Review Sprint', 'review', false),
       ($2, 'findmydoc-founder-execution', 'Locked Review Sprint', 'review', true)`,
    [sprintId, lockedSprintId],
  );

  const initiativeId = `review-initiative-${suffix}`;
  const requestId = `review-request-${suffix}`;
  const decideId = `review-decide-${suffix}`;
  const withdrawId = `review-withdraw-${suffix}`;
  const reopenId = `review-reopen-${suffix}`;
  const lockedId = `review-locked-${suffix}`;
  const invalidReviewerId = `review-invalid-reviewer-${suffix}`;
  const inserted = await client.query(
    `insert into public.tasks (
       id, project_id, parent_task_id, title, task_type, status, priority,
       owner, assignee, approval_status, review_status, review_owner_profile_id,
       score_points, score_final, sprint_id, github_issue_sync_status
     ) values
       ($1, 'findmydoc-founder-execution', null, 'Review Initiative', 'initiative', 'Offen', 'P2', $8, $8, 'approved', 'not_requested', null, 0, false, null, 'not_applicable'),
       ($2, 'findmydoc-founder-execution', $1, 'Request Review', 'deliverable', 'In Arbeit', 'P2', $7, $7, 'approved', 'not_requested', null, 0, false, $9, 'synced'),
       ($3, 'findmydoc-founder-execution', $1, 'Decide Review', 'deliverable', 'Review', 'P2', $7, $7, 'approved', 'requested', $8, 0, false, $9, 'synced'),
       ($4, 'findmydoc-founder-execution', $1, 'Withdraw Review', 'deliverable', 'Review', 'P2', $7, $7, 'approved', 'requested', $8, 0, false, $9, 'synced'),
       ($5, 'findmydoc-founder-execution', $1, 'Reopen Review', 'deliverable', 'Erledigt', 'P2', $7, $7, 'approved', 'accepted', $8, 10, true, $9, 'synced'),
       ($6, 'findmydoc-founder-execution', $1, 'Locked Review', 'deliverable', 'In Arbeit', 'P2', $7, $7, 'approved', 'not_requested', $8, 0, false, $10, 'synced'),
       ($11, 'findmydoc-founder-execution', $1, 'Invalid Reviewer', 'deliverable', 'In Arbeit', 'P2', $7, $7, 'approved', 'not_requested', $12, 0, false, null, 'synced')
     returning id, updated_at::text as updated_at`,
    [
      initiativeId,
      requestId,
      decideId,
      withdrawId,
      reopenId,
      lockedId,
      ownerId,
      reviewerId,
      sprintId,
      lockedSprintId,
      invalidReviewerId,
      viewerId,
    ],
  );
  const revision = new Map(inserted.rows.map((row) => [row.id, row.updated_at]));
  await client.query(
    `insert into public.planning_item_raci_assignments (task_id, profile_id, role, sort_order)
     values ($1, $2, 'accountable', 0)`,
    [initiativeId, reviewerId],
  );

  const prepared = await client.query(
    `select public.prepare_planning_review_command($1, null, $2) as result`,
    [requestId, ownerId],
  );
  assert.equal(prepared.rows[0]?.result?.task?.id, requestId);
  assert.equal(prepared.rows[0]?.result?.reviewer?.id, reviewerId);
  assert.equal(prepared.rows[0]?.result?.reviewer?.contributor, true);
  assert.equal(prepared.rows[0]?.result?.defaultReviewer?.id, reviewerId);

  await expectCode("P0006", () => mutate({
    action: "request",
    taskId: requestId,
    expectedUpdatedAt: revision.get(requestId),
    actorId: ownerId,
    reviewerId: otherId,
  }));

  const requested = await mutate({
    action: "request",
    taskId: requestId,
    expectedUpdatedAt: revision.get(requestId),
    actorId: ownerId,
    reviewerId,
    activityMessages: ["Status geändert: In Arbeit → Review", "Review geändert: not_requested → requested"],
    notifications: [notification("task.review_requested", ownerId, reviewerId, requestId, "Review angefragt")],
    auditAfterData: { status: "Review", reviewStatus: "requested" },
  });
  assert.equal(requested?.task?.review_status, "requested");
  assert.equal(requested?.task?.review_owner_profile_id, reviewerId);
  assert.equal(requested?.activities?.length, 2);

  const requestState = await client.query(
    `select
       (select count(*)::integer from public.audit_log where entity_id = $1 and action = 'task.review.request') as audit_count,
       (select count(*)::integer from public.notification_events where entity_id = $1 and type = 'task.review_requested') as notification_count,
       (select github_issue_sync_status from public.tasks where id = $1) as sync_status`,
    [requestId],
  );
  assert.deepEqual(requestState.rows[0], { audit_count: 1, notification_count: 1, sync_status: "not_synced" });

  const acceptedChecklist = {
    acceptanceCriteriaMet: true,
    evidenceProvided: true,
    communicationClear: true,
    blockerHandled: true,
  };
  const decided = await mutate({
    action: "decide",
    taskId: decideId,
    expectedUpdatedAt: revision.get(decideId),
    actorId: reviewerId,
    reviewerId,
    decision: "accepted",
    comment: "Accepted",
    checklist: acceptedChecklist,
    points: 10,
    activityMessages: ["Review finalisiert: Akzeptiert, 10 Punkte"],
    notifications: [notification("task.review_completed", reviewerId, ownerId, decideId, "Review abgeschlossen")],
    auditAfterData: { decision: "accepted", points: 10, status: "Erledigt", scoreFinal: true, checklist: acceptedChecklist },
  });
  assert.equal(decided?.task?.review_status, "accepted");
  assert.equal(decided?.task?.score_final, true);
  assert.equal(decided?.review?.decision, "accepted");

  const withdrawn = await mutate({
    action: "withdraw",
    taskId: withdrawId,
    expectedUpdatedAt: revision.get(withdrawId),
    actorId: ownerId,
    reviewerId,
    reason: "Needs more work",
    activityMessages: ["Review zurückgezogen: Needs more work"],
    notifications: [notification("task.review_withdrawn", ownerId, reviewerId, withdrawId, "Review zurückgezogen")],
    auditAfterData: { status: "In Arbeit", reviewStatus: "not_requested", scoreFinal: false },
  });
  assert.equal(withdrawn?.task?.review_status, "not_requested");
  assert.equal(withdrawn?.task?.status, "In Arbeit");

  const reopened = await mutate({
    action: "reopen",
    taskId: reopenId,
    expectedUpdatedAt: revision.get(reopenId),
    actorId: reviewerId,
    reviewerId,
    activityMessages: ["Review wieder geöffnet"],
    notifications: [notification("task.review_requested", reviewerId, reviewerId, reopenId, "Review wieder geöffnet")],
    auditAfterData: { status: "Review", reviewStatus: "requested", scoreFinal: false },
  });
  assert.equal(reopened?.task?.review_status, "requested");
  assert.equal(reopened?.task?.score_final, false);
  assert.ok(reopened?.task?.review_requested_at);

  await expectCode("P0006", () => mutate({
    action: "request",
    taskId: invalidReviewerId,
    expectedUpdatedAt: revision.get(invalidReviewerId),
    actorId: otherId,
    reviewerId,
  }));
  await expectCode("P0007", () => mutate({
    action: "request",
    taskId: invalidReviewerId,
    expectedUpdatedAt: revision.get(invalidReviewerId),
    actorId: ceoId,
    reviewerId: viewerId,
  }));
  await expectCode("P0006", () => mutate({
    action: "decide",
    taskId: decideId,
    expectedUpdatedAt: decided.task.updated_at,
    actorId: ownerId,
    decision: "accepted",
    checklist: acceptedChecklist,
    points: 10,
  }));
  await expectCode("P0006", () => mutate({
    action: "withdraw",
    taskId: requestId,
    expectedUpdatedAt: requested.task.updated_at,
    actorId: reviewerId,
    reason: "Must not withdraw",
  }));
  await expectCode("P0001", () => mutate({
    action: "reopen",
    taskId: reopenId,
    expectedUpdatedAt: revision.get(reopenId),
    actorId: reviewerId,
  }));
  await expectCode("P0003", () => mutate({
    action: "request",
    taskId: lockedId,
    expectedUpdatedAt: revision.get(lockedId),
    actorId: ownerId,
    reviewerId,
  }));

  const rollbackId = `review-rollback-${suffix}`;
  const rollbackInsert = await client.query(
    `insert into public.tasks (
       id, project_id, parent_task_id, title, task_type, status, priority,
       owner, assignee, approval_status, review_status, review_owner_profile_id, score_final
     ) values ($1, 'findmydoc-founder-execution', $2, 'Rollback Review', 'deliverable', 'In Arbeit', 'P2', $3, $3, 'approved', 'not_requested', $4, false)
     returning updated_at::text as updated_at`,
    [rollbackId, initiativeId, ownerId, reviewerId],
  );
  await expectCode("23503", () => mutate({
    action: "request",
    taskId: rollbackId,
    expectedUpdatedAt: rollbackInsert.rows[0]?.updated_at,
    actorId: ownerId,
    reviewerId,
    activityMessages: ["Must roll back"],
    notifications: [notification("task.review_requested", ownerId, `missing-${suffix}`, rollbackId, "Must roll back")],
  }));
  const rollbackState = await client.query(
    `select
       (select review_status from public.tasks where id = $1) as review_status,
       (select count(*)::integer from public.task_activity where task_id = $1) as activity_count,
       (select count(*)::integer from public.audit_log where entity_id = $1 and action = 'task.review.request') as audit_count`,
    [rollbackId],
  );
  assert.deepEqual(rollbackState.rows[0], { review_status: "not_requested", activity_count: 0, audit_count: 0 });

  const privileges = await client.query(
    `select
       has_function_privilege('authenticated', 'public.prepare_planning_review_command(text,text,text)', 'execute') as authenticated_prepare,
       has_function_privilege('authenticated', 'public.mutate_planning_review_command_transaction(text,text,timestamptz,text,text,text,text,jsonb,integer,text,text[],jsonb,jsonb,text,text)', 'execute') as authenticated_commit,
       has_function_privilege('service_role', 'public.prepare_planning_review_command(text,text,text)', 'execute') as service_prepare,
       has_function_privilege('service_role', 'public.mutate_planning_review_command_transaction(text,text,timestamptz,text,text,text,text,jsonb,integer,text,text[],jsonb,jsonb,text,text)', 'execute') as service_commit`,
  );
  assert.deepEqual(privileges.rows[0], {
    authenticated_prepare: false,
    authenticated_commit: false,
    service_prepare: true,
    service_commit: true,
  });

  console.log("Planning review command family, policy parity, atomic effects, rollback, and service-only access verified; all data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
