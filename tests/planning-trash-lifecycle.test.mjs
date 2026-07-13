import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const read = (path) => readFile(path, "utf8");

test("the checked-in schema contains the exact trash workflow migration", async () => {
  const [migration, schema] = await Promise.all([
    read("supabase/0064_planning_trash_workflow.sql"),
    read("supabase/schema.sql"),
  ]);

  assert.equal(schema.includes(migration.trim()), true);
});

test("trash workflow stores fail-closed root coverage for every affected task", async () => {
  const [migration, schema, checks] = await Promise.all([
    read("supabase/0064_planning_trash_workflow.sql"),
    read("supabase/schema.sql"),
    read("src/lib/planning-schema-checks.json"),
  ]);

  for (const sql of [migration, schema]) {
    const outboxTable = sql.slice(
      sql.lastIndexOf("create table if not exists public.planning_github_lifecycle_outbox"),
      sql.lastIndexOf("create index if not exists planning_github_lifecycle_outbox_claim_idx"),
    );
    assert.match(sql, /create table if not exists public\.planning_github_lifecycle_outbox/);
    assert.match(sql, /root_type text not null/);
    assert.match(sql, /root_id text not null/);
    assert.match(sql, /root_trash_revision integer not null/);
    assert.match(outboxTable, /task_id text not null,/);
    assert.doesNotMatch(outboxTable, /task_id text not null references public\.tasks/);
    assert.match(sql, /unique \(\s*root_type, root_id, root_trash_revision, task_id, action\s*\)/);
    assert.match(sql, /status in \('pending', 'processing', 'retry_scheduled', 'completed', 'failed'\)/);
    assert.match(sql, /select\s+p_root_type,\s+p_root_id,\s+v_root_trash_revision,\s+task\.id,[^]*from public\.tasks task[^]*where task\.id = any\(v_task_ids\)/);
    assert.doesNotMatch(
      sql.match(/insert into public\.planning_github_lifecycle_outbox \([^]*?on conflict \(root_type, root_id, root_trash_revision, task_id, action\) do nothing;/)?.[0] || "",
      /github_issue_number[^]*is not null/,
    );
  }

  assert.match(checks, /planning_github_lifecycle_outbox/);
  assert.match(checks, /root_type,root_id,root_trash_revision,task_id/);
});

test("trash and restore are atomic, revision-safe, role-guarded tree transitions", async () => {
  const migration = await read("supabase/0064_planning_trash_workflow.sql");

  assert.match(migration, /create or replace function public\.withdraw_planning_item_transaction/);
  assert.match(migration, /create or replace function public\.restore_planning_item_transaction/);
  assert.match(migration, /approval_status not in \('draft', 'proposed'\)/);
  assert.match(migration, /withdrawal requires proposer or operational lead/);
  assert.match(migration, /only ceo may reject initiative approval/);
  assert.match(migration, /deliverable rejection requires ceo or initiative accountable/);
  assert.match(migration, /trash_revision = v_initiative\.trash_revision/);
  assert.match(migration, /v_root_trash_revision := v_task\.trash_revision \+ 1/);
  assert.match(migration, /trash_revision = v_root_trash_revision/);
  assert.match(migration, /trash_revision = p_expected_trash_revision/);
  assert.match(migration, /approval_status = 'draft'/);
  assert.match(migration, /when task_type = 'deliverable' then 'proposed'/);
  assert.match(migration, /planning items may only be deleted by the lifecycle purge/);
  assert.match(migration, /affectedTaskIds/);
  assert.match(migration, /eventIds/);
  assert.match(migration, /p_request_ip text default null/);
  assert.match(migration, /p_user_agent text default null/);
  assert.match(migration, /for update/);
  assert.match(migration, /or p_expected_revision is null/);
  assert.match(migration, /or p_cause is null/);
  assert.match(migration, /or p_expected_trash_revision is null/);
  assert.match(migration, /select \* into v_initiative[^]*from public\.packages[^]*where id = v_package_id[^]*for share;[^]*select \* into v_root_task[^]*from public\.tasks[^]*where id = p_root_id[^]*for update;/);
  assert.match(migration, /parent initiative must be restored first/);
});

test("GitHub issue references normalize strictly and fail closed in the outbox", async () => {
  const migration = await read("supabase/0064_planning_trash_workflow.sql");

  assert.match(migration, /create or replace function public\.normalize_planning_github_issue_reference/);
  assert.equal(
    migration.includes("^https://github[.]com/([^/?#]+)/([^/?#]+)/issues/([1-9][0-9]*)([?#].*)?$"),
    true,
  );
  assert.match(migration, /github issue urls conflict/);
  assert.match(migration, /github issue url conflicts with the effective issue/);
  assert.match(migration, /github repository is not allowed for this task type/);
  assert.match(migration, /p_task_type = 'deliverable' and v_effective_repo <> 'findmydoc-platform\/management'/);
  assert.match(migration, /cross join lateral public\.normalize_planning_github_issue_reference/);
  assert.match(migration, /case when issue_reference\.reference_status = 'invalid' then 'failed' else 'pending' end/);
  assert.match(migration, /case when issue_reference\.reference_status = 'invalid' then 'invalid_issue_reference' end/);
  assert.match(migration, /revoke all on function public\.normalize_planning_github_issue_reference[^]*from public, anon, authenticated/);
});

test("approval rejection keeps the 0061 decision rules while moving the tree to trash", async () => {
  const migration = await read("supabase/0064_planning_trash_workflow.sql");

  assert.match(migration, /p_action in \('reject', 'return_to_draft'\) and v_note is null/);
  assert.match(migration, /char_length\(v_note\) > 2000/);
  assert.match(migration, /v_initiative\.approval_status <> 'proposed'/);
  assert.match(migration, /v_task\.approval_status <> 'proposed'/);
  assert.match(migration, /v_actor_role not in \('ceo', 'deputy'\)/);
  assert.match(migration, /v_initiative\.accountable_profile_id/);
  assert.match(migration, /return v_trash_result->'item'/);
  assert.match(migration, /'initiative\.approval_reject'/);
  assert.match(migration, /'task\.approval_reject'/);
  assert.match(migration, /'planning_item\.rejected'/);
  assert.match(migration, /planning-item-rejected:initiative/);
  assert.match(migration, /planning-item-rejected:task/);
  assert.match(migration, /v_notification_recipient_id := v_initiative\.proposed_by/);
  assert.match(migration, /v_notification_recipient_id := v_task\.proposed_by/);
});

test("outbox claiming is ordered, leased, retryable, and service-role only", async () => {
  const [migration, verification] = await Promise.all([
    read("supabase/0064_planning_trash_workflow.sql"),
    read("scripts/verify-supabase.mjs"),
  ]);

  assert.match(migration, /create or replace function public\.claim_planning_github_lifecycle_jobs/);
  assert.match(migration, /create or replace function public\.claim_planning_github_lifecycle_jobs_for_root/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /predecessor\.status <> 'completed'/);
  assert.match(migration, /job\.status in \('pending', 'retry_scheduled'\)/);
  assert.match(migration, /when attempts >= 5 then 'failed'/);
  assert.match(migration, /else 'retry_scheduled'/);
  assert.match(migration, /job\.root_type = p_root_type\s+and job\.root_id = p_root_id\s+and job\.task_id = any\(p_task_ids\)/);
  assert.match(migration, /p_task_ids is null\s+or cardinality\(p_task_ids\) < 1/);
  assert.match(migration, /revoke all on function public\.claim_planning_github_lifecycle_jobs[^]*from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.claim_planning_github_lifecycle_jobs_for_root[^]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.claim_planning_github_lifecycle_jobs_for_root[^]*to service_role/);
  assert.match(migration, /grant execute on function public\.finalize_planning_github_lifecycle_job[^]*to service_role/);
  assert.match(verification, /verifyPlanningTrashLifecycleRpcs/);
  assert.match(verification, /p_limit: 0/);
});

test("approval reopen uses the latest close event and its stored canonical target", async () => {
  const migration = await read("supabase/0064_planning_trash_workflow.sql");
  const reopenInsert = migration.match(/if p_action = 'approve' then\s+insert into public\.planning_github_lifecycle_outbox \([^]*?on conflict \(root_type, root_id, root_trash_revision, task_id, action\) do nothing;/)?.[0] || "";

  assert.match(reopenInsert, /prior\.github_repo/);
  assert.match(reopenInsert, /prior\.github_issue_number/);
  assert.match(reopenInsert, /select\s+'deliverable',\s+p_task_id,\s+v_task\.trash_revision,/);
  assert.match(reopenInsert, /order by closed\.created_at desc, closed\.id desc/);
  assert.doesNotMatch(reopenInsert, /order by closed\.root_trash_revision desc/);
  assert.doesNotMatch(reopenInsert, /linked\.github_repo|linked\.github_issue_number/);
});

test("rejection notifications use the personal Google Chat delivery path", async () => {
  const catalog = await loadTranspiledModule("src/lib/notification-catalog.ts");
  const definition = catalog.notificationDefinition("planning_item.rejected");
  assert.equal(definition.lifecycle, "informational");
  assert.equal(catalog.shouldSendToGoogleChatDigest("planning_item.rejected"), true);
  assert.equal(catalog.shouldSendToGoogleChatDm("planning_item.rejected"), true);
});

test("GitHub lifecycle worker completes issue-less coverage without requesting a token", async () => {
  let tokenRequests = 0;
  let githubCalls = 0;
  const finalized = [];
  const worker = await loadTranspiledModule("src/lib/planning-github-lifecycle.ts", {
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

test("GitHub lifecycle helpers preserve issue metadata and use durable comment markers", async () => {
  const lifecycleGithub = await read("src/lib/planning-github-lifecycle-github.ts");
  assert.match(lifecycleGithub, /planningGitHubLifecycleCommentMarker/);
  assert.match(lifecycleGithub, /founderops-planning-lifecycle:/);
  assert.match(lifecycleGithub, /body: \{ state: "closed", state_reason: "not_planned" \}/);
  assert.match(lifecycleGithub, /body: \{ state: "open" \}/);
  assert.match(lifecycleGithub, /comments\.find\(\(item\) => item\.body\?\.includes\(markerToken\)\)/);
  assert.doesNotMatch(lifecycleGithub, /labels:/);
  assert.doesNotMatch(lifecycleGithub, /removeGitHubIssueBlockedBy|connectGitHubSubIssue/);
});
