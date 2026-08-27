import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

async function loadModel() {
  const storeContract = await loadTranspiledModule("src/features/planning-items/model/planning-items-store.ts");
  const runner = await loadTranspiledModule("src/features/planning-items/model/planning-items-runner.ts");
  const supabaseStore = await loadTranspiledModule("src/features/planning-items/model/planning-items-store-supabase.ts", {
    "server-only": {},
    "./planning-items-store": storeContract,
  });
  const trashContract = await loadTranspiledModule("src/features/planning/model/planning-trash-contract.ts", {
    "@/lib/platform": { isOperationalLeadRole: (role) => role === "ceo" || role === "deputy" },
  });
  return loadTranspiledModule("src/features/planning-items/model/planning-items-trash.ts", {
    "server-only": {},
    "@/features/planning/model/planning-trash-contract": trashContract,
    "@/features/reviews/model/task-review-state": {
      isReviewStateLocked: (status, final) => status === "requested" && !final || status === "accepted" && Boolean(final),
    },
    "@/lib/planning-github-lifecycle-trigger": {},
    "./planning-items-runner": runner,
    "./planning-items-store-supabase": supabaseStore,
  });
}

const actors = {
  ceo: { profileId: "ceo", platformRole: "ceo", credential: { kind: "session" } },
  founder: { profileId: "founder", platformRole: "founder", credential: { kind: "session" } },
  other: { profileId: "other", platformRole: "founder", credential: { kind: "session" } },
};

function fixture({
  kind = "deliverable",
  actorRole = "ceo",
  task = {},
  parent = { id: "initiative-parent", task_type: "initiative", trashed_at: null },
  affectedTaskIds = [`${kind}-one`, "sub-issue-one"],
  commitError = null,
} = {}) {
  const calls = [];
  const state = {
    task: {
      id: `${kind}-one`, task_type: kind, parent_task_id: kind === "initiative" ? "epic-parent" : "initiative-parent",
      approval_status: "proposed", approval_revision: 2, proposed_by: "founder",
      review_status: "not_requested", score_final: false, trashed_at: null,
      trash_root_type: null, trash_root_id: null, trash_revision: 4,
      ...task,
    },
    parent,
    actorRole,
    affectedTaskIds,
  };
  return {
    calls,
    state,
    client: {
      async rpc(name, params) {
        calls.push([name, params]);
        if (name === "prepare_planning_trash_command") return { data: state, error: null };
        if (commitError) return { data: null, error: commitError };
        const restore = params.p_action === "restore";
        return {
          data: {
            rootType: kind,
            rootId: state.task.id,
            affectedTaskIds,
            trashRevision: params.p_expected_revision,
            item: {
              ...state.task,
              trashed_at: restore ? null : "2026-08-12T15:00:00.000Z",
              trash_root_type: restore ? null : kind,
              trash_root_id: restore ? null : state.task.id,
            },
            eventIds: [],
          },
          error: null,
        };
      },
    },
  };
}



test("Initiative and Deliverable withdraw share preview and atomic commit policy", async () => {
  const model = await loadModel();
  for (const kind of ["initiative", "deliverable"]) {
    const current = fixture({ kind, actorRole: "founder" });
    const command = model.withdrawPlanningItemCommand(`${kind}-one`, { expectedApprovalRevision: 2, reason: "  Nicht mehr relevant.  " });
    const planning = model.createPlanningTrashPlanningItems(current.client, kind);
    const preview = await planning.run({ actor: actors.founder, mode: "preview", command });
    const commit = await planning.run({ actor: actors.founder, mode: "commit", command, requestMetadata: { requestIp: "127.0.0.1", userAgent: "test" } });
    assert.equal(preview.status, "previewed");
    assert.equal(commit.status, "committed");
    assert.deepEqual(commit.effects.map((effect) => [effect.kind, effect.status]), [
      ["activity", "applied"], ["audit", "applied"], ["githubLifecycle", "queued"],
    ]);
    const writes = current.calls.filter(([name]) => name === "mutate_planning_trash_command_transaction");
    assert.equal(writes.length, 1);
    assert.equal(writes[0][1].p_reason, "Nicht mehr relevant.");
    assert.equal(writes[0][1].p_request_ip, "127.0.0.1");
  }
});

