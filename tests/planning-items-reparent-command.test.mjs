import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

async function loadModel() {
  const storeContract = await loadTranspiledModule("src/features/planning-items/model/planning-items-store.ts");
  const runner = await loadTranspiledModule("src/features/planning-items/model/planning-items-runner.ts");
  const supabaseStore = await loadTranspiledModule("src/features/planning-items/model/planning-items-store-supabase.ts", {
    "server-only": {},
    "./planning-items-store": storeContract,
  });
  return loadTranspiledModule("src/features/planning-items/model/planning-items-reparent.ts", {
    "server-only": {},
    "@/lib/planning-task-mappers": { mapTaskRow: (row) => ({
      id: row.id,
      title: row.title || "Planning item",
      taskType: row.task_type,
      parentTaskId: row.parent_task_id || "",
      ownerId: row.owner || "",
      owner: row.owner || "",
      assigneeId: row.assignee || "",
      assignee: row.assignee || "",
      approvalStatus: row.approval_status ?? null,
      approvalRevision: Number(row.approval_revision || 1),
      parentApprovalStatus: null,
      reviewStatus: row.review_status || "not_requested",
      scoreFinal: Boolean(row.score_final),
      scorePoints: Number(row.score_points || 0),
      sprintId: row.sprint_id || "",
      githubIssueSyncStatus: row.github_issue_sync_status || "not_synced",
      githubIssueSyncError: row.github_issue_sync_error || "",
      updatedAt: row.updated_at || "",
    }) },
    "./planning-items-runner": runner,
    "./planning-items-store-supabase": supabaseStore,
  });
}

const ceo = { profileId: "ceo", platformRole: "ceo", credential: { kind: "session" } };
const founder = { profileId: "founder", platformRole: "founder", credential: { kind: "session" } };

function fixture({
  kind = "deliverable",
  parentKind = kind === "initiative" ? "epic" : kind === "deliverable" ? "initiative" : "deliverable",
  parentApproval = kind === "sub_issue" ? "approved" : "approved",
  actorRole = "ceo",
  task = {},
  parent = {},
  oldParent = {},
  commitError = null,
} = {}) {
  const calls = [];
  const state = {
    task: {
      id: `${kind}-one`, task_type: kind, title: "Planning item", parent_task_id: "parent-old",
      updated_at: "2026-08-12T10:00:00.000Z", owner: "founder", assignee: "founder",
      approval_status: kind === "sub_issue" ? null : "approved", approval_revision: 2,
      review_status: "not_requested", score_final: false, trashed_at: null,
      github_issue_sync_status: "synced", ...task,
    },
    parent: {
      id: "parent-new", task_type: parentKind, updated_at: "2026-08-12T09:00:00.000Z",
      approval_status: parentApproval, review_status: "not_requested", score_final: false, trashed_at: null,
      ...parent,
    },
    oldParent: {
      id: "parent-old", task_type: parentKind, updated_at: "2026-08-12T08:00:00.000Z",
      approval_status: parentApproval, review_status: "not_requested", score_final: false, trashed_at: null,
      ...oldParent,
    },
    actor: { id: actorRole === "founder" ? "founder" : "ceo", name: actorRole === "founder" ? "Founder" : "CEO", role: actorRole },
    profiles: [{ id: "founder", name: "Founder" }],
    strategy: null,
    raciAssignments: [],
    requestedParentId: "parent-new",
  };
  return {
    calls,
    client: {
      async rpc(name, params) {
        calls.push([name, params]);
        if (name === "prepare_planning_reparent_command") return { data: state, error: null };
        if (commitError) return { data: null, error: commitError };
        const row = { ...state.task, parent_task_id: params.p_parent_task_id, updated_at: "2026-08-12T11:00:00.000Z", github_issue_sync_status: "not_synced" };
        return name === "mutate_team_planning_reparent_command_transaction"
          ? { data: { replayed: false, itemType: kind, item: row }, error: null }
          : { data: { task: row }, error: null };
      },
    },
  };
}

