import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createSupabaseScriptClient } from "./lib/supabase.mjs";

const supabase = await createSupabaseScriptClient();
const anonSupabase = await createSupabaseScriptClient({
  keyEnv: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  missingMessage: "Missing Supabase anon env. Set NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
});

async function count(table) {
  const { count: rowCount, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return rowCount ?? 0;
}

const schemaCheckConfig = JSON.parse(
  await readFile(new URL("../src/lib/planning-schema-checks.json", import.meta.url), "utf8"),
);
const schemaChecks = schemaCheckConfig.map((check) => ({
  name: check.name,
  table: check.table,
  select: check.verifySelect || check.select || check.healthSelect || "id",
}));

async function checkSchema(check) {
  const { error } = await supabase.from(check.table).select(check.select).limit(1);
  return {
    name: check.name,
    ok: !error,
    error: error?.message || "",
  };
}

async function verifyGitHubSyncLockRpc() {
  const resourceKey = `verify:github-sync-lock:${Date.now()}`;
  const acquire = await supabase.rpc("try_acquire_github_issue_sync_lock", {
    p_resource_key: resourceKey,
    p_task_id: null,
    p_locked_by_profile_id: null,
    p_ttl_seconds: 60,
  });
  if (acquire.error || !acquire.data) {
    return {
      ok: false,
      error: acquire.error?.message || "try_acquire_github_issue_sync_lock returned no lock token",
    };
  }

  const secondAcquire = await supabase.rpc("try_acquire_github_issue_sync_lock", {
    p_resource_key: resourceKey,
    p_task_id: null,
    p_locked_by_profile_id: null,
    p_ttl_seconds: 60,
  });
  if (secondAcquire.error) return { ok: false, error: secondAcquire.error.message };
  if (secondAcquire.data) {
    await supabase.rpc("release_github_issue_sync_lock", {
      p_resource_key: resourceKey,
      p_lock_token: secondAcquire.data,
    });
    return { ok: false, error: "active lock was acquired twice" };
  }

  const release = await supabase.rpc("release_github_issue_sync_lock", {
    p_resource_key: resourceKey,
    p_lock_token: acquire.data,
  });
  if (release.error || release.data !== true) {
    return {
      ok: false,
      error: release.error?.message || "release_github_issue_sync_lock did not release the lock",
    };
  }

  return { ok: true, error: "" };
}

async function verifyProfileWriteRpcs() {
  const missingProfileId = `verify-missing-profile-${Date.now()}`;
  const checks = [
    {
      name: "update_profile_admin_transaction",
      params: {
        p_profile_id: missingProfileId,
        p_actor_profile_id: missingProfileId,
        p_profile_patch: {},
        p_notification_events: {},
        p_request_ip: null,
        p_user_agent: null,
      },
    },
    {
      name: "update_profile_settings_transaction",
      params: {
        p_profile_id: missingProfileId,
        p_profile_patch: {},
        p_ui_preferences: null,
        p_notification_events: {},
        p_request_ip: null,
        p_user_agent: null,
      },
    },
  ];

  const results = await Promise.all(checks.map(async (check) => {
    const { error } = await supabase.rpc(check.name, check.params);
    return {
      name: check.name,
      ok: error?.code === "P0002",
      error: error?.code === "P0002" ? "" : error?.message || "RPC unexpectedly accepted a missing profile",
    };
  }));

  return results;
}

async function verifyTaskUpdateRpc() {
  const { error } = await supabase.rpc("update_task_transaction", {
    p_task_id: `verify-missing-task-${Date.now()}`,
    p_expected_updated_at: new Date().toISOString(),
    p_task_patch: {},
    p_note_present: false,
    p_note: null,
    p_dependency_present: false,
    p_dependency_note: null,
    p_activity_messages: [],
    p_notifications: [],
  });

  return {
    ok: error?.code === "P0002",
    error: error?.code === "P0002" ? "" : error?.message || "update_task_transaction unexpectedly accepted a missing task",
  };
}

async function verifyTaskDeletionRpcs() {
  const missingTaskId = `verify-missing-task-deletion-${Date.now()}`;
  const prepare = await supabase.rpc("prepare_task_deletion_transaction", {
    p_task_id: missingTaskId,
    p_expected_updated_at: new Date().toISOString(),
    p_actor_profile_id: null,
    p_request_ip: null,
    p_user_agent: null,
  });
  const finalize = await supabase.rpc("finalize_task_deletion_transaction", {
    p_operation_id: randomUUID(),
    p_github_closed: false,
  });
  const cancel = await supabase.rpc("cancel_task_deletion_transaction", {
    p_operation_id: randomUUID(),
  });

  return [
    {
      name: "prepare_task_deletion_transaction",
      ok: prepare.error?.code === "P0002",
      error: prepare.error?.code === "P0002" ? "" : prepare.error?.message || "RPC unexpectedly accepted a missing task",
    },
    {
      name: "finalize_task_deletion_transaction",
      ok: finalize.error?.code === "P0002",
      error: finalize.error?.code === "P0002" ? "" : finalize.error?.message || "RPC unexpectedly accepted a missing operation",
    },
    {
      name: "cancel_task_deletion_transaction",
      ok: !cancel.error && cancel.data?.cancelled === true,
      error: cancel.error?.message || (cancel.data?.cancelled === true ? "" : "RPC did not idempotently cancel a missing operation"),
    },
  ];
}

async function verifyTaskCreationAndGitHubSyncRpcs() {
  const missingTaskId = `verify-missing-task-create-sync-${Date.now()}`;
  const create = await supabase.rpc("create_task_transaction", {
    p_task_insert: {},
    p_relation_type: null,
    p_related_task_id: null,
    p_relation_note: null,
    p_activity_message: "verification",
    p_relation_activity_message: null,
    p_notifications: [],
    p_actor_profile_id: null,
    p_request_ip: null,
    p_user_agent: null,
  });
  const begin = await supabase.rpc("begin_github_issue_sync_transaction", { p_task_id: missingTaskId });
  const finalize = await supabase.rpc("finalize_github_issue_sync_transaction", {
    p_task_id: missingTaskId,
    p_github_repo: "findmydoc-platform/management",
    p_github_issue_number: 1,
    p_github_issue_url: "https://github.com/findmydoc-platform/management/issues/1",
    p_synced_at: new Date().toISOString(),
    p_activity_message: "verification",
  });
  const fail = await supabase.rpc("fail_github_issue_sync_transaction", {
    p_task_id: missingTaskId,
    p_error_message: "verification",
    p_activity_message: "verification",
  });

  return [
    { name: "create_task_transaction", result: create, expectedCode: "22023" },
    { name: "begin_github_issue_sync_transaction", result: begin, expectedCode: "P0002" },
    { name: "finalize_github_issue_sync_transaction", result: finalize, expectedCode: "P0002" },
    { name: "fail_github_issue_sync_transaction", result: fail, expectedCode: "P0002" },
  ].map(({ name, result: rpcResult, expectedCode }) => ({
    name,
    ok: rpcResult.error?.code === expectedCode,
    error: rpcResult.error?.code === expectedCode
      ? ""
      : rpcResult.error?.message || `RPC did not return ${expectedCode}`,
  }));
}

async function verifyGitHubCommentDeliveryRpcs() {
  const missingTaskId = `verify-missing-comment-delivery-${Date.now()}`;
  const lockToken = randomUUID();
  const claimParams = {
    p_lock_token: lockToken,
    p_task_id: missingTaskId,
    p_author_profile_id: null,
    p_limit: 1,
    p_lease_seconds: 30,
  };
  const finalizeParams = {
    p_task_comment_id: -1,
    p_lock_token: lockToken,
    p_status: "failed",
    p_status_reason: "verification",
    p_github_issue_number: null,
    p_github_comment_id: null,
    p_github_comment_url: null,
    p_last_error: "verification",
    p_next_attempt_at: null,
  };
  const [claim, anonClaim, finalize, anonFinalize] = await Promise.all([
    supabase.rpc("claim_task_comment_github_deliveries", claimParams),
    anonSupabase.rpc("claim_task_comment_github_deliveries", claimParams),
    supabase.rpc("finalize_task_comment_github_delivery", finalizeParams),
    anonSupabase.rpc("finalize_task_comment_github_delivery", finalizeParams),
  ]);

  return {
    ok: !claim.error
      && Array.isArray(claim.data)
      && claim.data.length === 0
      && Boolean(anonClaim.error)
      && !finalize.error
      && finalize.data === false
      && Boolean(anonFinalize.error),
    error: claim.error?.message
      || (!anonClaim.error ? "comment delivery claim RPC allowed anonymous execution" : "")
      || finalize.error?.message
      || (finalize.data !== false ? "comment delivery finalize RPC matched a missing row" : "")
      || (!anonFinalize.error ? "comment delivery finalize RPC allowed anonymous execution" : ""),
  };
}

async function verifyPlanningBatchRpcs() {
  const backlog = await supabase.rpc("update_backlog_order_transaction", {
    p_updates: [],
    p_actor_profile_id: null,
    p_request_ip: null,
    p_user_agent: null,
  });
  const sprintPlan = await supabase.rpc("create_sprint_plan_transaction", {
    p_sprints: [],
    p_meetings: [],
    p_audit_data: {},
    p_actor_profile_id: null,
    p_request_ip: null,
    p_user_agent: null,
  });

  return [
    { name: "update_backlog_order_transaction", result: backlog },
    { name: "create_sprint_plan_transaction", result: sprintPlan },
  ].map(({ name, result: rpcResult }) => ({
    name,
    ok: rpcResult.error?.code === "22023",
    error: rpcResult.error?.code === "22023" ? "" : rpcResult.error?.message || "RPC did not reject an empty batch",
  }));
}

async function verifySprintFinalizationRpc() {
  const params = {
    p_sprint_id: `verify-missing-sprint-lock-${Date.now()}`,
    p_expected_updated_at: new Date().toISOString(),
    p_task_updates: [],
    p_accepted_blocker_task_ids: [],
    p_carryover_inserts: [],
    p_notifications: [],
    p_score_rows: [],
    p_strike_state_rows: [],
    p_strike_events: [],
    p_result_data: {},
    p_actor_profile_id: null,
    p_request_ip: null,
    p_user_agent: null,
  };
  const [{ error }, { error: anonError }] = await Promise.all([
    supabase.rpc("lock_sprint_transaction", params),
    anonSupabase.rpc("lock_sprint_transaction", params),
  ]);
  return {
    ok: error?.code === "P0002" && Boolean(anonError),
    error: error?.code !== "P0002"
      ? error?.message || "lock_sprint_transaction unexpectedly accepted a missing sprint"
      : !anonError
        ? "lock_sprint_transaction unexpectedly allowed anonymous execution"
        : "",
  };
}

async function verifyTaskReviewRpc() {
  const params = {
    p_task_id: `verify-missing-task-review-${Date.now()}`,
    p_sprint_id: null,
    p_expected_updated_at: new Date().toISOString(),
    p_task_patch: {},
    p_reviewer_profile_id: null,
    p_decision: "accepted",
    p_points: 10,
    p_comment: "Verification",
    p_checklist: {},
    p_activity_message: "Verification",
    p_notifications: [],
    p_audit_after_data: {},
    p_request_ip: null,
    p_user_agent: null,
  };
  const [{ error }, { error: anonError }] = await Promise.all([
    supabase.rpc("review_task_transaction", params),
    anonSupabase.rpc("review_task_transaction", params),
  ]);
  return {
    ok: error?.code === "P0002" && Boolean(anonError),
    error: error?.code !== "P0002"
      ? error?.message || "review_task_transaction unexpectedly accepted a missing task"
      : !anonError
        ? "review_task_transaction unexpectedly allowed anonymous execution"
        : "",
  };
}

async function verifyScoreObjectionRpc() {
  const params = {
    p_sprint_id: `verify-missing-score-objection-${Date.now()}`,
    p_objection_id: -1,
    p_actor_profile_id: null,
    p_action: "resolve",
    p_status: "dismissed",
    p_resolution_comment: "Verification",
    p_delivery_points: null,
    p_form_points: null,
    p_weekly_points: null,
    p_second_review_decision: null,
    p_request_ip: null,
    p_user_agent: null,
  };
  const [{ error }, { error: anonError }] = await Promise.all([
    supabase.rpc("resolve_score_objection_transaction", params),
    anonSupabase.rpc("resolve_score_objection_transaction", params),
  ]);
  return {
    ok: error?.code === "P0002" && Boolean(anonError),
    error: error?.code !== "P0002"
      ? error?.message || "resolve_score_objection_transaction unexpectedly accepted a missing sprint"
      : !anonError
        ? "resolve_score_objection_transaction unexpectedly allowed anonymous execution"
        : "",
  };
}

async function verifyTeamTaskIntakeRpcs() {
  const tokenParams = {
    p_profile_id: `verify-missing-team-intake-profile-${Date.now()}`,
    p_label: "Verification",
    p_token_hash: "a".repeat(64),
    p_token_hint: "…verify",
  };
  const authParams = {
    p_token_hash: "c".repeat(64),
    p_scope: "read:task-context",
  };
  const revokeParams = {
    p_token_id: randomUUID(),
    p_profile_id: `verify-missing-team-intake-profile-${Date.now()}`,
  };
  const batchParams = {
    p_token_id: randomUUID(),
    p_profile_id: `verify-missing-team-intake-profile-${Date.now()}`,
    p_idempotency_key: randomUUID(),
    p_request_hash: "b".repeat(64),
    p_items: [{ itemType: "deliverable", title: "Verification" }],
    p_request_ip: null,
    p_user_agent: null,
  };
  const [token, anonToken, auth, anonAuth, revoke, anonRevoke, legacyBatch, anonLegacyBatch, v2Batch, anonV2Batch] = await Promise.all([
    supabase.rpc("create_team_task_intake_token", tokenParams),
    anonSupabase.rpc("create_team_task_intake_token", tokenParams),
    supabase.rpc("authenticate_team_task_intake_token", authParams),
    anonSupabase.rpc("authenticate_team_task_intake_token", authParams),
    supabase.rpc("revoke_team_task_intake_token", revokeParams),
    anonSupabase.rpc("revoke_team_task_intake_token", revokeParams),
    supabase.rpc("create_team_task_intake_batch_transaction", batchParams),
    anonSupabase.rpc("create_team_task_intake_batch_transaction", batchParams),
    supabase.rpc("create_team_task_intake_v2_transaction", batchParams),
    anonSupabase.rpc("create_team_task_intake_v2_transaction", batchParams),
  ]);

  return [
    {
      name: "create_team_task_intake_token",
      ok: token.error?.code === "P0002" && Boolean(anonToken.error),
      error: token.error?.code !== "P0002"
        ? token.error?.message || "token RPC unexpectedly accepted a missing profile"
        : !anonToken.error
          ? "token RPC unexpectedly allowed anonymous execution"
          : "",
    },
    {
      name: "authenticate_team_task_intake_token",
      ok: auth.error?.code === "P0004" && Boolean(anonAuth.error),
      error: auth.error?.code !== "P0004"
        ? auth.error?.message || "token auth RPC unexpectedly accepted an inactive token"
        : !anonAuth.error
          ? "token auth RPC unexpectedly allowed anonymous execution"
          : "",
    },
    {
      name: "revoke_team_task_intake_token",
      ok: revoke.data === null && !revoke.error && Boolean(anonRevoke.error),
      error: revoke.error
        ? revoke.error.message
        : revoke.data !== null
          ? "token revoke RPC unexpectedly found a missing token"
          : !anonRevoke.error
            ? "token revoke RPC unexpectedly allowed anonymous execution"
            : "",
    },
    {
      name: "create_team_task_intake_batch_transaction_removed",
      ok: legacyBatch.error?.code === "PGRST202" && anonLegacyBatch.error?.code === "PGRST202",
      error: legacyBatch.error?.code !== "PGRST202" || anonLegacyBatch.error?.code !== "PGRST202"
        ? legacyBatch.error?.message || anonLegacyBatch.error?.message || "legacy Team Task Intake RPC is still available"
        : "",
    },
    {
      name: "create_team_task_intake_v2_transaction",
      ok: v2Batch.error?.code === "P0004" && Boolean(anonV2Batch.error),
      error: v2Batch.error?.code !== "P0004"
        ? v2Batch.error?.message || "v2 batch RPC unexpectedly accepted an inactive token"
        : !anonV2Batch.error
          ? "v2 batch RPC unexpectedly allowed anonymous execution"
          : "",
    },
  ];
}

async function verifyApprovalDecisionRpcs() {
  const checks = [
    ["decide_initiative_approval_transaction", "p_initiative_id"],
    ["decide_deliverable_approval_transaction", "p_task_id"],
  ];

  return Promise.all(checks.map(async ([name, idField]) => {
    const { error } = await supabase.rpc(name, {
      [idField]: `verify-missing-approval-item-${Date.now()}`,
      p_expected_revision: 1,
      p_action: "return_to_draft",
      p_actor_profile_id: "",
      p_note: null,
    });
    return {
      name,
      ok: error?.code === "22023",
      error: error?.code === "22023" ? "" : error?.message || "RPC did not require an approval decision note",
    };
  }));
}

async function verifyPlanningTrashLifecycleRpcs() {
  const missingActorId = `verify-missing-trash-actor-${Date.now()}`;
  const lockToken = randomUUID();
  const withdrawParams = {
    p_root_type: "deliverable",
    p_root_id: `verify-missing-trash-root-${Date.now()}`,
    p_expected_revision: 1,
    p_actor_profile_id: missingActorId,
    p_reason: "Verification",
    p_request_ip: null,
    p_user_agent: null,
  };
  const restoreParams = {
    p_root_type: "deliverable",
    p_root_id: `verify-missing-restore-root-${Date.now()}`,
    p_expected_trash_revision: 1,
    p_actor_profile_id: missingActorId,
    p_request_ip: null,
    p_user_agent: null,
  };
  const claimParams = { p_lock_token: lockToken, p_limit: 0, p_lease_seconds: 120 };
  const scopedClaimParams = {
    p_lock_token: lockToken,
    p_root_type: "deliverable",
    p_root_id: `verify-missing-lifecycle-root-${Date.now()}`,
    p_task_ids: [`verify-missing-lifecycle-task-${Date.now()}`],
    p_limit: 0,
    p_lease_seconds: 120,
  };
  const finalizeParams = {
    p_job_id: randomUUID(),
    p_lock_token: lockToken,
    p_succeeded: true,
    p_error_message: null,
    p_status_reason: "verification",
  };
  const [
    withdraw,
    anonWithdraw,
    restore,
    anonRestore,
    claim,
    anonClaim,
    scopedClaim,
    anonScopedClaim,
    finalize,
    anonFinalize,
  ] = await Promise.all([
    supabase.rpc("withdraw_planning_item_transaction", withdrawParams),
    anonSupabase.rpc("withdraw_planning_item_transaction", withdrawParams),
    supabase.rpc("restore_planning_item_transaction", restoreParams),
    anonSupabase.rpc("restore_planning_item_transaction", restoreParams),
    supabase.rpc("claim_planning_github_lifecycle_jobs", claimParams),
    anonSupabase.rpc("claim_planning_github_lifecycle_jobs", claimParams),
    supabase.rpc("claim_planning_github_lifecycle_jobs_for_root", scopedClaimParams),
    anonSupabase.rpc("claim_planning_github_lifecycle_jobs_for_root", scopedClaimParams),
    supabase.rpc("finalize_planning_github_lifecycle_job", finalizeParams),
    anonSupabase.rpc("finalize_planning_github_lifecycle_job", finalizeParams),
  ]);

  return [
    ["withdraw_planning_item_transaction", withdraw, anonWithdraw, "P0006"],
    ["restore_planning_item_transaction", restore, anonRestore, "P0006"],
    ["claim_planning_github_lifecycle_jobs", claim, anonClaim, "22023"],
    ["claim_planning_github_lifecycle_jobs_for_root", scopedClaim, anonScopedClaim, "22023"],
    ["finalize_planning_github_lifecycle_job", finalize, anonFinalize, "P0002"],
  ].map(([name, serviceResult, anonResult, expectedCode]) => ({
    name,
    ok: serviceResult.error?.code === expectedCode && Boolean(anonResult.error),
    error: serviceResult.error?.code !== expectedCode
      ? serviceResult.error?.message || `RPC did not return ${expectedCode}`
      : !anonResult.error
        ? "RPC unexpectedly allowed anonymous execution"
        : "",
  }));
}

const { data: project, error: projectError } = await supabase
  .from("projects")
  .select("id,name,range_label")
  .eq("id", "findmydoc-founder-execution")
  .single();

if (projectError) throw new Error(`projects: ${projectError.message}`);

const result = {
  project: project.name,
  range: project.range_label,
  profiles: await count("profiles"),
  githubAppConnections: await count("github_app_user_tokens"),
  packages: await count("packages"),
  tasks: await count("tasks"),
  taskDeletionOperations: await count("task_deletion_operations"),
  dependencies: await count("task_dependencies"),
  links: await count("task_links"),
  notes: await count("task_notes"),
  activity: await count("task_activity"),
  sprints: await count("sprints"),
  sprintCommitments: await count("sprint_commitments"),
  founderSprintScores: await count("founder_sprint_scores"),
  founderStrikeStates: await count("founder_strike_state"),
  strikeEvents: await count("strike_events"),
  scoreObjections: await count("score_objections"),
  reviews: await count("task_reviews"),
  audit: await count("audit_log"),
  comments: await count("task_comments"),
  githubCommentDeliveries: await count("task_comment_github_deliveries"),
  externalComments: await count("task_external_comments"),
  blockers: await count("task_blockers"),
  relationships: await count("task_relationship_edges"),
  focusItems: await count("task_focus_items"),
  notifications: await count("notification_events"),
  notificationDeliveries: await count("notification_deliveries"),
  planningGitHubLifecycleJobs: await count("planning_github_lifecycle_outbox"),
  profileUiPreferences: await count("profile_ui_preferences"),
  profileFeatureTourAcknowledgements: await count("profile_feature_tour_acknowledgements"),
  meetings: await count("meetings"),
  meetingAttendance: await count("meeting_attendance"),
  events: await count("founder_events"),
  milestones: await count("milestones"),
  schema: await Promise.all(schemaChecks.map(checkSchema)),
  githubSyncLockRpc: await verifyGitHubSyncLockRpc(),
  profileWriteRpcs: await verifyProfileWriteRpcs(),
  taskUpdateRpc: await verifyTaskUpdateRpc(),
  taskDeletionRpcs: await verifyTaskDeletionRpcs(),
  taskCreationAndGitHubSyncRpcs: await verifyTaskCreationAndGitHubSyncRpcs(),
  githubCommentDeliveryRpcs: await verifyGitHubCommentDeliveryRpcs(),
  planningBatchRpcs: await verifyPlanningBatchRpcs(),
  sprintFinalizationRpc: await verifySprintFinalizationRpc(),
  taskReviewRpc: await verifyTaskReviewRpc(),
  scoreObjectionRpc: await verifyScoreObjectionRpc(),
  teamTaskIntakeRpcs: await verifyTeamTaskIntakeRpcs(),
  approvalDecisionRpcs: await verifyApprovalDecisionRpcs(),
  planningTrashLifecycleRpcs: await verifyPlanningTrashLifecycleRpcs(),
};

console.log(JSON.stringify(result, null, 2));

const missingSchema = result.schema.filter((check) => !check.ok);
if (missingSchema.length) {
  console.error("Supabase schema is incomplete. Run the missing migrations in order, especially 0008_google_chat_delivery.sql, 0009_sprint_carryover.sql and 0010_task_self_checklist.sql.");
  process.exit(1);
}

if (!result.githubSyncLockRpc.ok) {
  console.error(`GitHub sync lock RPC check failed: ${result.githubSyncLockRpc.error}`);
  process.exit(1);
}

const missingProfileWriteRpc = result.profileWriteRpcs.find((check) => !check.ok);
if (missingProfileWriteRpc) {
  console.error(`Profile write RPC check failed for ${missingProfileWriteRpc.name}: ${missingProfileWriteRpc.error}`);
  process.exit(1);
}

if (!result.taskUpdateRpc.ok) {
  console.error(`Task update RPC check failed: ${result.taskUpdateRpc.error}`);
  process.exit(1);
}

const missingTaskDeletionRpc = result.taskDeletionRpcs.find((check) => !check.ok);
if (missingTaskDeletionRpc) {
  console.error(`Task deletion RPC check failed for ${missingTaskDeletionRpc.name}: ${missingTaskDeletionRpc.error}`);
  process.exit(1);
}

const missingTaskCreationOrSyncRpc = result.taskCreationAndGitHubSyncRpcs.find((check) => !check.ok);
if (missingTaskCreationOrSyncRpc) {
  console.error(`Task creation or GitHub sync RPC check failed for ${missingTaskCreationOrSyncRpc.name}: ${missingTaskCreationOrSyncRpc.error}`);
  process.exit(1);
}

if (!result.githubCommentDeliveryRpcs.ok) {
  console.error(`GitHub comment delivery RPC check failed: ${result.githubCommentDeliveryRpcs.error}`);
  process.exit(1);
}

const missingPlanningBatchRpc = result.planningBatchRpcs.find((check) => !check.ok);
if (missingPlanningBatchRpc) {
  console.error(`Planning batch RPC check failed for ${missingPlanningBatchRpc.name}: ${missingPlanningBatchRpc.error}`);
  process.exit(1);
}

if (!result.sprintFinalizationRpc.ok) {
  console.error(`Sprint finalization RPC check failed: ${result.sprintFinalizationRpc.error}`);
  process.exit(1);
}

if (!result.taskReviewRpc.ok) {
  console.error(`Task review RPC check failed: ${result.taskReviewRpc.error}`);
  process.exit(1);
}

if (!result.scoreObjectionRpc.ok) {
  console.error(`Score objection RPC check failed: ${result.scoreObjectionRpc.error}`);
  process.exit(1);
}

const missingTeamTaskIntakeRpc = result.teamTaskIntakeRpcs.find((check) => !check.ok);
if (missingTeamTaskIntakeRpc) {
  console.error(`Team Task Intake RPC check failed for ${missingTeamTaskIntakeRpc.name}: ${missingTeamTaskIntakeRpc.error}`);
  process.exit(1);
}

const missingApprovalDecisionRpc = result.approvalDecisionRpcs.find((check) => !check.ok);
if (missingApprovalDecisionRpc) {
  console.error(`Approval decision RPC check failed for ${missingApprovalDecisionRpc.name}: ${missingApprovalDecisionRpc.error}`);
  process.exit(1);
}

const missingPlanningTrashLifecycleRpc = result.planningTrashLifecycleRpcs.find((check) => !check.ok);
if (missingPlanningTrashLifecycleRpc) {
  console.error(`Planning trash lifecycle RPC check failed for ${missingPlanningTrashLifecycleRpc.name}: ${missingPlanningTrashLifecycleRpc.error}`);
  process.exit(1);
}
