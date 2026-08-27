import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const storeContract = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-store.ts",
);
const memoryAdapter = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-store-memory.ts",
  { "./planning-items-store": storeContract },
);
const supabaseAdapter = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-store-supabase.ts",
  { "server-only": {}, "./planning-items-store": storeContract },
);

const actor = {
  profileId: "profile-1",
  platformRole: "deputy",
  credential: {
    kind: "planningToken",
    tokenId: "token-1",
    scopes: ["write:planning-items:update"],
  },
};

function command(title = "Revised") {
  return {
    kind: "reviseItem",
    itemId: "item-1",
    expectedRevision: "revision-1",
    changes: { itemKind: "deliverable", title },
  };
}

function initialState() {
  return {
    items: [{ id: "item-1", kind: "deliverable", title: "Current", revision: "revision-1" }],
    activities: [],
    audits: [],
    notifications: [],
    projections: [],
  };
}

function createStore(failAfter = "") {
  return memoryAdapter.createInMemoryPlanningItemsStore({
    initialState: initialState(),
    now: () => "2026-08-12T12:00:00.000Z",
    id: ({ prefix, sequence }) => `${prefix}-${sequence}`,
    revision: ({ now, sequence }) => `${now}:${sequence}`,
    prepareState: ({ snapshot, request }) => {
      const item = snapshot.items.find((candidate) => candidate.id === request.command.itemId);
      return item
        ? { kind: "state", state: structuredClone(item) }
        : { kind: "error", error: { code: "notFound", entity: { kind: "deliverable", id: request.command.itemId } } };
    },
    applyCommit: ({ draft, request, sources }) => {
      const item = draft.items.find((candidate) => candidate.id === request.command.itemId);
      if (!item) return { ok: false, error: { code: "notFound", entity: { kind: "deliverable", id: request.command.itemId } } };
      if (request.actor.platformRole === "viewer") {
        return { ok: false, error: { code: "forbidden", reason: "readOnlyRole" } };
      }
      if (request.actor.platformRole === "founder" && request.actor.profileId !== "owner-1") {
        return { ok: false, error: { code: "forbidden", reason: "ownerMismatch" } };
      }
      if (item.revision !== request.command.expectedRevision) {
        return { ok: false, error: { code: "conflict", reason: "revision" } };
      }
      const nextTitle = request.plan.nextTitle;
      item.title = nextTitle;
      item.revision = sources.nextRevision();
      if (failAfter === "item") throw new Error("provider row detail");

      const activityId = sources.nextId("activity");
      draft.activities.push({ id: activityId, itemId: item.id });
      if (failAfter === "activity") throw new Error("provider activity detail");

      const auditId = sources.nextId("audit");
      draft.audits.push({ id: auditId, itemId: item.id });
      if (failAfter === "audit") throw new Error("provider audit detail");

      const notificationId = sources.nextId("notification");
      draft.notifications.push({ id: notificationId, itemId: item.id });
      if (failAfter === "notification") throw new Error("provider notification detail");

      const projectionId = sources.nextId("projection");
      draft.projections.push({ id: projectionId, itemId: item.id });
      if (failAfter === "projection") throw new Error("provider projection detail");

      return {
        ok: true,
        receipt: {
          items: [structuredClone(item)],
          changes: [{ field: "title", before: "Current", after: nextTitle }],
          effects: [
            { kind: "activity", description: activityId, status: "applied" },
            { kind: "audit", description: auditId, status: "applied" },
            { kind: "notification", description: notificationId, status: "queued" },
            { kind: "githubProjection", description: projectionId, status: "queued" },
          ],
          replayed: false,
        },
      };
    },
  });
}

function commitRequest(title = "Revised", key = "key-1") {
  return {
    actor,
    command: command(title),
    plan: { nextTitle: title },
    idempotencyKey: key,
    requestMetadata: { requestIp: "127.0.0.1", userAgent: "adapter-test" },
  };
}

test("in-memory prepare and commit use one semantic store contract", async () => {
  const store = createStore();
  const prepared = await store.prepare({ actor, command: command(), idempotencyKey: "key-1" });
  assert.deepEqual(prepared, {
    kind: "state",
    state: { id: "item-1", kind: "deliverable", title: "Current", revision: "revision-1" },
  });

  const outcome = await store.commit(commitRequest());
  assert.equal(outcome.ok, true);
  assert.equal(outcome.receipt.replayed, false);
  assert.equal(outcome.receipt.items[0].title, "Revised");
  assert.equal(store.inspect().state.activities.length, 1);
  assert.equal(store.inspect().state.audits.length, 1);
  assert.equal(store.inspect().state.notifications.length, 1);
  assert.equal(store.inspect().state.projections.length, 1);
  assert.equal(store.inspect().receiptCount, 1);
});

