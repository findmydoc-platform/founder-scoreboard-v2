import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const projectId = "findmydoc-founder-execution";
const config = {
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: "postgres",
  database: "postgres",
  ssl: false,
};

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function expectCode(client, code, operation) {
  const savepoint = `planning_expected_${randomUUID().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await operation();
  } catch (error) {
    await client.query(`rollback to savepoint ${savepoint}`);
    await client.query(`release savepoint ${savepoint}`);
    assert.equal(error?.code, code, `Expected SQLSTATE ${code}, received ${error?.code || "none"}.`);
    return;
  }
  await client.query(`rollback to savepoint ${savepoint}`);
  await client.query(`release savepoint ${savepoint}`);
  throw new Error(`Expected SQLSTATE ${code}, but the operation succeeded.`);
}

async function createBatch(client, { tokenId, profileId, items }) {
  const key = randomUUID();
  const result = await client.query(
    "select public.create_team_planning_items_transaction($1, $2, $3, $4, $5::jsonb, null, 'canonical planning verifier') as result",
    [tokenId, profileId, key, hash(items), JSON.stringify(items)],
  );
  return result.rows[0]?.result;
}

async function updateItem(client, { tokenId, profileId, itemType, itemId, updatedAt, patch, changedFields = Object.keys(patch) }) {
  const key = randomUUID();
  const result = await client.query(
    "select public.update_team_planning_item_transaction($1, $2, $3, $4, $5::timestamptz, $6, $7, $8::jsonb, $9::jsonb, '[]'::jsonb, null, 'canonical planning verifier') as result",
    [tokenId, profileId, itemType, itemId, updatedAt, key, hash({ itemType, itemId, updatedAt, patch }), JSON.stringify(patch), JSON.stringify(changedFields)],
  );
  return result.rows[0]?.result;
}

const client = new pg.Client(config);
await client.connect();
await client.query("begin");

try {
  const suffix = randomUUID().replaceAll("-", "");
  const ceoId = `planning-hierarchy-ceo-${suffix}`;
  const ownerId = `planning-hierarchy-owner-${suffix}`;
  await client.query(
    `insert into public.profiles (id, name, role, platform_role)
     values ($1, 'Planning hierarchy CEO', 'admin', 'ceo'), ($2, 'Planning hierarchy Owner', 'member', 'founder')`,
    [ceoId, ownerId],
  );
  await client.query(
    "insert into public.projects (id, name) values ($1, 'Planning hierarchy verification') on conflict (id) do nothing",
    [projectId],
  );
  const tokenResult = await client.query(
    "select public.create_team_planning_items_token_v2($1, $2, $3, $4, true, true) as result",
    [ceoId, "Planning hierarchy verifier", hash(`token-${suffix}`), "verify-plan"],
  );
  const token = tokenResult.rows[0]?.result;
  assert.ok(token?.id, "Planning verifier token must be created.");

  const firstBatch = await createBatch(client, {
    tokenId: token.id,
    profileId: ceoId,
    items: [{
      itemType: "epic",
      title: "Canonical hierarchy epic",
      description: "Local transactional verifier.",
      ownerId: ceoId,
      targetDate: "2026-12-31",
      status: "Offen",
    }],
  });
  const epic = firstBatch?.items?.[0]?.item;
  assert.equal(firstBatch?.items?.[0]?.itemType, "epic");
  assert.equal(epic?.task_type, "epic");
  assert.equal(epic?.github_issue_sync_status, "not_applicable");
  assert.equal(epic?.github_repo, null);

  const initiativeBatch = await createBatch(client, {
    tokenId: token.id,
    profileId: ceoId,
    items: [{
      itemType: "initiative",
      title: "Parent-free proposal",
      intendedOutcome: "Be approved only after an Epic is attached.",
      ownerId,
      accountableProfileId: ceoId,
      responsibleProfileIds: [ownerId],
      priority: "P1",
      status: "Offen",
    }],
  });
  const initiative = initiativeBatch?.items?.[0]?.item;
  assert.equal(initiativeBatch?.items?.[0]?.itemType, "initiative");
  assert.equal(initiative?.task_type, "initiative");
  assert.equal(initiative?.parent_task_id, null);
  await expectCode(client, "23514", () => client.query(
    "select public.decide_planning_item_approval_transaction($1, 1, 'approve', $2, null)",
    [initiative.id, ceoId],
  ));

  const linkedInitiative = await updateItem(client, {
    tokenId: token.id,
    profileId: ceoId,
    itemType: "initiative",
    itemId: initiative.id,
    updatedAt: initiative.updated_at,
    patch: { parent_task_id: epic.id },
  });
  assert.equal(linkedInitiative?.item?.parent_task_id, epic.id);
  const approvedInitiative = await client.query(
    "select public.decide_planning_item_approval_transaction($1, $2, 'approve', $3, null) as result",
    [initiative.id, Number(linkedInitiative?.item?.approval_revision), ceoId],
  );
  assert.equal(approvedInitiative.rows[0]?.result?.task?.approval_status, "approved");

  const deliveryBatch = await createBatch(client, {
    tokenId: token.id,
    profileId: ceoId,
    items: [{
      itemType: "deliverable",
      title: "Parent-free Deliverable proposal",
      ownerId,
      priority: "P2",
      status: "Offen",
      definitionOfDone: "Verifier complete.",
    }],
  });
  const delivery = deliveryBatch?.items?.[0]?.item;
  assert.equal(delivery?.parent_task_id, null);
  await expectCode(client, "23514", () => client.query(
    "select public.decide_planning_item_approval_transaction($1, 1, 'approve', $2, null)",
    [delivery.id, ceoId],
  ));

  const linkedDelivery = await updateItem(client, {
    tokenId: token.id,
    profileId: ceoId,
    itemType: "deliverable",
    itemId: delivery.id,
    updatedAt: delivery.updated_at,
    patch: { parent_task_id: initiative.id },
  });
  assert.equal(linkedDelivery?.item?.parent_task_id, initiative.id);
  assert.equal(linkedDelivery?.item?.approval_status, "proposed");
  const approvedDelivery = await client.query(
    "select public.decide_planning_item_approval_transaction($1, $2, 'approve', $3, null) as result",
    [delivery.id, Number(linkedDelivery?.item?.approval_revision), ceoId],
  );
  assert.equal(approvedDelivery.rows[0]?.result?.task?.approval_status, "approved");

  const subIssueBatch = await createBatch(client, {
    tokenId: token.id,
    profileId: ceoId,
    items: [{
      itemType: "sub_issue",
      title: "Direct child only",
      parentTaskId: delivery.id,
      ownerId,
      status: "Offen",
    }],
  });
  const subIssue = subIssueBatch?.items?.[0]?.item;
  assert.equal(subIssue?.task_type, "sub_issue");
  assert.equal(subIssue?.parent_task_id, delivery.id);

  const approvedSecondInitiativeBatch = await createBatch(client, {
    tokenId: token.id,
    profileId: ceoId,
    items: [{
      itemType: "initiative",
      title: "Second approved Initiative",
      ownerId,
      accountableProfileId: ceoId,
      responsibleProfileIds: [ownerId],
      parentTaskId: epic.id,
      status: "Offen",
    }],
  });
  const secondInitiative = approvedSecondInitiativeBatch?.items?.[0]?.item;
  await client.query(
    "select public.decide_planning_item_approval_transaction($1, $2, 'approve', $3, null)",
    [secondInitiative.id, Number(secondInitiative?.approval_revision), ceoId],
  );
  const reparentedDelivery = await updateItem(client, {
    tokenId: token.id,
    profileId: ceoId,
    itemType: "deliverable",
    itemId: delivery.id,
    updatedAt: approvedDelivery.rows[0]?.result?.task?.updated_at,
    patch: { parent_task_id: secondInitiative.id },
  });
  assert.equal(reparentedDelivery?.item?.approval_status, "proposed");
  assert.equal(
    Number(reparentedDelivery?.item?.approval_revision),
    Number(approvedDelivery.rows[0]?.result?.task?.approval_revision) + 1,
    "Reparenting an approved Deliverable must create exactly one new approval revision.",
  );
  const childCount = await client.query("select count(*)::integer as count from public.tasks where parent_task_id = $1", [delivery.id]);
  assert.equal(childCount.rows[0]?.count, 1, "Parent changes must preserve direct children.");

  const reapprovedDelivery = await client.query(
    "select public.decide_planning_item_approval_transaction($1, $2, 'approve', $3, null) as result",
    [delivery.id, Number(reparentedDelivery?.item?.approval_revision), ceoId],
  );
  const reapprovedTask = reapprovedDelivery.rows[0]?.result?.task;
  assert.equal(reapprovedTask?.approval_status, "approved");
  const titleOnlyUpdate = await updateItem(client, {
    tokenId: token.id,
    profileId: ceoId,
    itemType: "deliverable",
    itemId: delivery.id,
    updatedAt: reapprovedTask.updated_at,
    patch: { title: "Deliverable title change keeps approval" },
  });
  assert.equal(titleOnlyUpdate?.item?.approval_status, "approved", "Only a parent change may reset a Deliverable approval.");
  assert.equal(titleOnlyUpdate?.item?.approval_revision, reapprovedTask.approval_revision, "Brief changes must not create a new approval revision.");
  const reviewRequest = await updateItem(client, {
    tokenId: token.id,
    profileId: ceoId,
    itemType: "deliverable",
    itemId: delivery.id,
    updatedAt: titleOnlyUpdate?.item?.updated_at,
    patch: { status: "Review" },
  });
  assert.equal(reviewRequest?.item?.status, "Review");
  assert.equal(reviewRequest?.item?.review_status, "requested");
  assert.equal(reviewRequest?.item?.review_owner_profile_id, ceoId, "Review owner must resolve from Initiative RACI.");
  const reviewNotifications = await client.query(
    "select count(*)::integer as count from public.notification_events where type = 'task.review_requested' and entity_id = $1 and recipient_profile_id = $2",
    [delivery.id, ceoId],
  );
  assert.equal(reviewNotifications.rows[0]?.count, 1, "Team Planning review must retain the existing review notification.");

  const localComment = await client.query(
    "select public.create_task_comment_local($1, $2, 'Local strategic note') as result",
    [epic.id, ceoId],
  );
  assert.equal(localComment.rows[0]?.result?.deliveryStatus, "not_applicable");
  const strategicDeliveryRows = await client.query(
    `select
       (select count(*)::integer from public.planning_github_lifecycle_outbox outbox join public.tasks task on task.id = outbox.task_id where task.task_type in ('epic', 'initiative')) as lifecycle,
       (select count(*)::integer from public.task_comment_github_deliveries delivery join public.task_comments comment on comment.id = delivery.task_comment_id join public.tasks task on task.id = comment.task_id where task.task_type in ('epic', 'initiative')) as comments`,
  );
  assert.deepEqual(strategicDeliveryRows.rows[0], { lifecycle: 0, comments: 0 });

  const beforeFailedBatch = await client.query("select count(*)::integer as count from public.tasks where id like $1", [`${ceoId}-planning-items-v1-%`]);
  await expectCode(client, "23514", () => createBatch(client, {
    tokenId: token.id,
    profileId: ceoId,
    items: [
      { itemType: "epic", title: "Must roll back", ownerId: ceoId, status: "Offen" },
      { itemType: "sub_issue", title: "Invalid child", parentTaskId: "missing", ownerId, status: "Offen" },
    ],
  }));
  const afterFailedBatch = await client.query("select count(*)::integer as count from public.tasks where id like $1", [`${ceoId}-planning-items-v1-%`]);
  assert.equal(afterFailedBatch.rows[0]?.count, beforeFailedBatch.rows[0]?.count, "A failed batch must not partially create planning items.");

  const legacyMilestoneId = `legacy-milestone-${suffix}`;
  const legacyPackageId = `legacy-package-${suffix}`;
  const trashedPackageId = `legacy-trashed-package-${suffix}`;
  const legacyDeliverableId = `legacy-deliverable-${suffix}`;
  const trashedDeliverableId = `legacy-trashed-deliverable-${suffix}`;
  const trashedSubIssueId = `legacy-trashed-sub-issue-${suffix}`;
  const invalidPackageId = `legacy-invalid-package-${suffix}`;

  await expectCode(client, "23514", async () => {
    await client.query(
      `insert into public.packages (
         id, project_id, title, goal, owner_id, accountable_profile_id,
         responsible_profile_ids, approval_status, approval_revision
       ) values ($1, $2, 'Invalid orphan', 'Must fail atomically', $3, $3, array[$3], 'approved', 1)`,
      [invalidPackageId, projectId, ownerId],
    );
    await client.query("select public.backfill_unified_planning_hierarchy()");
  });
  const invalidMapping = await client.query(
    "select count(*)::integer as count from public.planning_item_legacy_ids where source_kind = 'package' and legacy_id = $1",
    [invalidPackageId],
  );
  assert.equal(invalidMapping.rows[0]?.count, 0, "Invalid legacy input must not leave a partial id mapping.");

  await client.query(
    `insert into public.milestones (
       id, project_id, title, description, target_date, status, sort_order, created_at, updated_at
     ) values ($1, $2, 'Legacy launch', 'Lossless Epic description', '2026-11-30', 'active', 41, '2026-07-01T08:00:00Z', '2026-07-02T09:00:00Z')`,
    [legacyMilestoneId, projectId],
  );
  await client.query(
    `insert into public.packages (
       id, project_id, title, goal, priority, sort_order, milestone_id, owner_id, status,
       target_date, success_criteria, scope_constraints, accountable_profile_id,
       responsible_profile_ids, consulted_profile_ids, informed_profile_ids,
       approval_status, approval_revision, proposed_by, proposed_at, decided_by, decided_at, decision_note
     ) values (
       $1, $2, 'Legacy active Initiative', 'Legacy goal', 'P1', 51, $3, $4, 'active',
       '2026-10-31', 'Legacy success', 'Legacy scope', $5,
       array[$4], array[$5], array[$4], 'approved', 3, $5, '2026-07-03T08:00:00Z', $5, '2026-07-04T08:00:00Z', 'Approved legacy fixture'
     )`,
    [legacyPackageId, projectId, legacyMilestoneId, ownerId, ceoId],
  );
  const trashedAt = "2026-07-05T08:00:00.000Z";
  await client.query("select set_config('app.planning_hierarchy_backfill', 'true', true)");
  await client.query("select set_config('founderops.trash_lifecycle_write', 'on', true)");
  await client.query(
    `insert into public.packages (
       id, project_id, title, goal, priority, sort_order, milestone_id, owner_id, status,
       target_date, success_criteria, scope_constraints, accountable_profile_id,
       responsible_profile_ids, approval_status, approval_revision, proposed_by, proposed_at,
       trashed_at, trashed_by, trash_reason, trash_cause, purge_after, trash_root_type, trash_root_id, trash_revision
     ) values (
       $1, $2, 'Legacy trashed Initiative', 'Trashed goal', 'P2', 52, $3, $4, 'paused',
       '2026-12-15', 'Trashed success', 'Trashed scope', $5,
       array[$4], 'proposed', 2, $5, '2026-07-04T08:00:00Z',
       $6::timestamptz, $5, 'Superseded fixture', 'withdrawn', $6::timestamptz + interval '90 days', 'initiative', $1, 4
     )`,
    [trashedPackageId, projectId, legacyMilestoneId, ownerId, ceoId, trashedAt],
  );
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, milestone_id, title, description, status, priority,
       owner, assignee, task_type, parent_task_id, approval_status, approval_revision,
       score_relevant, review_status, github_repo
     ) values ($1, $2, $3, $4, 'Legacy Deliverable', 'Preserve operational fields', 'In Arbeit', 'P1',
       $5, $5, 'deliverable', null, 'approved', 2, false, 'not_requested', 'findmydoc-platform/management')`,
    [legacyDeliverableId, projectId, legacyPackageId, legacyMilestoneId, ownerId],
  );
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, milestone_id, title, description, status, priority,
       owner, assignee, task_type, parent_task_id, approval_status, approval_revision,
       score_relevant, review_status, github_repo,
       trashed_at, trashed_by, trash_reason, trash_cause, purge_after, trash_root_type, trash_root_id, trash_revision
     ) values ($1, $2, $3, $4, 'Legacy trashed Deliverable', 'Preserve trash tree', 'Offen', 'P2',
       $5, $5, 'deliverable', null, 'proposed', 2, false, 'not_requested', 'findmydoc-platform/management',
       $6::timestamptz, $7, 'Superseded fixture', 'withdrawn', $6::timestamptz + interval '90 days', 'initiative', $3, 4)`,
    [trashedDeliverableId, projectId, trashedPackageId, legacyMilestoneId, ownerId, trashedAt, ceoId],
  );
  await client.query(
    `insert into public.tasks (
       id, project_id, package_id, milestone_id, title, description, status, priority,
       owner, assignee, task_type, parent_task_id, approval_status, approval_revision,
       score_relevant, review_status, github_repo,
       trashed_at, trashed_by, trash_reason, trash_cause, purge_after, trash_root_type, trash_root_id, trash_revision
     ) values ($1, $2, $3, $4, 'Legacy trashed Sub-Issue', 'Preserve direct child', 'Offen', 'P2',
       $5, $5, 'sub_issue', $6, null, 1, false, 'not_requested', 'findmydoc-platform/management',
       $7::timestamptz, $8, 'Superseded fixture', 'withdrawn', $7::timestamptz + interval '90 days', 'initiative', $3, 4)`,
    [trashedSubIssueId, projectId, trashedPackageId, legacyMilestoneId, ownerId, trashedDeliverableId, trashedAt, ceoId],
  );
  await client.query("select set_config('app.planning_hierarchy_backfill', 'false', true)");
  await client.query("select set_config('founderops.trash_lifecycle_write', 'off', true)");

  await client.query(
    `insert into public.profile_ui_preferences (profile_id, planning_filters, expanded_package_ids)
     values ($1, jsonb_build_object('query', '', 'packageId', $2::text), array[$2::text, 'Alle', 'unknown-package'])
     on conflict (profile_id) do update
     set planning_filters = excluded.planning_filters,
         expanded_package_ids = excluded.expanded_package_ids`,
    [ownerId, legacyPackageId],
  );

  const backfillResult = await client.query("select public.backfill_unified_planning_hierarchy() as result");
  assert.ok(Number(backfillResult.rows[0]?.result?.milestones) >= 1);
  assert.ok(Number(backfillResult.rows[0]?.result?.initiatives) >= 2);

  const mappings = await client.query(
    `select source_kind, legacy_id, task_id
     from public.planning_item_legacy_ids
     where (source_kind = 'milestone' and legacy_id = $1)
        or (source_kind = 'package' and legacy_id = any($2::text[]))`,
    [legacyMilestoneId, [legacyPackageId, trashedPackageId]],
  );
  const mappedIds = new Map(mappings.rows.map((row) => [`${row.source_kind}:${row.legacy_id}`, row.task_id]));
  const epicId = mappedIds.get(`milestone:${legacyMilestoneId}`);
  const initiativeId = mappedIds.get(`package:${legacyPackageId}`);
  const trashedInitiativeId = mappedIds.get(`package:${trashedPackageId}`);
  assert.ok(epicId && initiativeId && trashedInitiativeId, "Every legacy root must retain a canonical id mapping.");
  assert.notEqual(epicId, legacyMilestoneId);
  assert.notEqual(initiativeId, legacyPackageId);

  const epicBackfill = await client.query(
    `select title, description, status, target_date::text as target_date, sort_order,
            task_type, parent_task_id, priority, github_issue_sync_status
     from public.tasks where id = $1`,
    [epicId],
  );
  const milestoneSource = await client.query(
    "select sort_order from public.milestones where id = $1",
    [legacyMilestoneId],
  );
  assert.deepEqual(epicBackfill.rows[0], {
    title: "Legacy launch",
    description: "Lossless Epic description",
    status: "In Arbeit",
    target_date: "2026-11-30",
    sort_order: milestoneSource.rows[0]?.sort_order,
    task_type: "epic",
    parent_task_id: null,
    priority: null,
    github_issue_sync_status: "not_applicable",
  });

  const initiativeBackfill = await client.query(
    `select task.title, task.description, task.status, task.priority, task.owner,
            task.target_date::text as target_date, task.parent_task_id, task.approval_status,
            task.approval_revision, strategy.goal, strategy.success_criteria, strategy.scope_constraints
     from public.tasks task
     join public.planning_item_strategy strategy on strategy.task_id = task.id
     where task.id = $1`,
    [initiativeId],
  );
  assert.deepEqual(initiativeBackfill.rows[0], {
    title: "Legacy active Initiative",
    description: "Legacy goal",
    status: "In Arbeit",
    priority: "P1",
    owner: ownerId,
    target_date: "2026-10-31",
    parent_task_id: epicId,
    approval_status: "approved",
    approval_revision: 3,
    goal: "Legacy goal",
    success_criteria: "Legacy success",
    scope_constraints: "Legacy scope",
  });
  const raciBackfill = await client.query(
    `select profile_id, role, sort_order
     from public.planning_item_raci_assignments
     where task_id = $1
     order by role, sort_order, profile_id`,
    [initiativeId],
  );
  assert.deepEqual(raciBackfill.rows, [
    { profile_id: ceoId, role: "accountable", sort_order: 0 },
    { profile_id: ceoId, role: "consulted", sort_order: 1 },
    { profile_id: ownerId, role: "informed", sort_order: 1 },
    { profile_id: ownerId, role: "responsible", sort_order: 1 },
  ]);

  const hierarchyBackfill = await client.query(
    `select id, parent_task_id, trash_root_id, trashed_at is not null as trashed
     from public.tasks
     where id = any($1::text[])
     order by id`,
    [[legacyDeliverableId, trashedDeliverableId, trashedSubIssueId, trashedInitiativeId]],
  );
  const hierarchyById = new Map(hierarchyBackfill.rows.map((row) => [row.id, row]));
  assert.equal(hierarchyById.get(legacyDeliverableId)?.parent_task_id, initiativeId);
  assert.equal(hierarchyById.get(trashedInitiativeId)?.parent_task_id, epicId);
  assert.equal(hierarchyById.get(trashedInitiativeId)?.trash_root_id, trashedInitiativeId);
  assert.equal(hierarchyById.get(trashedDeliverableId)?.parent_task_id, trashedInitiativeId);
  assert.equal(hierarchyById.get(trashedDeliverableId)?.trash_root_id, trashedInitiativeId);
  assert.equal(hierarchyById.get(trashedSubIssueId)?.parent_task_id, trashedDeliverableId);
  assert.equal(hierarchyById.get(trashedSubIssueId)?.trash_root_id, trashedInitiativeId);
  assert.equal(hierarchyById.get(trashedSubIssueId)?.trashed, true);

  const migratedPreference = await client.query(
    `select planning_filters->>'packageId' as package_id, expanded_package_ids
     from public.profile_ui_preferences where profile_id = $1`,
    [ownerId],
  );
  assert.equal(migratedPreference.rows[0]?.package_id, initiativeId);
  assert.deepEqual(migratedPreference.rows[0]?.expanded_package_ids, [initiativeId, "Alle", "unknown-package"]);

  const secondBackfill = await client.query("select public.backfill_unified_planning_hierarchy() as result");
  assert.deepEqual(secondBackfill.rows[0]?.result, backfillResult.rows[0]?.result, "Backfill must be idempotent.");

  const legacyReplayCreateKey = randomUUID();
  const legacyReplayUpdateKey = randomUUID();
  const legacyReplayDeleteKey = randomUUID();
  const legacyCreateHash = hash([{ itemType: "milestone", title: "Legacy replay" }]);
  const legacyUpdateHash = hash({ itemId: legacyMilestoneId, itemType: "milestone", expectedUpdatedAt: "2026-07-02T09:00:00.000Z", patch: { title: "Legacy replay" } });
  const legacyDeleteHash = hash({ itemId: legacyMilestoneId, expectedUpdatedAt: "2026-07-02T09:00:00.000Z" });
  await client.query(
    `insert into public.team_task_intake_batches (
       token_id, profile_id, idempotency_key, request_hash, task_ids, response_tasks, contract_version
     ) values ($1, $2, $3, $4, array[$5], $6::jsonb, 1)`,
    [token.id, ceoId, legacyReplayCreateKey, legacyCreateHash, legacyMilestoneId, JSON.stringify([{ itemType: "milestone", item: { id: legacyMilestoneId, title: "Legacy replay" } }])],
  );
  await client.query(
    `insert into public.team_planning_item_update_requests (
       token_id, profile_id, item_type, item_id, expected_updated_at, idempotency_key, request_hash, response, contract_version
     ) values ($1, $2, 'milestone', $3, $4::timestamptz, $5, $6, $7::jsonb, 1)`,
    [token.id, ceoId, legacyMilestoneId, "2026-07-02T09:00:00.000Z", legacyReplayUpdateKey, legacyUpdateHash, JSON.stringify({ itemType: "milestone", item: { id: legacyMilestoneId, title: "Legacy replay" } })],
  );
  await client.query(
    `insert into public.team_planning_milestone_delete_requests (
       token_id, profile_id, milestone_id, expected_updated_at, idempotency_key, request_hash, response, contract_version
     ) values ($1, $2, $3, $4::timestamptz, $5, $6, $7::jsonb, 1)`,
    [token.id, ceoId, legacyMilestoneId, "2026-07-02T09:00:00.000Z", legacyReplayDeleteKey, legacyDeleteHash, JSON.stringify({ itemType: "milestone", item: { id: legacyMilestoneId, title: "Legacy replay" }, children: { initiatives: 0, tasks: 0 } })],
  );
  const replayCreate = await client.query(
    "select public.create_team_planning_items_transaction($1, $2, $3, $4, $5::jsonb) as result",
    [token.id, ceoId, legacyReplayCreateKey, legacyCreateHash, JSON.stringify([{ itemType: "milestone", title: "Legacy replay" }])],
  );
  const replayUpdate = await client.query(
    `select public.update_team_planning_item_transaction(
       $1, $2, 'milestone', $3, $4::timestamptz, $5, $6, $7::jsonb, '[]'::jsonb, '[]'::jsonb
     ) as result`,
    [token.id, ceoId, legacyMilestoneId, "2026-07-02T09:00:00.000Z", legacyReplayUpdateKey, legacyUpdateHash, JSON.stringify({ title: "Legacy replay" })],
  );
  const replayDelete = await client.query(
    `select public.delete_team_planning_milestone_transaction(
       $1, $2, $3, $4::timestamptz, $5, $6
     ) as result`,
    [token.id, ceoId, legacyMilestoneId, "2026-07-02T09:00:00.000Z", legacyReplayDeleteKey, legacyDeleteHash],
  );
  assert.equal(replayCreate.rows[0]?.result?.replayed, true);
  assert.equal(replayCreate.rows[0]?.result?.items?.[0]?.itemType, "milestone");
  assert.equal(replayUpdate.rows[0]?.result?.replayed, true);
  assert.equal(replayUpdate.rows[0]?.result?.itemType, "milestone");
  assert.equal(replayDelete.rows[0]?.result?.replayed, true);
  assert.equal(replayDelete.rows[0]?.result?.itemType, "milestone");
  const replayVersions = await client.query(
    `select
       (select contract_version from public.team_task_intake_batches where id = $1) as current_create,
       (select contract_version from public.team_task_intake_batches where token_id = $2 and idempotency_key = $3) as legacy_create,
       (select contract_version from public.team_planning_item_update_requests where token_id = $2 and idempotency_key = $4) as legacy_update,
       (select contract_version from public.team_planning_milestone_delete_requests where token_id = $2 and idempotency_key = $5) as legacy_delete`,
    [firstBatch.batchId, token.id, legacyReplayCreateKey, legacyReplayUpdateKey, legacyReplayDeleteKey],
  );
  assert.deepEqual(replayVersions.rows[0], { current_create: 2, legacy_create: 1, legacy_update: 1, legacy_delete: 1 });

  const backfill = await client.query(
    `select
       (select count(*)::integer from public.milestones) as legacy_milestones,
       (select count(*)::integer from public.planning_item_legacy_ids where source_kind = 'milestone') as epic_mappings,
       (select count(*)::integer from public.packages) as legacy_packages,
       (select count(*)::integer from public.planning_item_legacy_ids where source_kind = 'package') as initiative_mappings`,
  );
  assert.equal(backfill.rows[0]?.legacy_milestones, backfill.rows[0]?.epic_mappings);
  assert.equal(backfill.rows[0]?.legacy_packages, backfill.rows[0]?.initiative_mappings);

  console.log("Canonical planning hierarchy transaction verification passed; local test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}
