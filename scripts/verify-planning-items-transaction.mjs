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