test("browser and Team parent routes delegate exclusively to the PlanningItems action", async () => {
  const [taskRoute, teamRoute, module, migration] = await Promise.all([
    readFile("src/features/planning-items/model/planning-items-browser-task-update.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-team-update-route.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-reparent.ts", "utf8"),
    readFile("supabase/migrations/20260812142454_planning_reparent_command_transaction.sql", "utf8"),
  ]);
  for (const route of [taskRoute, teamRoute]) assert.match(route, /createPlanningReparentPlanningItems/);
  assert.doesNotMatch(taskRoute, /reparent_planning_item_transaction/);
  assert.match(taskRoute, /patch\.parent_task_id/);
  assert.match(module, /mutate_planning_reparent_command_transaction/);
  assert.match(module, /mutate_team_planning_reparent_command_transaction/);
  assert.match(migration, /public\.reparent_planning_item_transaction/);
  assert.match(migration, /'commandKind', 'changeParent'/);
  assert.match(migration, /grant execute on function public\.mutate_team_planning_reparent_command_transaction[\s\S]*to service_role/);
});

test("Initiative, Deliverable, and Sub-Issue share preview and commit policy", async () => {
  const model = await loadModel();
  for (const kind of ["initiative", "deliverable", "sub_issue"]) {
    const current = fixture({ kind });
    const command = model.changePlanningParentCommand(`${kind}-one`, "parent-new", "2026-08-12T10:00:00.000Z");
    const planning = model.createPlanningReparentPlanningItems(current.client, kind);
    const preview = await planning.run({ actor: ceo, mode: "preview", command });
    const commit = await planning.run({ actor: ceo, mode: "commit", command });
    assert.equal(preview.status, "previewed");
    assert.equal(commit.status, "committed");
    assert.equal(model.planningReparentTaskFromResult(commit).parentTaskId, "parent-new");
    assert.equal(current.calls.filter(([name]) => name === "mutate_planning_reparent_command_transaction").length, 1);
  }
});

test("reparenting fails closed for role, type, approval, trash, review, and revisions", async () => {
  const model = await loadModel();
  const command = (kind = "deliverable") => model.changePlanningParentCommand(`${kind}-one`, "parent-new", "2026-08-12T10:00:00.000Z");
  const cases = [
    [fixture({ kind: "deliverable", actorRole: "founder" }), command(), founder, "forbidden"],
    [fixture({ kind: "deliverable", task: { trashed_at: "2026-08-12T09:00:00.000Z" } }), command(), ceo, "conflict"],
    [fixture({ kind: "deliverable", task: { review_status: "requested" } }), command(), ceo, "conflict"],
    [fixture({ kind: "sub_issue", parentApproval: "proposed" }), command("sub_issue"), ceo, "conflict"],
    [fixture({ kind: "deliverable", parentApproval: "rejected" }), command(), ceo, "conflict"],
    [fixture({ kind: "deliverable", parentKind: "epic" }), command(), ceo, "invalidCommand"],
    [fixture({ kind: "deliverable" }), model.changePlanningParentCommand("deliverable-one", "parent-new", "2026-08-12T00:00:00.000Z"), ceo, "conflict"],
  ];
  for (const [current, currentCommand, actor, code] of cases) {
    const result = await model.createPlanningReparentPlanningItems(current.client, "any").run({ actor, mode: "commit", command: currentCommand });
    assert.equal(result.error.code, code);
    assert.equal(current.calls.filter(([name]) => name.startsWith("mutate_")).length, 0);
  }
});

test("stale referenced parent is a stable conflict and Team commits use one idempotent writer", async () => {
  const model = await loadModel();
  const stale = fixture({ commitError: { code: "P0012", message: "planning item parent changed concurrently" } });
  const command = model.changePlanningParentCommand("deliverable-one", "parent-new", "2026-08-12T10:00:00.000Z");
  const staleResult = await model.createPlanningReparentPlanningItems(stale.client, "deliverable").run({ actor: ceo, mode: "commit", command });
  assert.equal(staleResult.error.code, "conflict");
  assert.equal(staleResult.error.details.planningReparentReason, "parentRevision");

  const team = fixture();
  const tokenActor = { profileId: "ceo", platformRole: "ceo", credential: { kind: "planningToken", tokenId: "token-one", scopes: ["write:planning-items:update"] } };
  const committed = await model.createPlanningReparentPlanningItems(team.client, "any").run({
    actor: tokenActor, mode: "commit", command, idempotencyKey: "00000000-0000-4000-8000-000000000305",
  });
  assert.equal(committed.status, "committed");
  const call = team.calls.find(([name]) => name === "mutate_team_planning_reparent_command_transaction");
  assert.equal(call[1].p_changed_field, "parentTaskId");
  assert.match(call[1].p_request_hash, /^[a-f0-9]{64}$/);
});
