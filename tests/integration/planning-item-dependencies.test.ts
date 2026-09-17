import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";
import {
  asAuthenticated,
  captureDatabaseError,
  localDatabaseUrl,
  withIsolatedLocalDatabase,
} from "./helpers/local-database";

type DependencyResult = {
  replayed: boolean;
  changed: boolean;
  warnings?: string[];
  systemEffects?: Array<{ field: string; before: unknown; after: unknown }>;
  dependencyChange: {
    operation: "add" | "remove";
    changed: boolean;
    relationship: {
      relationshipId: number;
      blockedItemId: string;
      blockingItemId: string;
      note: string | null;
    };
  };
};

const blockedItemId = "integration-dependency-blocked";
const blockingItemId = "integration-dependency-blocking";
const actorProfileId = "integration-dependency-ceo";
const actorAuthUserId = "50000000-0000-0000-0000-000000000010";

async function seedActorAndProject(client: import("pg").Client) {
  await client.query("insert into auth.users (id) values ($1)", [actorAuthUserId]);
  await client.query(
    `insert into public.profiles (id, auth_user_id, name, role, platform_role)
     values ($1, $2, 'Integration Dependency CEO', 'member', 'ceo')`,
    [actorProfileId, actorAuthUserId],
  );
  await client.query(
    `insert into public.projects (id, name)
     values ('findmydoc-founder-execution', 'Founder execution')`,
  );
}

async function currentUpdatedAt(client: import("pg").Client, taskId: string) {
  const result = await client.query<{ updated_at: string }>(
    "select updated_at::text from public.tasks where id = $1",
    [taskId],
  );
  return result.rows[0].updated_at;
}

async function taskMutationState(client: import("pg").Client, taskIds: string[]) {
  const result = await client.query<{
    id: string;
    updated_at: string;
    github_issue_sync_status: string;
    github_issue_sync_error: string | null;
  }>(
    `select id, updated_at::text, github_issue_sync_status, github_issue_sync_error
     from public.tasks
     where id = any($1::text[])
     order by id`,
    [taskIds],
  );
  return result.rows;
}

async function mutateDependency(
  client: import("pg").Client,
  input: {
    tokenId: string;
    idempotencyKey: string;
    requestHash: string;
    operation: "add" | "remove";
    taskId: string;
    relatedTaskId?: string | null;
    relationType?: "blocked_by" | "blocks" | null;
    relationshipId?: number | null;
    note?: string | null;
    expectedUpdatedAt: string;
    actorProfileId: string;
  },
) {
  const result = await client.query<{ result: DependencyResult }>(
    `select public.mutate_team_planning_dependency_transaction(
       p_token_id => $1,
       p_idempotency_key => $2,
       p_request_hash => $3,
       p_operation => $4,
       p_task_id => $5,
       p_related_task_id => $6,
       p_relation_type => $7,
       p_relation_id => $8,
       p_note => $9,
       p_expected_updated_at => $10,
       p_actor_profile_id => $11
     ) as result`,
    [
      input.tokenId,
      input.idempotencyKey,
      input.requestHash,
      input.operation,
      input.taskId,
      input.relatedTaskId ?? null,
      input.relationType ?? null,
      input.relationshipId ?? null,
      input.note ?? null,
      input.expectedUpdatedAt,
      input.actorProfileId,
    ],
  );
  return result.rows[0].result;
}

async function seedProfile(
  client: import("pg").Client,
  id: string,
  platformRole: "ceo" | "deputy" | "founder",
) {
  await client.query(
    `insert into public.profiles (id, name, role, platform_role)
     values ($1, $2, 'member', $3)`,
    [id, `Integration ${id}`, platformRole],
  );
}

async function seedUpdateToken(client: import("pg").Client, profileId: string) {
  const tokenId = randomUUID();
  await client.query(
    `insert into public.team_task_intake_tokens (
       id, profile_id, label, token_hash, token_hint, scopes, expires_at
     ) values (
       $1, $2, 'Dependency authorization', $3, 'authz',
       array['read:planning-context', 'write:planning-items:create', 'write:planning-items:update'], now() + interval '1 day'
     )`,
    [tokenId, profileId, tokenId.replaceAll("-", "").repeat(2)],
  );
  return tokenId;
}

async function seedTask(
  client: import("pg").Client,
  input: {
    id: string;
    owner: string;
    taskType?: "epic" | "initiative" | "deliverable" | "sub_issue";
    parentTaskId?: string | null;
  },
) {
  const taskType = input.taskType || "deliverable";
  await client.query(
    `insert into public.tasks (
       id, project_id, title, status, priority, owner, assignee, task_type,
       parent_task_id, approval_status, github_repo, github_issue_sync_status,
       score_relevant, created_by
     ) values (
       $1, 'findmydoc-founder-execution', $1, 'Offen', 'P2', $2, $2, $3,
       $4, $5, 'findmydoc-platform/management', $6, false, $2
     )`,
    [
      input.id,
      input.owner,
      taskType,
      input.parentTaskId || null,
      taskType === "initiative" ? "approved" : taskType === "deliverable" ? "proposed" : null,
      taskType === "epic" || taskType === "initiative" ? "not_applicable" : "not_synced",
    ],
  );
}

