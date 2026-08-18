import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const finalized = [];
let executionResult = {
  status: "synced",
  code: "github_sync_succeeded",
  issue: {
    repository: "findmydoc-platform/management",
    number: 42,
    url: "https://github.com/findmydoc-platform/management/issues/42",
    recovered: false,
    recreated: false,
  },
  warnings: [],
};

const projection = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-github-projection.ts",
  {
    "server-only": {},
    "@/features/planning-items/model/planning-items-github-sync": {
      executePlanningItemGitHubSyncs: async ({ targets }) => new Map(
        targets.map((target) => [target.itemId, executionResult]),
      ),
    },
  },
);

function claimedRequest(overrides = {}) {
  return {
    id: "request-1",
    planning_operation_id: "team-update:token:key",
    task_id: "task-1",
    actor_profile_id: "profile-1",
    create_if_missing: true,
    status: "processing",
    result: null,
    ...overrides,
  };
}

test("dispatcher claims and finalizes the durable request instead of bypassing the queue", async () => {
  finalized.length = 0;
  executionResult = { ...executionResult, status: "synced" };
  const calls = [];
  const supabase = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      if (name === "claim_planning_github_projection_requests") {
        return { data: [claimedRequest()], error: null };
      }
      if (name === "finalize_planning_github_projection_request") {
        finalized.push(params);
        return { data: { ...claimedRequest(), status: "completed" }, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };

  const result = await projection.dispatchPlanningGitHubProjections({
    supabase,
    operationId: "team-update:token:key",
  });

  assert.equal(calls[0].name, "claim_planning_github_projection_requests");
  assert.equal(calls[0].params.p_operation_id, "team-update:token:key");
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].p_succeeded, true);
  assert.equal(result.results.get("task-1").status, "synced");
  assert.equal(result.completed, 1);
});

test("GitHub failure is finalized as retryable without changing the Planning commit", async () => {
  executionResult = {
    status: "failed",
    code: "github_sync_unavailable",
    error: "GitHub unavailable",
    retryable: true,
  };
  const calls = [];
  const supabase = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      if (name === "claim_planning_github_projection_requests") {
        return { data: [claimedRequest()], error: null };
      }
      return { data: { ...claimedRequest(), status: "retry_scheduled" }, error: null };
    },
  };

  const result = await projection.dispatchPlanningGitHubProjections({ supabase });
  const finalize = calls.find((call) => call.name === "finalize_planning_github_projection_request");
  assert.equal(finalize.params.p_succeeded, false);
  assert.equal(finalize.params.p_result.status, "failed");
  assert.equal(result.retryScheduled, 1);
});

test("dispatcher reports a failed finalization instead of claiming completion", async () => {
  executionResult = { ...executionResult, status: "synced" };
  const supabase = {
    rpc: async (name) => {
      if (name === "claim_planning_github_projection_requests") {
        return { data: [claimedRequest()], error: null };
      }
      if (name === "finalize_planning_github_projection_request") {
        return { data: null, error: new Error("finalization unavailable") };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
  };

  const result = await projection.dispatchPlanningGitHubProjections({ supabase });

  assert.equal(result.claimed, 1);
  assert.equal(result.completed, 0);
  assert.equal(result.retryScheduled, 0);
  assert.equal(result.failed, 1);
});

test("schema makes enqueue idempotent and orders reconcile with lifecycle delivery", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260812183500_durable_planning_github_projection.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /unique \(planning_operation_id, task_id\)/);
  assert.match(migration, /if not coalesce\(\(v_result->>'replayed'\)::boolean, false\)/);
  assert.match(migration, /planning_github_lifecycle_outbox predecessor[^]*delivery_sequence < request\.delivery_sequence/);
  assert.match(migration, /planning_github_projection_outbox predecessor[^]*delivery_sequence < job\.delivery_sequence/);
  assert.match(migration, /update public\.team_task_intake_batches[^]*response_tasks = v_items/);
  assert.match(migration, /update public\.team_planning_item_update_requests[^]*set response = v_result/);
});

test("all public Team sync paths use durable dispatch and never call projection directly", async () => {
  const files = await Promise.all([
    "src/features/planning-items/model/planning-items-team-create-route.ts",
    "src/features/planning-items/model/planning-items-team-update-route.ts",
    "src/features/planning-items/model/planning-items-team-github-sync-route.ts",
  ].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));
  for (const source of files) {
    assert.match(source, /dispatchAndLoadPlanningGitHubProjections/);
    assert.doesNotMatch(source, /executePlanningItemGitHubSyncs|preflightPlanningItemGitHubSync/);
  }
});
