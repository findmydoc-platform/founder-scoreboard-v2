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

    const exactNoOp = await mutateDependency(client, {
      tokenId,
      idempotencyKey: randomUUID(),
      requestHash: "c".repeat(64),
      operation: "add",
      taskId: blockedItemId,
      relatedTaskId: blockingItemId,
      relationType: "blocked_by",
      note: "Must not replace the existing note",
      expectedUpdatedAt: await currentUpdatedAt(client, blockedItemId),
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

it("serializes concurrent adds to one dependency and one audit effect", async () => {
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
    const attempts = await Promise.allSettled([
      mutateDependency(first, {
        tokenId: concurrentTokenId,
        idempotencyKey: randomUUID(),
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
        idempotencyKey: randomUUID(),
        requestHash: "5".repeat(64),
        operation: "add",
        taskId: concurrentBlockedId,
        relatedTaskId: concurrentBlockingId,
        relationType: "blocked_by",
        expectedUpdatedAt,
        actorProfileId: concurrentActorId,
      }),
    ]);

    const successful = attempts.filter((attempt) => attempt.status === "fulfilled");
    const rejected = attempts.filter((attempt) => attempt.status === "rejected");
    expect(successful).toHaveLength(1);
    expect(successful[0].value).toMatchObject({ changed: true, replayed: false });
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ code: "P0001" });

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
    expect(auditCount.rows[0].count).toBe("1");
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