async function relationshipMutationCounts(client: import("pg").Client) {
  const result = await client.query<{ relationships: number; audits: number }>(`
    select
      (select count(*)::integer from public.task_relationship_edges) as relationships,
      (select count(*)::integer from public.audit_log where action like 'task.relationship_%') as audits
  `);
  return result.rows[0];
}

it("commits, replays, canonicalizes, reads, and removes a dependency atomically", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await seedActorAndProject(client);

    await client.query(
      `insert into public.tasks (
         id, project_id, title, status, priority, owner, assignee,
         task_type, approval_status, github_repo, score_relevant, created_by
       ) values
         ($1, 'findmydoc-founder-execution', 'Blocked integration item', 'Offen', 'P2', $3, $3,
          'deliverable', 'proposed', 'findmydoc-platform/management', false, $3),
         ($2, 'findmydoc-founder-execution', 'Blocking integration item', 'Offen', 'P2', $3, $3,
          'deliverable', 'proposed', 'findmydoc-platform/management', false, $3)`,
      [blockedItemId, blockingItemId, actorProfileId],
    );

    const tokenId = randomUUID();
    await client.query(
      `insert into public.team_task_intake_tokens (
         id, profile_id, label, token_hash, token_hint, scopes, expires_at
       ) values (
         $1, $2, 'Dependency integration', $3, 'test-token',
         array['read:planning-context', 'write:planning-items:create', 'write:planning-items:update'],
         now() + interval '1 day'
       )`,
      [tokenId, actorProfileId, "a".repeat(64)],
    );

    const addKey = randomUUID();
    const addExpectedUpdatedAt = await currentUpdatedAt(client, blockedItemId);
    const added = await mutateDependency(client, {
      tokenId,
      idempotencyKey: addKey,
      requestHash: "b".repeat(64),
      operation: "add",
      taskId: blockedItemId,
      relatedTaskId: blockingItemId,
      relationType: "blocked_by",
      note: "Wait for the blocking item",
      expectedUpdatedAt: addExpectedUpdatedAt,
      actorProfileId,
    });
    expect(added).toMatchObject({
      replayed: false,
      changed: true,
      dependencyChange: {
        operation: "add",
        changed: true,
        relationship: {
          blockedItemId,
          blockingItemId,
          note: "Wait for the blocking item",
        },
      },
    });
    const relationshipId = added.dependencyChange.relationship.relationshipId;

    const replayedAdd = await mutateDependency(client, {
      tokenId,
      idempotencyKey: addKey,
      requestHash: "b".repeat(64),
      operation: "add",
      taskId: blockedItemId,
      relatedTaskId: blockingItemId,
      relationType: "blocked_by",
      note: "Wait for the blocking item",
      expectedUpdatedAt: addExpectedUpdatedAt,
      actorProfileId,
    });
    expect(replayedAdd).toMatchObject({ replayed: true, changed: true });

    const conflictingReplay = await captureDatabaseError(client, () => mutateDependency(client, {
      tokenId,
      idempotencyKey: addKey,
      requestHash: "0".repeat(64),
      operation: "add",
      taskId: blockedItemId,
      relatedTaskId: blockingItemId,
      relationType: "blocked_by",
      note: "Different request",
      expectedUpdatedAt: addExpectedUpdatedAt,
      actorProfileId,
    }));
    expect(conflictingReplay).toMatchObject({ code: "P0003" });

    await client.query(
      `update public.tasks
       set github_issue_sync_status = 'synced',
           github_issue_sync_error = null,
           updated_at = clock_timestamp()
       where id = any($1::text[])`,
      [[blockedItemId, blockingItemId]],
    );
    const beforeNoOps = await taskMutationState(client, [blockedItemId, blockingItemId]);

    const exactNoOp = await mutateDependency(client, {
      tokenId,
      idempotencyKey: randomUUID(),
      requestHash: "c".repeat(64),
      operation: "add",
      taskId: blockedItemId,
      relatedTaskId: blockingItemId,
      relationType: "blocked_by",
      note: "Must not replace the existing note",
      expectedUpdatedAt: addExpectedUpdatedAt,
      actorProfileId,
    });
    expect(exactNoOp).toMatchObject({ changed: false, replayed: false });
    expect(exactNoOp.warnings).toEqual(["Die Aufgabenabhängigkeit besteht bereits und bleibt unverändert."]);
    expect(exactNoOp.dependencyChange.relationship.note).toBe("Wait for the blocking item");

    const inverseNoOp = await mutateDependency(client, {
      tokenId,
      idempotencyKey: randomUUID(),
      requestHash: "d".repeat(64),
      operation: "add",
      taskId: blockingItemId,
      relatedTaskId: blockedItemId,
      relationType: "blocks",
      note: "Also must not replace the note",
      expectedUpdatedAt: await currentUpdatedAt(client, blockingItemId),
      actorProfileId,
    });
    expect(inverseNoOp).toMatchObject({ changed: false, replayed: false });
    expect(inverseNoOp.dependencyChange.relationship).toEqual({
      relationshipId,
      blockedItemId,
      blockingItemId,
      note: "Wait for the blocking item",
    });
    expect(await taskMutationState(client, [blockedItemId, blockingItemId])).toEqual(beforeNoOps);

    const contextRead = await client.query(
      `select id, task_id, related_task_id, relation_type, note
       from public.task_relationship_edges
       where (task_id = $1 and related_task_id = $2)
          or (task_id = $2 and related_task_id = $1)`,
      [blockedItemId, blockingItemId],
    );
    expect(contextRead.rows).toEqual([{
      id: String(relationshipId),
      task_id: blockedItemId,
      related_task_id: blockingItemId,
      relation_type: "blocked_by",
      note: "Wait for the blocking item",
    }]);

    const addAuditCount = await client.query<{ count: string }>(
      `select count(*)::text as count
       from public.audit_log
       where entity_id = $1 and action = 'task.relationship_created'`,
      [blockedItemId],
    );
    expect(addAuditCount.rows[0].count).toBe("1");

    const removeKey = randomUUID();
    const removeExpectedUpdatedAt = await currentUpdatedAt(client, blockedItemId);
    const removed = await mutateDependency(client, {
      tokenId,
      idempotencyKey: removeKey,
      requestHash: "e".repeat(64),
      operation: "remove",
      taskId: blockedItemId,
      relationshipId,
      expectedUpdatedAt: removeExpectedUpdatedAt,
      actorProfileId,
    });
    expect(removed).toMatchObject({
      replayed: false,
      changed: true,
      dependencyChange: {
        operation: "remove",
        changed: true,
        relationship: { relationshipId, blockedItemId, blockingItemId },
      },
    });

    const replayedRemove = await mutateDependency(client, {
      tokenId,
      idempotencyKey: removeKey,
      requestHash: "e".repeat(64),
      operation: "remove",
      taskId: blockedItemId,
      relationshipId,
      expectedUpdatedAt: removeExpectedUpdatedAt,
      actorProfileId,
    });
    expect(replayedRemove).toMatchObject({ replayed: true, changed: true });

    const missingRemoveExpectedUpdatedAt = await currentUpdatedAt(client, blockedItemId);
    const missingRemove = await captureDatabaseError(client, () => mutateDependency(client, {
      tokenId,
      idempotencyKey: randomUUID(),
      requestHash: "f".repeat(64),
      operation: "remove",
      taskId: blockedItemId,
      relationshipId,
      expectedUpdatedAt: missingRemoveExpectedUpdatedAt,
      actorProfileId,
    }));
    expect(missingRemove).toMatchObject({ code: "P0002" });

    const finalState = await client.query(
      `select id from public.task_relationship_edges
       where task_id = any($1::text[]) or related_task_id = any($1::text[])`,
      [[blockedItemId, blockingItemId]],
    );
    expect(finalState.rowCount).toBe(0);

    const audits = await client.query<{ action: string }>(
      `select action from public.audit_log
       where entity_id = $1 and action like 'task.relationship_%'
       order by id`,
      [blockedItemId],
    );
    expect(audits.rows.map(({ action }) => action)).toEqual([
      "task.relationship_created",
      "task.relationship_deleted",
    ]);
  });
}, 30_000);