test("replay is authoritative in prepare and commit and a changed fingerprint conflicts", async () => {
  const store = createStore();
  const first = await store.commit(commitRequest());
  const beforeReplay = store.inspect();
  const preparedReplay = await store.prepare({ actor, command: command(), idempotencyKey: "key-1" });
  const committedReplay = await store.commit(commitRequest());
  const conflict = await store.commit(commitRequest("Different", "key-1"));

  assert.equal(first.ok, true);
  assert.equal(preparedReplay.kind, "replay");
  assert.equal(committedReplay.ok, true);
  assert.equal(committedReplay.receipt.replayed, true);
  assert.deepEqual(committedReplay.receipt.items, first.receipt.items);
  assert.deepEqual(conflict, { ok: false, error: { code: "conflict", reason: "idempotency" } });
  assert.deepEqual(store.inspect(), beforeReplay);
});

test("a stale revision leaves no partial state", async () => {
  const stale = createStore();
  const staleRequest = commitRequest();
  staleRequest.command.expectedRevision = "stale";
  const staleBefore = stale.inspect();
  assert.deepEqual(await stale.commit(staleRequest), {
    ok: false,
    error: { code: "conflict", reason: "revision" },
  });
  assert.deepEqual(stale.inspect(), staleBefore);
});

test.each(["item", "activity", "audit", "notification", "projection"])(
  "a failed %s write leaves no partial state",
  async (step) => {
    const store = createStore(step);
    const before = store.inspect();
    assert.deepEqual(await store.commit(commitRequest()), {
      ok: false,
      error: { code: "dependencyUnavailable", dependency: "database", retryable: true },
    });
    assert.deepEqual(store.inspect(), before);
  },
);

test("authoritative commit revalidation denies viewer and unrelated founder without writes", async () => {
  for (const deniedActor of [
    { ...actor, platformRole: "viewer" },
    { ...actor, profileId: "other-founder", platformRole: "founder" },
  ]) {
    const store = createStore();
    const before = store.inspect();
    const result = await store.commit({ ...commitRequest(), actor: deniedActor });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "forbidden");
    assert.deepEqual(store.inspect(), before);
  }
});

test("Supabase boundary and in-memory adapter return equivalent canonical outcomes", async () => {
  const direct = createStore();
  const rpcState = createStore();
  let commitCalls = 0;
  const supabase = supabaseAdapter.createSupabasePlanningItemsStore({
    async prepareCommand(request) {
      const serialized = structuredClone(request);
      return { data: await rpcState.prepare(serialized), error: null };
    },
    async commitCommand(request) {
      commitCalls += 1;
      const serialized = structuredClone(request);
      return { data: await rpcState.commit(serialized), error: null };
    },
  });

  const request = commitRequest();
  const [directPrepared, supabasePrepared] = await Promise.all([
    direct.prepare({ actor, command: command(), idempotencyKey: "key-1" }),
    supabase.prepare({ actor, command: command(), idempotencyKey: "key-1" }),
  ]);
  assert.deepEqual(supabasePrepared, directPrepared);

  const directOutcome = await direct.commit(request);
  const supabaseOutcome = await supabase.commit(request);
  assert.deepEqual(supabaseOutcome, directOutcome);
  assert.deepEqual(rpcState.inspect(), direct.inspect());
  assert.equal(commitCalls, 1);

  assert.deepEqual(await supabase.commit(request), await direct.commit(request));
  assert.equal(commitCalls, 2, "each Store commit maps to exactly one authoritative RPC operation");
});

test("Supabase provider and SQL details never leave the adapter", async () => {
  const store = supabaseAdapter.createSupabasePlanningItemsStore({
    async prepareCommand() {
      return { data: null, error: { code: "42P01", message: "relation private_table missing" } };
    },
    async commitCommand() {
      throw new Error("SQLSTATE 99999 provider-secret");
    },
  });
  const prepared = await store.prepare({ actor, command: command() });
  const committed = await store.commit(commitRequest());
  const expected = { code: "dependencyUnavailable", dependency: "database", retryable: true };

  assert.deepEqual(prepared, { kind: "error", error: expected });
  assert.deepEqual(committed, { ok: false, error: expected });
  assert.doesNotMatch(JSON.stringify([prepared, committed]), /42P01|private_table|SQLSTATE|provider-secret/);
});

test("Supabase boundary fails closed on incomplete provider payloads", async () => {
  const store = supabaseAdapter.createSupabasePlanningItemsStore({
    async prepareCommand() { return { data: { kind: "state" }, error: null }; },
    async commitCommand() { return { data: { ok: true }, error: null }; },
  });
  const expected = { code: "dependencyUnavailable", dependency: "database", retryable: true };
  assert.deepEqual(await store.prepare({ actor, command: command() }), { kind: "error", error: expected });
  assert.deepEqual(await store.commit(commitRequest()), { ok: false, error: expected });
});
