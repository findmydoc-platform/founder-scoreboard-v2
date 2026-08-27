import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";


test("rejection notifications use the personal Google Chat delivery path", async () => {
  const catalog = await importTestModule("src/lib/notification-catalog.ts");
  const definition = catalog.notificationDefinition("planning_item.rejected");
  assert.equal(definition.lifecycle, "informational");
  assert.equal(catalog.shouldSendToGoogleChatDigest("planning_item.rejected"), true);
  assert.equal(catalog.shouldSendToGoogleChatDm("planning_item.rejected"), true);
});

test("GitHub lifecycle worker completes issue-less coverage without requesting a token", async () => {
  let tokenRequests = 0;
  let githubCalls = 0;
  const finalized = [];
  const worker = await importTestModule("src/lib/planning-github-lifecycle.ts", {
    "server-only": {},
    "./github-app": {
      getGitHubAppInstallationToken: async () => {
        tokenRequests += 1;
        return "token";
      },
    },
    "./planning-github-lifecycle-github": {
      closeGitHubIssueNotPlanned: async () => { githubCalls += 1; },
      reopenGitHubIssueForPlanning: async () => { githubCalls += 1; },
    },
  });
  const supabase = {
    rpc: async (name, params) => {
      if (name === "claim_planning_github_lifecycle_jobs") {
        return {
          data: [{
            id: "job-1",
            root_type: "deliverable",
            root_id: "task-1",
            root_trash_revision: 2,
            task_id: "task-1",
            github_repo: null,
            github_issue_number: null,
            action: "close_not_planned",
            source_type: "withdrawn",
            source_revision: 2,
            reason: "No longer needed",
            status: "processing",
            status_reason: null,
            attempts: 1,
          }],
          error: null,
        };
      }
      finalized.push(params);
      return { data: { status: "completed" }, error: null };
    },
  };

  const summary = await worker.drainPlanningGitHubLifecycleJobs({ supabase });
  assert.deepEqual(summary, { claimed: 1, completed: 1, retryScheduled: 0, failed: 0, errors: [] });
  assert.equal(tokenRequests, 0);
  assert.equal(githubCalls, 0);
  assert.equal(finalized[0].p_status_reason, "issue_missing");
});