it("rechecks CEO, Deputy, and Founder relationship authorization inside the dependency transaction", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await seedActorAndProject(client);
    const deputyId = "dependency-deputy";
    const ownerId = "dependency-owner";
    const accountableId = "dependency-accountable";
    const unrelatedId = "dependency-unrelated";
    await seedProfile(client, deputyId, "deputy");
    await seedProfile(client, ownerId, "founder");
    await seedProfile(client, accountableId, "founder");
    await seedProfile(client, unrelatedId, "founder");
    const tokens = new Map<string, string>();
    for (const profileId of [actorProfileId, deputyId, ownerId, accountableId, unrelatedId]) {
      tokens.set(profileId, await seedUpdateToken(client, profileId));
    }

    await seedTask(client, { id: "authz-initiative", owner: actorProfileId, taskType: "initiative" });
    await client.query(
      `insert into public.planning_item_raci_assignments (task_id, profile_id, role, sort_order)
       values ('authz-initiative', $1, 'accountable', 0)`,
      [accountableId],
    );
    const taskOwners = new Map([
      ["authz-ceo-source", actorProfileId],
      ["authz-ceo-target", actorProfileId],
      ["authz-deputy-source", actorProfileId],
      ["authz-deputy-target", actorProfileId],
      ["authz-owner-source", ownerId],
      ["authz-owner-target", actorProfileId],
      ["authz-accountable-source", actorProfileId],
      ["authz-accountable-target", actorProfileId],
      ["authz-unrelated-source", actorProfileId],
      ["authz-unrelated-target", actorProfileId],
      ["authz-incoming-source", ownerId],
      ["authz-incoming-other", actorProfileId],
      ["authz-foreign-a", actorProfileId],
      ["authz-foreign-b", actorProfileId],
    ]);
    for (const [id, owner] of taskOwners) {
      await seedTask(client, {
        id,
        owner,
        parentTaskId: id.startsWith("authz-accountable") ? "authz-initiative" : null,
      });
    }

    const allowedCases = [
      { profileId: actorProfileId, source: "authz-ceo-source", target: "authz-ceo-target", direction: "blocks" as const },
      { profileId: deputyId, source: "authz-deputy-source", target: "authz-deputy-target", direction: "blocks" as const },
      { profileId: ownerId, source: "authz-owner-source", target: "authz-owner-target", direction: "blocked_by" as const },
      { profileId: accountableId, source: "authz-accountable-source", target: "authz-accountable-target", direction: "blocked_by" as const },
    ];
    for (const [index, allowed] of allowedCases.entries()) {
      const result = await mutateDependency(client, {
        tokenId: tokens.get(allowed.profileId)!,
        idempotencyKey: randomUUID(),
        requestHash: String(index + 1).repeat(64),
        operation: "add",
        taskId: allowed.source,
        relatedTaskId: allowed.target,
        relationType: allowed.direction,
        expectedUpdatedAt: await currentUpdatedAt(client, allowed.source),
        actorProfileId: allowed.profileId,
      });
      expect(result).toMatchObject({ changed: true, replayed: false });
    }

    const negativeAdds = [
      { profileId: unrelatedId, source: "authz-unrelated-source", target: "authz-unrelated-target", direction: "blocked_by" as const },
      { profileId: ownerId, source: "authz-owner-source", target: "authz-unrelated-target", direction: "blocks" as const },
    ];
    for (const [index, denied] of negativeAdds.entries()) {
      const before = await relationshipMutationCounts(client);
      const deniedExpectedUpdatedAt = await currentUpdatedAt(client, denied.source);
      const error = await captureDatabaseError(client, () => mutateDependency(client, {
        tokenId: tokens.get(denied.profileId)!,
        idempotencyKey: randomUUID(),
        requestHash: String(index + 5).repeat(64),
        operation: "add",
        taskId: denied.source,
        relatedTaskId: denied.target,
        relationType: denied.direction,
        expectedUpdatedAt: deniedExpectedUpdatedAt,
        actorProfileId: denied.profileId,
      }));
      expect(error).toMatchObject({ code: "P0006" });
      expect(await relationshipMutationCounts(client)).toEqual(before);
    }

    const incoming = await client.query<{ id: string }>(
      `insert into public.task_relationship_edges (task_id, related_task_id, relation_type, created_by)
       values ('authz-incoming-other', 'authz-incoming-source', 'blocked_by', $1)
       returning id::text`,
      [actorProfileId],
    );
    const beforeIncoming = await relationshipMutationCounts(client);
    const incomingExpectedUpdatedAt = await currentUpdatedAt(client, "authz-incoming-source");
    const incomingError = await captureDatabaseError(client, () => mutateDependency(client, {
      tokenId: tokens.get(ownerId)!,
      idempotencyKey: randomUUID(),
      requestHash: "7".repeat(64),
      operation: "remove",
      taskId: "authz-incoming-source",
      relationshipId: Number(incoming.rows[0].id),
      expectedUpdatedAt: incomingExpectedUpdatedAt,
      actorProfileId: ownerId,
    }));
    expect(incomingError).toMatchObject({ code: "P0006" });
    expect(await relationshipMutationCounts(client)).toEqual(beforeIncoming);

    const foreign = await client.query<{ id: string }>(
      `insert into public.task_relationship_edges (task_id, related_task_id, relation_type, created_by)
       values ('authz-foreign-a', 'authz-foreign-b', 'blocked_by', $1)
       returning id::text`,
      [actorProfileId],
    );
    const beforeForeign = await relationshipMutationCounts(client);
    const foreignExpectedUpdatedAt = await currentUpdatedAt(client, "authz-ceo-source");
    const foreignError = await captureDatabaseError(client, () => mutateDependency(client, {
      tokenId: tokens.get(actorProfileId)!,
      idempotencyKey: randomUUID(),
      requestHash: "8".repeat(64),
      operation: "remove",
      taskId: "authz-ceo-source",
      relationshipId: Number(foreign.rows[0].id),
      expectedUpdatedAt: foreignExpectedUpdatedAt,
      actorProfileId,
    }));
    expect(foreignError).toMatchObject({ code: "P0006" });
    expect(await relationshipMutationCounts(client)).toEqual(beforeForeign);
  });
}, 30_000);

