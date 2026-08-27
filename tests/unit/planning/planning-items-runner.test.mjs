import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const runner = await importTestModule(
  "src/features/planning-items/model/planning-items-runner.ts",
);

const sessionActor = {
  profileId: "profile-1",
  platformRole: "founder",
  credential: { kind: "session" },
};
const tokenActor = {
  profileId: "profile-2",
  platformRole: "deputy",
  credential: {
    kind: "planningToken",
    tokenId: "token-1",
    scopes: ["write:planning-items:update"],
  },
};
const command = {
  kind: "reviseItem",
  itemId: "item-1",
  expectedRevision: "revision-1",
  changes: { itemKind: "deliverable", title: "Revised" },
};
const projectedItem = {
  id: "item-1",
  kind: "deliverable",
  title: "Revised",
  revision: "revision-2",
  createdAt: "2026-08-12T10:00:00.000Z",
  updatedAt: "2026-08-12T11:00:00.000Z",
};
const change = { field: "title", before: "Current", after: "Revised" };
const effect = { kind: "audit", description: "Record title change" };

function dependencies(calls) {
  return {
    store: {
      async prepare(request) {
        calls.prepare.push(request);
        return { kind: "state", state: { currentTitle: "Current" } };
      },
      async commit(request) {
        calls.commit.push(request);
        return {
          ok: true,
          receipt: {
            items: [projectedItem],
            changes: [change],
            effects: [{ ...effect, status: "applied" }],
            replayed: false,
          },
        };
      },
    },
    decisionCore: {
      decide(input) {
        calls.decide.push(input);
        return {
          ok: true,
          items: [projectedItem],
          changes: [change],
          effects: [effect],
          warnings: [],
          commitPlan: { nextTitle: "Revised" },
        };
      },
    },
  };
}

function callLog() {
  return { prepare: [], decide: [], commit: [] };
}

test("preview and commit run the same mode-blind decision core", async () => {
  const previewCalls = callLog();
  const commitCalls = callLog();
  const previewPlanning = runner.createPlanningItems(dependencies(previewCalls));
  const commitPlanning = runner.createPlanningItems(dependencies(commitCalls));

  const preview = await previewPlanning.run({ actor: sessionActor, mode: "preview", command });
  const commit = await commitPlanning.run({ actor: sessionActor, mode: "commit", command });

  assert.equal(preview.status, "previewed");
  assert.equal(commit.status, "committed");
  assert.deepEqual(previewCalls.decide, commitCalls.decide);
  assert.equal("mode" in previewCalls.decide[0], false);
  assert.equal(previewCalls.commit.length, 0);
  assert.equal(commitCalls.commit.length, 1);
});

test("preview never forwards idempotency or request metadata to policy or persistence", async () => {
  const calls = callLog();
  const planning = runner.createPlanningItems(dependencies(calls));

  await planning.run({
    actor: tokenActor,
    mode: "preview",
    command,
    idempotencyKey: "key-1",
    requestMetadata: { requestIp: "127.0.0.1", userAgent: "test" },
  });

  assert.equal(calls.prepare[0].idempotencyKey, undefined);
  assert.equal("requestMetadata" in calls.decide[0], false);
  assert.equal(calls.commit.length, 0);
});

test("planning token commit requires idempotency before any dependency call", async () => {
  const calls = callLog();
  const planning = runner.createPlanningItems(dependencies(calls));

  const result = await planning.run({ actor: tokenActor, mode: "commit", command });

  assert.deepEqual(result, {
    ok: false,
    error: {
      code: "invalidCommand",
      issues: [{
        path: "idempotencyKey",
        reason: "Planning token commits require an idempotency key.",
      }],
    },
  });
  assert.deepEqual(calls, callLog());
});

test("commit receives the accepted semantic plan exactly once", async () => {
  const calls = callLog();
  const planning = runner.createPlanningItems(dependencies(calls));
  const metadata = { requestIp: "127.0.0.1", userAgent: "test" };

  const result = await planning.run({
    actor: tokenActor,
    mode: "commit",
    command,
    idempotencyKey: "key-1",
    requestMetadata: metadata,
  });

  assert.equal(result.status, "committed");
  assert.deepEqual(calls.commit, [{
    actor: tokenActor,
    command,
    plan: { nextTitle: "Revised" },
    idempotencyKey: "key-1",
    requestMetadata: metadata,
  }]);
});

test("replay bypasses policy and commit without creating effects", async () => {
  const calls = callLog();
  const deps = dependencies(calls);
  deps.store.prepare = async (request) => {
    calls.prepare.push(request);
    return {
      kind: "replay",
      receipt: {
        items: [projectedItem],
        changes: [change],
        effects: [{ ...effect, status: "applied" }],
        replayed: false,
      },
    };
  };
  const planning = runner.createPlanningItems(deps);

  const result = await planning.run({
    actor: tokenActor,
    mode: "commit",
    command,
    idempotencyKey: "key-1",
  });

  assert.equal(result.status, "committed");
  assert.equal(result.replayed, true);
  assert.equal(calls.decide.length, 0);
  assert.equal(calls.commit.length, 0);
});

test("preview cannot be converted into a committed replay by a broken adapter", async () => {
  const calls = callLog();
  const deps = dependencies(calls);
  deps.store.prepare = async () => ({
    kind: "replay",
    receipt: {
      items: [projectedItem],
      changes: [change],
      effects: [{ ...effect, status: "applied" }],
      replayed: false,
    },
  });
  const planning = runner.createPlanningItems(deps);

  const result = await planning.run({ actor: sessionActor, mode: "preview", command });

  assert.deepEqual(result, {
    ok: false,
    error: { code: "dependencyUnavailable", dependency: "database", retryable: true },
  });
  assert.equal(calls.decide.length, 0);
  assert.equal(calls.commit.length, 0);
});

test("typed policy errors stop before commit", async () => {
  const calls = callLog();
  const deps = dependencies(calls);
  deps.decisionCore.decide = (input) => {
    calls.decide.push(input);
    return { ok: false, error: { code: "forbidden", reason: "owner mismatch" } };
  };
  const planning = runner.createPlanningItems(deps);

  const result = await planning.run({ actor: sessionActor, mode: "commit", command });

  assert.deepEqual(result, { ok: false, error: { code: "forbidden", reason: "owner mismatch" } });
  assert.equal(calls.commit.length, 0);
});

test("unexpected persistence failures become stable dependency errors", async () => {
  const prepareCalls = callLog();
  const prepareDeps = dependencies(prepareCalls);
  prepareDeps.store.prepare = async () => {
    throw new Error("relation tasks does not exist; secret-provider-detail");
  };
  const commitCalls = callLog();
  const commitDeps = dependencies(commitCalls);
  commitDeps.store.commit = async () => {
    throw new Error("SQLSTATE 99999; secret-provider-detail");
  };

  const prepareResult = await runner.createPlanningItems(prepareDeps)
    .run({ actor: sessionActor, mode: "preview", command });
  const commitResult = await runner.createPlanningItems(commitDeps)
    .run({ actor: sessionActor, mode: "commit", command });

  const expected = {
    ok: false,
    error: { code: "dependencyUnavailable", dependency: "database", retryable: true },
  };
  assert.deepEqual(prepareResult, expected);
  assert.deepEqual(commitResult, expected);
  assert.doesNotMatch(JSON.stringify([prepareResult, commitResult]), /SQLSTATE|tasks|secret-provider-detail/);
});
