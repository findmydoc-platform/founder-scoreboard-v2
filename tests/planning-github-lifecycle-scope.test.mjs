import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

test("immediate lifecycle drains claim only the caller-provided root task set", async () => {
  const calls = [];
  const worker = await loadTranspiledModule("src/lib/planning-github-lifecycle.ts", {
    "server-only": {},
    "./github-app": { getGitHubAppInstallationToken: async () => "token" },
    "./planning-github-lifecycle-github": {
      closeGitHubIssueNotPlanned: async () => {},
      reopenGitHubIssueForPlanning: async () => {},
    },
  });
  const supabase = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      return { data: [], error: null };
    },
  };

  const summary = await worker.drainPlanningGitHubLifecycleJobs({
    supabase,
    limit: 100,
    scope: {
      rootType: "deliverable",
      rootId: "deliverable-1",
      taskIds: ["deliverable-1", "child-1", "deliverable-1", ""],
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "claim_planning_github_lifecycle_jobs_for_root");
  assert.deepEqual(calls[0].params.p_task_ids, ["deliverable-1", "child-1"]);
  assert.equal(calls[0].params.p_root_type, "deliverable");
  assert.equal(calls[0].params.p_root_id, "deliverable-1");
  assert.equal(summary.claimed, 0);
});

test("maintenance lifecycle drains retain the global claim contract", async () => {
  const calls = [];
  const worker = await loadTranspiledModule("src/lib/planning-github-lifecycle.ts", {
    "server-only": {},
    "./github-app": { getGitHubAppInstallationToken: async () => "token" },
    "./planning-github-lifecycle-github": {
      closeGitHubIssueNotPlanned: async () => {},
      reopenGitHubIssueForPlanning: async () => {},
    },
  });
  await worker.drainPlanningGitHubLifecycleJobs({
    supabase: {
      rpc: async (name, params) => {
        calls.push({ name, params });
        return { data: [], error: null };
      },
    },
  });
  assert.equal(calls[0].name, "claim_planning_github_lifecycle_jobs");
  assert.equal(calls[0].params.p_task_ids, undefined);
});

test("immediate lifecycle completion remains false while scoped jobs are outstanding", async () => {
  const trigger = await loadTranspiledModule("src/lib/planning-github-lifecycle-trigger.ts", {
    "server-only": {},
    "@/lib/planning-github-lifecycle": {
      drainPlanningGitHubLifecycleJobs: async () => ({
        claimed: 1,
        completed: 1,
        retryScheduled: 0,
        failed: 0,
        errors: [],
      }),
    },
  });

  function supabaseWithOutstandingJobs(rows) {
    const query = {
      select: () => query,
      eq: () => query,
      in: () => query,
      limit: async () => ({ data: rows, error: null }),
    };
    return { from: () => query };
  }

  const pending = await trigger.attemptPlanningGitHubLifecycleDrain({
    rootType: "deliverable",
    rootId: "deliverable-1",
    taskIds: ["deliverable-1"],
    supabase: supabaseWithOutstandingJobs([{ id: "reopen-job" }]),
  });
  assert.equal(pending.attempted, true);
  assert.equal(pending.completed, false);

  const complete = await trigger.attemptPlanningGitHubLifecycleDrain({
    rootType: "deliverable",
    rootId: "deliverable-1",
    taskIds: ["deliverable-1"],
    supabase: supabaseWithOutstandingJobs([]),
  });
  assert.equal(complete.completed, true);
});