it("keeps dependency lock and integrity guards inside the atomic API transaction", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await seedActorAndProject(client);
    const tokenId = await seedUpdateToken(client, actorProfileId);
    await seedTask(client, { id: "guard-source-parent", owner: actorProfileId, taskType: "initiative" });
    await seedTask(client, { id: "guard-related-parent", owner: actorProfileId, taskType: "initiative" });
    await seedTask(client, { id: "guard-source", owner: actorProfileId, parentTaskId: "guard-source-parent" });
    await seedTask(client, { id: "guard-related", owner: actorProfileId, parentTaskId: "guard-related-parent" });
    await seedTask(client, { id: "guard-foreign-a", owner: actorProfileId });
    await seedTask(client, { id: "guard-foreign-b", owner: actorProfileId });
    await client.query("select set_config('founderops.trash_lifecycle_write', 'on', true)");

    const resetGuards = async () => {
      await client.query(
        `update public.tasks
         set status = 'Offen', review_status = 'not_requested', score_final = false,
             trashed_at = null, trashed_by = null, trash_reason = null, trash_cause = null,
             purge_after = null, trash_root_type = null, trash_root_id = null, trash_revision = 0
         where id = any($1::text[])`,
        [["guard-source-parent", "guard-related-parent", "guard-source", "guard-related"]],
      );
      await client.query(
        `delete from public.task_relationship_edges
         where task_id like 'guard-%' or related_task_id like 'guard-%'`,
      );
    };
    const addInput = async () => ({
      tokenId,
      idempotencyKey: randomUUID(),
      requestHash: "a".repeat(64),
      operation: "add" as const,
      taskId: "guard-source",
      relatedTaskId: "guard-related",
      relationType: "blocked_by" as const,
      expectedUpdatedAt: await currentUpdatedAt(client, "guard-source"),
      actorProfileId,
    });

    const cases: Array<{
      name: string;
      code: string;
      prepare: () => Promise<Parameters<typeof mutateDependency>[1]>;
    }> = [
      {
        name: "stale revision",
        code: "P0001",
        prepare: async () => ({ ...(await addInput()), expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
      },
      {
        name: "trashed source",
        code: "P0010",
        prepare: async () => {
          await client.query(
            `with timestamp as (select clock_timestamp() as value)
             update public.tasks
             set trashed_at = timestamp.value, trashed_by = $1, trash_reason = 'Integration guard',
                 trash_cause = 'withdrawn', purge_after = timestamp.value + interval '90 days',
                 trash_root_type = 'deliverable', trash_root_id = id, trash_revision = 1
             from timestamp where id = 'guard-source'`,
            [actorProfileId],
          );
          return addInput();
        },
      },
      {
        name: "trashed related item",
        code: "P0011",
        prepare: async () => {
          await client.query(
            `with timestamp as (select clock_timestamp() as value)
             update public.tasks
             set trashed_at = timestamp.value, trashed_by = $1, trash_reason = 'Integration guard',
                 trash_cause = 'withdrawn', purge_after = timestamp.value + interval '90 days',
                 trash_root_type = 'deliverable', trash_root_id = id, trash_revision = 1
             from timestamp where id = 'guard-related'`,
            [actorProfileId],
          );
          return addInput();
        },
      },
      {
        name: "active review",
        code: "P0008",
        prepare: async () => {
          await client.query(
            "update public.tasks set review_status = 'requested', review_evidence_exception_note = 'Integration guard', review_evidence_exception_confirmed_at = clock_timestamp() where id = 'guard-source'",
          );
          return addInput();
        },
      },
      {
        name: "final review",
        code: "P0008",
        prepare: async () => {
          await client.query(
            "update public.tasks set review_status = 'accepted', score_final = true, review_evidence_exception_note = 'Integration guard', review_evidence_exception_confirmed_at = clock_timestamp() where id = 'guard-source'",
          );
          return addInput();
        },
      },
      {
        name: "completed source",
        code: "P0016",
        prepare: async () => {
          await client.query("update public.tasks set status = 'Erledigt' where id = 'guard-source'");
          return addInput();
        },
      },
      {
        name: "completed related parent",
        code: "P0016",
        prepare: async () => {
          await client.query("update public.tasks set status = 'Erledigt' where id = 'guard-related-parent'");
          return addInput();
        },
      },
      {
        name: "self link",
        code: "22023",
        prepare: async () => ({ ...(await addInput()), relatedTaskId: "guard-source" }),
      },
      {
        name: "missing related item",
        code: "P0002",
        prepare: async () => ({ ...(await addInput()), relatedTaskId: "guard-missing" }),
      },
      {
        name: "foreign relationship removal",
        code: "P0006",
        prepare: async () => {
          const relation = await client.query<{ id: string }>(
            `insert into public.task_relationship_edges (task_id, related_task_id, relation_type, created_by)
             values ('guard-foreign-a', 'guard-foreign-b', 'blocked_by', $1)
             returning id::text`,
            [actorProfileId],
          );
          return {
            tokenId,
            idempotencyKey: randomUUID(),
            requestHash: "a".repeat(64),
            operation: "remove",
            taskId: "guard-source",
            relationshipId: Number(relation.rows[0].id),
            expectedUpdatedAt: await currentUpdatedAt(client, "guard-source"),
            actorProfileId,
          };
        },
      },
      {
        name: "non-dependency relationship removal",
        code: "P0002",
        prepare: async () => {
          const relation = await client.query<{ id: string }>(
            `insert into public.task_relationship_edges (task_id, related_task_id, relation_type, created_by)
             values ('guard-source', 'guard-related', 'relates_to', $1)
             returning id::text`,
            [actorProfileId],
          );
          return {
            tokenId,
            idempotencyKey: randomUUID(),
            requestHash: "a".repeat(64),
            operation: "remove",
            taskId: "guard-source",
            relationshipId: Number(relation.rows[0].id),
            expectedUpdatedAt: await currentUpdatedAt(client, "guard-source"),
            actorProfileId,
          };
        },
      },
    ];

    for (const [index, guardCase] of cases.entries()) {
      await resetGuards();
      const input = await guardCase.prepare();
      input.requestHash = "abcdef0123456789"[index].repeat(64);
      const before = await relationshipMutationCounts(client);
      const error = await captureDatabaseError(client, () => mutateDependency(client, input));
      expect(error, guardCase.name).toMatchObject({ code: guardCase.code });
      expect(await relationshipMutationCounts(client), guardCase.name).toEqual(before);
    }
  });
}, 30_000);

