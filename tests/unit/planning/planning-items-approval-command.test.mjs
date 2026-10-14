import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

async function loadModel() {
  const storeContract = await importTestModule("src/features/planning-items/model/planning-items-store.ts");
  const runner = await importTestModule("src/features/planning-items/model/planning-items-runner.ts");
  const supabaseStore = await importTestModule("src/features/planning-items/model/planning-items-store-supabase.ts", {
    "server-only": {},
    "./planning-items-store": storeContract,
  });
  const approvalPolicy = await importTestModule("src/lib/approval-decision-policy.ts");
  return importTestModule("src/features/planning-items/model/planning-items-approval.ts", {
    "server-only": {},
    "@/lib/approval-decision-policy": approvalPolicy,
    "@/lib/planning-task-mappers": { mapTaskRow: (row) => ({
      id: row.id,
      title: row.title,
      approvalStatus: row.approval_status,
      approvalRevision: row.approval_revision,
      ownerId: row.owner || "",
      owner: row.owner || "",
      assigneeId: row.assignee || "",
      assignee: row.assignee || "",
      createdById: row.created_by || "",
      createdBy: row.created_by || "",
      reviewStatus: row.review_status || "not_requested",
      reviewRequestedAt: row.review_requested_at || "",
      scorePoints: row.score_points || 0,
      scoreFinal: Boolean(row.score_final),
      sprintId: row.sprint_id || "",
      githubIssueSyncStatus: row.github_issue_sync_status || "not_synced",
    }) },
    "@/lib/planning-github-lifecycle-trigger": {},
    "./planning-items-runner": runner,
    "./planning-items-store-supabase": supabaseStore,
  });
}

const actor = { profileId: "ceo", platformRole: "ceo", credential: { kind: "session" } };

function fixture(overrides = {}) {
  const calls = [];
  const task = {
    id: "initiative-one", title: "Initiative", task_type: "initiative", approval_status: "proposed",
    approval_revision: 2, parent_task_id: "epic-one", owner: "owner", assignee: "owner", trashed_at: null,
    review_status: "not_requested", score_final: false,
  };
  const state = {
    task,
    parent: { id: "epic-one", task_type: "epic", approval_status: null, trashed_at: null },
    actorRole: "ceo",
    accountableCount: 1,
    responsibleCount: 1,
    profiles: [{ id: "owner", name: "Owner" }],
    strategy: null,
    raciAssignments: [],
    ...overrides,
  };
  return {
    calls,
    client: {
      async rpc(name, params) {
        calls.push([name, params]);
        if (name === "prepare_planning_approval_command") return { data: state, error: null };
        return { data: { task: { ...state.task, approval_status: params.p_action === "approve" ? "approved" : params.p_action === "reject" ? "rejected" : "draft", approval_revision: 3 } }, error: null };
      },
    },
  };
}



test("initiative approval shares Preview and Commit policy with one writer", async () => {
  const model = await loadModel();
  const current = fixture();
  const command = model.decidePlanningApprovalCommand("initiative-one", { expectedApprovalRevision: 2, action: "approve", note: "" });
  const planning = model.createPlanningApprovalPlanningItems(current.client, "initiative");
  const preview = await planning.run({ actor, mode: "preview", command });
  const commit = await planning.run({ actor, mode: "commit", command });
  assert.equal(preview.status, "previewed");
  assert.equal(commit.status, "committed");
  assert.deepEqual(preview.effects.map((effect) => effect.kind), ["activity", "audit"]);
  assert.equal(current.calls.filter(([name]) => name === "mutate_planning_approval_command_transaction").length, 1);
});

test("approval fails closed for role revision parent RACI review and note boundaries", async () => {
  const model = await loadModel();
  const command = model.decidePlanningApprovalCommand("initiative-one", { expectedApprovalRevision: 2, action: "approve", note: "" });
  const cases = [
    [fixture({ actorRole: "founder" }), command, "forbidden"],
    [fixture(), model.decidePlanningApprovalCommand("initiative-one", { expectedApprovalRevision: 1, action: "approve", note: "" }), "conflict"],
    [fixture({ accountableCount: 0 }), command, "conflict"],
    [fixture({ parent: null }), command, "conflict"],
    [fixture({ task: { id: "initiative-one", title: "Initiative", task_type: "initiative", approval_status: "approved", approval_revision: 2, parent_task_id: "epic-one", owner: "owner", assignee: "owner", trashed_at: null, review_status: "not_requested", score_final: false } }), command, "conflict"],
  ];
  for (const [current, currentCommand, code] of cases) {
    const result = await model.createPlanningApprovalPlanningItems(current.client, "initiative").run({ actor, mode: "commit", command: currentCommand });
    assert.equal(result.error.code, code);
    assert.equal(current.calls.filter(([name]) => name === "mutate_planning_approval_command_transaction").length, 0);
  }
  const deliverable = fixture({
    task: { id: "deliverable-one", title: "Deliverable", task_type: "deliverable", approval_status: "proposed", approval_revision: 1, parent_task_id: "initiative-parent", review_status: "requested", score_final: false },
    parent: { id: "initiative-parent", task_type: "initiative", approval_status: "approved", trashed_at: null },
  });
  const locked = await model.createPlanningApprovalPlanningItems(deliverable.client, "deliverable").run({
    actor, mode: "commit", command: model.decidePlanningApprovalCommand("deliverable-one", { expectedApprovalRevision: 1, action: "approve", note: "" }),
  });
  assert.equal(locked.error.code, "conflict");
  const deliverableReady = fixture({
    task: { id: "deliverable-one", title: "Deliverable", task_type: "deliverable", approval_status: "proposed", approval_revision: 1, parent_task_id: "initiative-parent", review_status: "not_requested", score_final: false },
    parent: { id: "initiative-parent", task_type: "initiative", approval_status: "approved", trashed_at: null },
  });
  const deliverableCommit = await model.createPlanningApprovalPlanningItems(deliverableReady.client, "deliverable").run({
    actor, mode: "commit", command: model.decidePlanningApprovalCommand("deliverable-one", { expectedApprovalRevision: 1, action: "approve", note: "" }),
  });
  assert.deepEqual(deliverableCommit.effects.map((effect) => [effect.kind, effect.status]), [
    ["activity", "applied"],
    ["audit", "applied"],
    ["githubLifecycle", "queued"],
  ]);
  const missingNote = await model.createPlanningApprovalPlanningItems(fixture().client, "initiative").run({
    actor, mode: "commit", command: model.decidePlanningApprovalCommand("initiative-one", { expectedApprovalRevision: 2, action: "reject", note: "" }),
  });
  assert.equal(missingNote.error.code, "invalidCommand");
});