test("whole Initiative and Deliverable trees restore through the same durable handoff", async () => {
  const model = await loadModel();
  for (const kind of ["initiative", "deliverable"]) {
    const current = fixture({
      kind,
      task: {
        trashed_at: "2026-08-12T14:00:00.000Z", trash_root_type: kind,
        trash_root_id: `${kind}-one`, trash_revision: 5,
      },
    });
    const command = model.restorePlanningItemCommand(`${kind}-one`, 5);
    const result = await model.createPlanningTrashPlanningItems(current.client, kind).run({ actor: actors.ceo, mode: "commit", command });
    assert.equal(result.status, "committed");
    const transaction = model.planningTrashTransactionFromResult(result);
    assert.deepEqual(transaction.affectedTaskIds, [`${kind}-one`, "sub-issue-one"]);
    assert.equal(transaction.item.trashed_at, null);
    assert.equal(current.calls.filter(([name]) => name === "mutate_planning_trash_command_transaction").length, 1);
  }
});

test("trash actions fail closed before writing across root, role, revision, review, and parent boundaries", async () => {
  const model = await loadModel();
  const withdraw = model.withdrawPlanningItemCommand("deliverable-one", { expectedApprovalRevision: 2, reason: "Reason" });
  const restore = model.restorePlanningItemCommand("deliverable-one", 5);
  const cases = [
    [fixture({ kind: "sub_issue", task: { id: "deliverable-one" } }), "deliverable", withdraw, actors.ceo, "invalidCommand"],
    [fixture({ task: { trashed_at: "now" } }), "deliverable", withdraw, actors.ceo, "conflict"],
    [fixture({ task: { approval_status: "approved" } }), "deliverable", withdraw, actors.ceo, "conflict"],
    [fixture({ task: { approval_revision: 3 } }), "deliverable", withdraw, actors.ceo, "conflict"],
    [fixture({ actorRole: "founder" }), "deliverable", withdraw, actors.other, "forbidden"],
    [fixture({ task: { review_status: "requested" } }), "deliverable", withdraw, actors.ceo, "conflict"],
    [fixture({ actorRole: "founder", task: { trashed_at: "now", trash_root_type: "deliverable", trash_root_id: "deliverable-one", trash_revision: 5 } }), "deliverable", restore, actors.founder, "forbidden"],
    [fixture({ task: { trashed_at: "now", trash_root_type: "deliverable", trash_root_id: "deliverable-one", trash_revision: 4 } }), "deliverable", restore, actors.ceo, "conflict"],
    [fixture({ task: { trashed_at: "now", trash_root_type: "deliverable", trash_root_id: "deliverable-one", trash_revision: 5 }, parent: { id: "initiative-parent", trashed_at: "now" } }), "deliverable", restore, actors.ceo, "conflict"],
  ];
  for (const [current, kind, command, actor, code] of cases) {
    const result = await model.createPlanningTrashPlanningItems(current.client, kind).run({ actor, mode: "commit", command });
    assert.equal(result.error.code, code);
    assert.equal(current.calls.filter(([name]) => name === "mutate_planning_trash_command_transaction").length, 0);
  }
});

test("provider failures never produce a partial PlanningItems receipt", async () => {
  const model = await loadModel();
  const current = fixture({ commitError: { code: "P0001", message: "planning approval revision changed" } });
  const result = await model.createPlanningTrashPlanningItems(current.client, "deliverable").run({
    actor: actors.ceo,
    mode: "commit",
    command: model.withdrawPlanningItemCommand("deliverable-one", { expectedApprovalRevision: 2, reason: "Reason" }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict");
  assert.equal(result.error.reason, "revision");
  assert.equal(Object.hasOwn(result, "changes"), false);
});