it("advances strategic revisions on real dependency changes but not on semantic no-ops", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await seedActorAndProject(client);
    const tokenId = await seedUpdateToken(client, actorProfileId);
    await seedTask(client, { id: "strategic-epic-source", owner: actorProfileId, taskType: "epic" });
    await seedTask(client, { id: "strategic-initiative-target", owner: actorProfileId, taskType: "initiative" });
    await seedTask(client, { id: "strategic-epic-target", owner: actorProfileId, taskType: "epic" });
    await seedTask(client, { id: "strategic-initiative-source", owner: actorProfileId, taskType: "initiative" });

    const cases = [
      { source: "strategic-epic-source", target: "strategic-initiative-target", addHash: "a", noOpHash: "b", removeHash: "c" },
      { source: "strategic-initiative-source", target: "strategic-epic-target", addHash: "d", noOpHash: "e", removeHash: "f" },
    ];
    for (const strategic of cases) {
      const beforeRevision = await currentUpdatedAt(client, strategic.source);
      const added = await mutateDependency(client, {
        tokenId,
        idempotencyKey: randomUUID(),
        requestHash: strategic.addHash.repeat(64),
        operation: "add",
        taskId: strategic.source,
        relatedTaskId: strategic.target,
        relationType: "blocked_by",
        expectedUpdatedAt: beforeRevision,
        actorProfileId,
      });
      expect(added).toMatchObject({ changed: true, replayed: false });
      expect(added.systemEffects?.map(({ field }) => field)).toEqual(["dependencies"]);
      const afterAdd = await taskMutationState(client, [strategic.source, strategic.target]);
      expect(afterAdd.find(({ id }) => id === strategic.source)?.updated_at).not.toBe(beforeRevision);

      const noOp = await mutateDependency(client, {
        tokenId,
        idempotencyKey: randomUUID(),
        requestHash: strategic.noOpHash.repeat(64),
        operation: "add",
        taskId: strategic.source,
        relatedTaskId: strategic.target,
        relationType: "blocked_by",
        expectedUpdatedAt: beforeRevision,
        actorProfileId,
      });
      expect(noOp).toMatchObject({ changed: false, replayed: false, systemEffects: [] });
      expect(await taskMutationState(client, [strategic.source, strategic.target])).toEqual(afterAdd);

      const staleRemove = await captureDatabaseError(client, () => mutateDependency(client, {
        tokenId,
        idempotencyKey: randomUUID(),
        requestHash: strategic.removeHash.repeat(64),
        operation: "remove",
        taskId: strategic.source,
        relationshipId: added.dependencyChange.relationship.relationshipId,
        expectedUpdatedAt: beforeRevision,
        actorProfileId,
      }));
      expect(staleRemove).toMatchObject({ code: "P0001" });
    }
  });
}, 30_000);

