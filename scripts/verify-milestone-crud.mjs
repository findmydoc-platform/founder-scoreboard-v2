import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

const projectId = "findmydoc-founder-execution";
const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

export function localEpicDatabaseConfig(env = process.env) {
  return {
    host: env.EPIC_VERIFY_DB_HOST || "127.0.0.1",
    port: Number(env.EPIC_VERIFY_DB_PORT || 54322),
    user: env.EPIC_VERIFY_DB_USER || "postgres",
    password: env.EPIC_VERIFY_DB_PASSWORD || "postgres",
    database: env.EPIC_VERIFY_DB_NAME || "postgres",
    ssl: false,
  };
}

/** @deprecated Compatibility export for callers that still use the old verifier name. */
export const localMilestoneDatabaseConfig = localEpicDatabaseConfig;

export function assertLocalDatabaseTarget(config) {
  if (!localHosts.has(config.host) || config.port !== 54322 || config.ssl !== false) {
    throw new Error(`Epic CRUD verification is local-only; received ${config.host}:${config.port}.`);
  }
}

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function expectCode(client, code, operation) {
  const savepoint = `epic_expected_${randomUUID().replaceAll("-", "")}`;
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

async function createItems(client, tokenId, profileId, items) {
  const key = randomUUID();
  const result = await client.query(
    "select public.create_team_planning_items_transaction($1, $2, $3, $4, $5::jsonb) as result",
    [tokenId, profileId, key, hash(items), JSON.stringify(items)],
  );
  return result.rows[0]?.result;
}

async function verifyEpicCrud(config) {
  const client = new pg.Client(config);
  await client.connect();
  await client.query("begin");
  try {
    const suffix = randomUUID().replaceAll("-", "");
    const ceoId = `epic-verifier-ceo-${suffix}`;
    const founderId = `epic-verifier-founder-${suffix}`;
    await client.query(
      `insert into public.profiles (id, name, role, platform_role)
       values ($1, 'Epic verifier CEO', 'admin', 'ceo'), ($2, 'Epic verifier Founder', 'member', 'founder')`,
      [ceoId, founderId],
    );
    await client.query(
      "insert into public.projects (id, name) values ($1, 'Epic CRUD verifier') on conflict (id) do nothing",
      [projectId],
    );
    const tokenResult = await client.query(
      "select public.create_team_planning_items_token_v2($1, $2, $3, $4, true, true) as result",
      [ceoId, "Epic CRUD verifier", hash(`token-${suffix}`), "verify-epic"],
    );
    const token = tokenResult.rows[0]?.result;
    assert.ok(token?.id);
    assert.ok(token.scopes?.includes("write:planning-items:delete-empty"));

    const legacyCountBefore = await client.query("select count(*)::integer as count from public.milestones");
    const created = await createItems(client, token.id, ceoId, [{
      itemType: "epic",
      title: "Transactional Epic",
      description: "Created by the local rollback verifier.",
      ownerId: ceoId,
      targetDate: "2026-12-31",
      status: "Offen",
    }]);
    const epic = created?.items?.[0]?.item;
    assert.equal(created?.items?.[0]?.itemType, "epic");
    assert.equal(epic?.task_type, "epic");
    assert.equal(epic?.status, "Offen");
    assert.equal(epic?.github_issue_sync_status, "not_applicable");

    const updateKey = randomUUID();
    const updatePatch = { status: "In Arbeit" };
    const updatedResult = await client.query(
      "select public.update_team_planning_item_transaction($1, $2, 'epic', $3, $4::timestamptz, $5, $6, $7::jsonb, '[\"status\"]'::jsonb, '[]'::jsonb) as result",
      [token.id, ceoId, epic.id, epic.updated_at, updateKey, hash({ itemType: "epic", itemId: epic.id, updatedAt: epic.updated_at, patch: updatePatch }), JSON.stringify(updatePatch)],
    );
    const updated = updatedResult.rows[0]?.result;
    assert.equal(updated?.itemType, "epic");
    assert.equal(updated?.item?.status, "In Arbeit");

    const childBatch = await createItems(client, token.id, ceoId, [{
      itemType: "initiative",
      title: "Epic child",
      ownerId: founderId,
      accountableProfileId: ceoId,
      responsibleProfileIds: [founderId],
      parentTaskId: epic.id,
      status: "Offen",
    }]);
    assert.equal(childBatch?.items?.[0]?.item?.parent_task_id, epic.id);
    await expectCode(client, "P0008", () => client.query(
      "select public.delete_team_planning_milestone_transaction($1, $2, $3, $4::timestamptz, $5, $6)",
      [token.id, ceoId, epic.id, updated.item.updated_at, randomUUID(), hash("blocked epic delete")],
    ));

    const emptyBatch = await createItems(client, token.id, ceoId, [{
      itemType: "epic",
      title: "Empty Epic",
      ownerId: ceoId,
      status: "Offen",
    }]);
    const emptyEpic = emptyBatch?.items?.[0]?.item;
    const deleteKey = randomUUID();
    const deleteHash = hash({ itemId: emptyEpic.id, expectedUpdatedAt: emptyEpic.updated_at });
    const deletedResult = await client.query(
      "select public.delete_team_planning_milestone_transaction($1, $2, $3, $4::timestamptz, $5, $6) as result",
      [token.id, ceoId, emptyEpic.id, emptyEpic.updated_at, deleteKey, deleteHash],
    );
    assert.equal(deletedResult.rows[0]?.result?.itemType, "epic");
    assert.equal(deletedResult.rows[0]?.result?.item?.id, emptyEpic.id);
    const replayed = await client.query(
      "select public.delete_team_planning_milestone_transaction($1, $2, $3, $4::timestamptz, $5, $6) as result",
      [token.id, ceoId, emptyEpic.id, emptyEpic.updated_at, deleteKey, deleteHash],
    );
    assert.equal(replayed.rows[0]?.result?.replayed, true);

    const compatibilityBatch = await createItems(client, token.id, ceoId, [{
      itemType: "epic",
      title: "Legacy adapter empty Epic",
      ownerId: ceoId,
      status: "Offen",
    }]);
    const compatibilityEpic = compatibilityBatch?.items?.[0]?.item;
    await expectCode(client, "P0006", () => client.query(
      "select public.delete_empty_epic_with_audit_transaction($1, $2::timestamptz, $3)",
      [compatibilityEpic.id, compatibilityEpic.updated_at, founderId],
    ));
    const auditCountBefore = await client.query(
      "select count(*)::integer as count from public.audit_log where action = 'milestone.delete' and entity_id = $1",
      [compatibilityEpic.id],
    );
    const compatibilityDelete = await client.query(
      "select public.delete_empty_epic_with_audit_transaction($1, $2::timestamptz, $3, $4, $5) as result",
      [compatibilityEpic.id, compatibilityEpic.updated_at, ceoId, "local-verifier", "FounderOps verifier"],
    );
    assert.equal(compatibilityDelete.rows[0]?.result?.item?.id, compatibilityEpic.id);
    const auditCountAfter = await client.query(
      "select count(*)::integer as count from public.audit_log where action = 'milestone.delete' and entity_id = $1",
      [compatibilityEpic.id],
    );
    assert.equal(auditCountAfter.rows[0]?.count, auditCountBefore.rows[0]?.count + 1);

    const rollbackBatch = await createItems(client, token.id, ceoId, [{
      itemType: "epic",
      title: "Rollback-compatible empty Epic",
      ownerId: ceoId,
      status: "Offen",
    }]);
    const rollbackEpic = rollbackBatch?.items?.[0]?.item;
    const rollbackDelete = await client.query(
      "select public.delete_empty_epic_transaction($1, $2::timestamptz, $3) as result",
      [rollbackEpic.id, rollbackEpic.updated_at, ceoId],
    );
    assert.equal(rollbackDelete.rows[0]?.result?.task?.id, rollbackEpic.id);

    const founderTokenResult = await client.query(
      "select public.create_team_planning_items_token($1, $2, $3, $4, false) as result",
      [founderId, "Epic CRUD founder verifier", hash(`founder-token-${suffix}`), "verify-founder"],
    );
    const founderToken = founderTokenResult.rows[0]?.result;
    await expectCode(client, "P0006", () => createItems(client, founderToken.id, founderId, [{
      itemType: "epic", title: "Founder cannot create Epic", ownerId: founderId, status: "Offen",
    }]));
    const legacyCountAfter = await client.query("select count(*)::integer as count from public.milestones");
    assert.equal(legacyCountAfter.rows[0]?.count, legacyCountBefore.rows[0]?.count, "Epic CRUD must not write the retained milestones table.");
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.end();
  }
}

const isDirectExecution = Boolean(
  process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href,
);

if (isDirectExecution) {
  try {
    const config = localEpicDatabaseConfig();
    assertLocalDatabaseTarget(config);
    await verifyEpicCrud(config);
    console.log("Epic CRUD verification passed; local test data was rolled back.");
  } catch (error) {
    console.error(`Epic CRUD verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