it("enforces the semantic uniqueness constraint and keeps authenticated writes on existing RLS", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await seedActorAndProject(client);

    await client.query(
      `insert into public.tasks (
         id, project_id, title, status, priority, owner, assignee,
         task_type, approval_status, github_repo, score_relevant, created_by
       ) values
         ($1, 'findmydoc-founder-execution', 'Blocked uniqueness item', 'Offen', 'P2', $3, $3,
          'deliverable', 'proposed', 'findmydoc-platform/management', false, $3),
         ($2, 'findmydoc-founder-execution', 'Blocking uniqueness item', 'Offen', 'P2', $3, $3,
          'deliverable', 'proposed', 'findmydoc-platform/management', false, $3)`,
      [blockedItemId, blockingItemId, actorProfileId],
    );
    await client.query(
      `insert into public.task_relationship_edges (
         task_id, related_task_id, relation_type, created_by
       ) values ($1, $2, 'blocked_by', $3)`,
      [blockedItemId, blockingItemId, actorProfileId],
    );

    const inverseError = await captureDatabaseError(client, () => client.query(
      `insert into public.task_relationship_edges (
         task_id, related_task_id, relation_type, created_by
       ) values ($1, $2, 'blocks', $3)`,
      [blockingItemId, blockedItemId, actorProfileId],
    ));
    expect(inverseError).toMatchObject({ code: "23505" });

    const authenticatedWriteError = await captureDatabaseError(client, () => asAuthenticated(
      client,
      actorAuthUserId,
      () => client.query(
        `insert into public.task_relationship_edges (
           task_id, related_task_id, relation_type, created_by
         ) values ($1, $2, 'blocks', $3)`,
        [blockingItemId, blockedItemId, actorProfileId],
      ),
    ));
    expect(authenticatedWriteError).toMatchObject({ code: "42501" });
  });
}, 30_000);

it("rechecks the update scope inside the dependency transaction", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await seedActorAndProject(client);
    await client.query(
      `insert into public.tasks (
         id, project_id, title, status, priority, owner, assignee,
         task_type, approval_status, github_repo, score_relevant, created_by
       ) values
         ($1, 'findmydoc-founder-execution', 'Scope source item', 'Offen', 'P2', $3, $3,
          'deliverable', 'proposed', 'findmydoc-platform/management', false, $3),
         ($2, 'findmydoc-founder-execution', 'Scope related item', 'Offen', 'P2', $3, $3,
          'deliverable', 'proposed', 'findmydoc-platform/management', false, $3)`,
      [blockedItemId, blockingItemId, actorProfileId],
    );
    const tokenId = randomUUID();
    await client.query(
      `insert into public.team_task_intake_tokens (
         id, profile_id, label, token_hash, token_hint, scopes, expires_at
       ) values (
         $1, $2, 'Read-only integration', $3, 'readonly',
         array['read:planning-context', 'write:planning-items:create'], now() + interval '1 day'
       )`,
      [tokenId, actorProfileId, "9".repeat(64)],
    );

    const scopeExpectedUpdatedAt = await currentUpdatedAt(client, blockedItemId);
    const scopeError = await captureDatabaseError(client, () => mutateDependency(client, {
      tokenId,
      idempotencyKey: randomUUID(),
      requestHash: "8".repeat(64),
      operation: "add",
      taskId: blockedItemId,
      relatedTaskId: blockingItemId,
      relationType: "blocked_by",
      expectedUpdatedAt: scopeExpectedUpdatedAt,
      actorProfileId,
    }));
    expect(scopeError).toMatchObject({ code: "P0005" });
  });
}, 30_000);

it("rejects non-dependency relation types in the atomic API transaction", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await seedActorAndProject(client);
    await client.query(
      `insert into public.tasks (
         id, project_id, title, status, priority, owner, assignee,
         task_type, approval_status, github_repo, score_relevant, created_by
       ) values
         ($1, 'findmydoc-founder-execution', 'Invalid direction source', 'Offen', 'P2', $3, $3,
          'deliverable', 'proposed', 'findmydoc-platform/management', false, $3),
         ($2, 'findmydoc-founder-execution', 'Invalid direction target', 'Offen', 'P2', $3, $3,
          'deliverable', 'proposed', 'findmydoc-platform/management', false, $3)`,
      [blockedItemId, blockingItemId, actorProfileId],
    );
    const tokenId = randomUUID();
    await client.query(
      `insert into public.team_task_intake_tokens (
         id, profile_id, label, token_hash, token_hint, scopes, expires_at
       ) values (
         $1, $2, 'Invalid dependency direction', $3, 'invalid',
         array['read:planning-context', 'write:planning-items:create', 'write:planning-items:update'],
         now() + interval '1 day'
       )`,
      [tokenId, actorProfileId, "4".repeat(64)],
    );

    const expectedUpdatedAt = await currentUpdatedAt(client, blockedItemId);
    const error = await captureDatabaseError(client, () => client.query(
      `select public.mutate_team_planning_dependency_transaction(
         $1, $2, $3, 'add', $4, $5, 'relates_to', null, '', $6, $7
       )`,
      [
        tokenId,
        randomUUID(),
        "3".repeat(64),
        blockedItemId,
        blockingItemId,
        expectedUpdatedAt,
        actorProfileId,
      ],
    ));
    expect(error).toMatchObject({ code: "22023" });
  });
}, 30_000);

it("serializes concurrent add and remove calls across receipt replays and semantic duplicates", async () => {
  const databaseUrl = await localDatabaseUrl();
  const setup = new pg.Client(databaseUrl);
  const first = new pg.Client(databaseUrl);
  const second = new pg.Client(databaseUrl);
  const suffix = randomUUID();
  const concurrentActorId = `concurrent-actor-${suffix}`;
  const concurrentBlockedId = `concurrent-blocked-${suffix}`;
  const concurrentBlockingId = `concurrent-blocking-${suffix}`;
  const concurrentTokenId = randomUUID();
  let createdProject = false;

  await setup.connect();
  try {
    const project = await setup.query(`
      insert into public.projects (id, name)
      values ('findmydoc-founder-execution', 'Founder execution')
      on conflict (id) do nothing
      returning id
    `);
    createdProject = project.rowCount === 1;
    await setup.query(
      `insert into public.profiles (id, name, role, platform_role)
       values ($1, 'Concurrent dependency CEO', 'member', 'ceo')`,
      [concurrentActorId],
    );
    await setup.query(
      `insert into public.tasks (
         id, project_id, title, status, priority, owner, assignee,
         task_type, approval_status, github_repo, score_relevant, created_by
       ) values
         ($1, 'findmydoc-founder-execution', 'Concurrent blocked item', 'Offen', 'P2', $3, $3,
          'deliverable', 'proposed', 'findmydoc-platform/management', false, $3),
         ($2, 'findmydoc-founder-execution', 'Concurrent blocking item', 'Offen', 'P2', $3, $3,
          'deliverable', 'proposed', 'findmydoc-platform/management', false, $3)`,
      [concurrentBlockedId, concurrentBlockingId, concurrentActorId],
    );
    await setup.query(
      `insert into public.team_task_intake_tokens (
         id, profile_id, label, token_hash, token_hint, scopes, expires_at
       ) values (
         $1, $2, 'Concurrent dependency', $3, 'concurrent',
         array['read:planning-context', 'write:planning-items:create', 'write:planning-items:update'],
         now() + interval '1 day'
       )`,
      [concurrentTokenId, concurrentActorId, "7".repeat(64)],
    );
    const expectedUpdatedAt = await currentUpdatedAt(setup, concurrentBlockedId);

    await Promise.all([first.connect(), second.connect()]);
    const addKey = randomUUID();
    const replayedAdds = await Promise.all([
      mutateDependency(first, {
        tokenId: concurrentTokenId,
        idempotencyKey: addKey,
        requestHash: "6".repeat(64),
        operation: "add",
        taskId: concurrentBlockedId,
        relatedTaskId: concurrentBlockingId,
        relationType: "blocked_by",
        expectedUpdatedAt,
        actorProfileId: concurrentActorId,
      }),
      mutateDependency(second, {
        tokenId: concurrentTokenId,
        idempotencyKey: addKey,
        requestHash: "6".repeat(64),
        operation: "add",
        taskId: concurrentBlockedId,
        relatedTaskId: concurrentBlockingId,
        relationType: "blocked_by",
        expectedUpdatedAt,
        actorProfileId: concurrentActorId,
      }),
    ]);
    expect(replayedAdds.map(({ changed }) => changed)).toEqual([true, true]);
    expect(replayedAdds.map(({ replayed }) => replayed).sort()).toEqual([false, true]);

    const relation = await setup.query<{ id: string }>(
      `select id::text
       from public.task_relationship_edges
       where task_id = $1 and related_task_id = $2 and relation_type = 'blocked_by'`,
      [concurrentBlockedId, concurrentBlockingId],
    );
    const relationshipId = Number(relation.rows[0].id);
    const removeExpectedUpdatedAt = await currentUpdatedAt(setup, concurrentBlockedId);
    const removeKey = randomUUID();
    const replayedRemoves = await Promise.all([
      mutateDependency(first, {
        tokenId: concurrentTokenId,
        idempotencyKey: removeKey,
        requestHash: "5".repeat(64),
        operation: "remove",
        taskId: concurrentBlockedId,
        relationshipId,
        expectedUpdatedAt: removeExpectedUpdatedAt,
        actorProfileId: concurrentActorId,
      }),
      mutateDependency(second, {
        tokenId: concurrentTokenId,
        idempotencyKey: removeKey,
        requestHash: "5".repeat(64),
        operation: "remove",
        taskId: concurrentBlockedId,
        relationshipId,
        expectedUpdatedAt: removeExpectedUpdatedAt,
        actorProfileId: concurrentActorId,
      }),
    ]);
    expect(replayedRemoves.map(({ changed }) => changed)).toEqual([true, true]);
    expect(replayedRemoves.map(({ replayed }) => replayed).sort()).toEqual([false, true]);

    const duplicateExpectedUpdatedAt = await currentUpdatedAt(setup, concurrentBlockedId);
    const semanticAdds = await Promise.all([
      mutateDependency(first, {
        tokenId: concurrentTokenId,
        idempotencyKey: randomUUID(),
        requestHash: "4".repeat(64),
        operation: "add",
        taskId: concurrentBlockedId,
        relatedTaskId: concurrentBlockingId,
        relationType: "blocked_by",
        expectedUpdatedAt: duplicateExpectedUpdatedAt,
        actorProfileId: concurrentActorId,
      }),
      mutateDependency(second, {
        tokenId: concurrentTokenId,
        idempotencyKey: randomUUID(),
        requestHash: "3".repeat(64),
        operation: "add",
        taskId: concurrentBlockedId,
        relatedTaskId: concurrentBlockingId,
        relationType: "blocked_by",
        expectedUpdatedAt: duplicateExpectedUpdatedAt,
        actorProfileId: concurrentActorId,
      }),
    ]);
    expect(semanticAdds.map(({ changed }) => changed).sort()).toEqual([false, true]);
    expect(semanticAdds.every(({ replayed }) => replayed === false)).toBe(true);

    const relationCount = await setup.query<{ count: string }>(
      `select count(*)::text as count
       from public.task_relationship_edges
       where (task_id = $1 and related_task_id = $2)
          or (task_id = $2 and related_task_id = $1)`,
      [concurrentBlockedId, concurrentBlockingId],
    );
    expect(relationCount.rows[0].count).toBe("1");
    const auditCount = await setup.query<{ count: string }>(
      `select count(*)::text as count
       from public.audit_log
       where entity_id = $1 and action = 'task.relationship_created'`,
      [concurrentBlockedId],
    );
    expect(auditCount.rows[0].count).toBe("2");
    const removeAuditCount = await setup.query<{ count: string }>(
      `select count(*)::text as count
       from public.audit_log
       where entity_id = $1 and action = 'task.relationship_deleted'`,
      [concurrentBlockedId],
    );
    expect(removeAuditCount.rows[0].count).toBe("1");
  } finally {
    await Promise.allSettled([first.end(), second.end()]);
    await setup.query("delete from public.team_planning_item_update_requests where token_id = $1", [concurrentTokenId]).catch(() => undefined);
    await setup.query("delete from public.task_relationship_edges where task_id = any($1::text[]) or related_task_id = any($1::text[])", [[concurrentBlockedId, concurrentBlockingId]]).catch(() => undefined);
    await setup.query("delete from public.audit_log where entity_id = any($1::text[])", [[concurrentBlockedId, concurrentBlockingId]]).catch(() => undefined);
    await setup.query("delete from public.team_task_intake_tokens where id = $1", [concurrentTokenId]).catch(() => undefined);
    await setup.query("delete from public.tasks where id = any($1::text[])", [[concurrentBlockedId, concurrentBlockingId]]).catch(() => undefined);
    await setup.query("delete from public.profiles where id = $1", [concurrentActorId]).catch(() => undefined);
    if (createdProject) {
      await setup.query("delete from public.projects where id = 'findmydoc-founder-execution'").catch(() => undefined);
    }
    await setup.end();
  }
}, 30_000);
