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

async function verifyFounderOpsReviewWindowRpc() {
  const missingProfileId = `verify-missing-ceo-${Date.now()}`;
  const params = {
    p_project_id: "findmydoc-founder-execution",
    p_expected_hours: 48,
    p_review_objection_window_hours: 48,
    p_actor_profile_id: missingProfileId,
    p_request_ip: null,
    p_user_agent: null,
  };
  const [{ error }, { error: anonError }] = await Promise.all([
    supabase.rpc("update_founderops_review_window_transaction", params),
    anonSupabase.rpc("update_founderops_review_window_transaction", params),
  ]);
  return {
    ok: error?.code === "P0005" && Boolean(anonError),
    error: error?.code !== "P0005"
      ? error?.message || "FounderOps settings RPC unexpectedly accepted a missing CEO profile"
      : !anonError
        ? "FounderOps settings RPC unexpectedly allowed anonymous execution"
        : "",
  };
}

async function verifyFounderOpsGitHubProjectRpc() {
  const missingProfileId = `verify-missing-operational-lead-${Date.now()}`;
  const params = {
    p_project_id: "findmydoc-founder-execution",
    p_expected_owner: "findmydoc-platform",
    p_expected_number: 21,
    p_github_project_owner: "findmydoc-platform",
    p_github_project_number: 21,
    p_actor_profile_id: missingProfileId,
    p_request_ip: null,
    p_user_agent: null,
  };
  const [{ error }, { error: anonError }] = await Promise.all([
    supabase.rpc("update_founderops_github_project_transaction", params),
    anonSupabase.rpc("update_founderops_github_project_transaction", params),
  ]);
  return {
    ok: error?.code === "P0005" && Boolean(anonError),
    error: error?.code !== "P0005"
      ? error?.message || "FounderOps GitHub Project RPC unexpectedly accepted a missing operational lead"
      : !anonError
        ? "FounderOps GitHub Project RPC unexpectedly allowed anonymous execution"
        : "",
  };
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
  const beginV2 = await supabase.rpc("begin_github_issue_sync_transaction_v2", {
    p_task_id: missingTaskId,
    p_expected_updated_at: new Date().toISOString(),
  });
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
  const finalizeV2 = await supabase.rpc("finalize_github_issue_sync_transaction_v2", {
    p_task_id: missingTaskId,
    p_expected_updated_at: new Date().toISOString(),
    p_github_repo: "findmydoc-platform/management",
    p_github_issue_number: 1,
    p_github_issue_url: "https://github.com/findmydoc-platform/management/issues/1",
    p_synced_at: new Date().toISOString(),
    p_activity_message: "verification",
  });

  return [
    { name: "create_task_transaction", result: create, expectedCode: "22023" },
    { name: "begin_github_issue_sync_transaction", result: begin, expectedCode: "P0002" },
    { name: "begin_github_issue_sync_transaction_v2", result: beginV2, expectedCode: "P0002" },
    { name: "finalize_github_issue_sync_transaction", result: finalize, expectedCode: "P0002" },
    { name: "fail_github_issue_sync_transaction", result: fail, expectedCode: "P0002" },
    { name: "finalize_github_issue_sync_transaction_v2", result: finalizeV2, expectedCode: "P0002" },
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
  const [backlog, backlogMove, anonymousBacklogMove, sprintPlan] = await Promise.all([
    supabase.rpc("update_backlog_order_transaction", {
      p_updates: [],
      p_actor_profile_id: null,
      p_request_ip: null,
      p_user_agent: null,
    }),
    supabase.rpc("move_backlog_task_transaction", {
      p_task_id: "",
      p_target_task_id: "",
      p_placement: "before",
      p_expected_task_updated_at: new Date().toISOString(),
      p_expected_target_updated_at: new Date().toISOString(),
      p_actor_profile_id: null,
      p_request_ip: null,
      p_user_agent: null,
    }),
    anonSupabase.rpc("move_backlog_task_transaction", {
      p_task_id: "",
      p_target_task_id: "",
      p_placement: "before",
      p_expected_task_updated_at: new Date().toISOString(),
      p_expected_target_updated_at: new Date().toISOString(),
      p_actor_profile_id: null,
      p_request_ip: null,
      p_user_agent: null,
    }),
    supabase.rpc("create_sprint_plan_transaction", {
      p_sprints: [],
      p_meetings: [],
      p_audit_data: {},
      p_actor_profile_id: null,
      p_request_ip: null,
      p_user_agent: null,
    }),
  ]);

  return [
    { name: "update_backlog_order_transaction", result: backlog },
    { name: "move_backlog_task_transaction", result: backlogMove },
    { name: "create_sprint_plan_transaction", result: sprintPlan },
  ].map(({ name, result: rpcResult }) => ({
    name,
    ok: rpcResult.error?.code === "22023",
    error: rpcResult.error?.code === "22023" ? "" : rpcResult.error?.message || "RPC did not reject an empty batch",
  })).concat({
    name: "move_backlog_task_transaction anonymous execution",
    ok: Boolean(anonymousBacklogMove.error),
    error: anonymousBacklogMove.error ? "" : "backlog move RPC unexpectedly allowed anonymous execution",
  });
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
    supabase.rpc("lock_sprint_with_review_window_transaction", params),
    anonSupabase.rpc("lock_sprint_with_review_window_transaction", params),
  ]);
  return {
    ok: error?.code === "P0002" && Boolean(anonError),
    error: error?.code !== "P0002"
      ? error?.message || "lock_sprint_with_review_window_transaction unexpectedly accepted a missing sprint"
      : !anonError
        ? "lock_sprint_with_review_window_transaction unexpectedly allowed anonymous execution"
        : "",
  };
}

async function verifyTaskReviewRpc() {
  const params = {
    p_task_id: `verify-missing-task-review-${Date.now()}`,
    p_sprint_id: null,
    p_expected_updated_at: new Date().toISOString(),
    p_task_patch: {},
    p_reviewer_profile_id: "verify-reviewer",
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

async function verifyTaskReviewTransitionRpc() {
  const params = {
    p_task_id: `verify-missing-task-review-transition-${Date.now()}`,
    p_expected_updated_at: new Date().toISOString(),
    p_action: "withdraw",
    p_actor_profile_id: null,
    p_reason: "Verification",
    p_activity_message: "Verification",
    p_notifications: [],
    p_audit_after_data: {},
    p_request_ip: null,
    p_user_agent: null,
  };
  const [{ error }, { error: anonError }] = await Promise.all([
    supabase.rpc("transition_task_review_transaction", params),
    anonSupabase.rpc("transition_task_review_transaction", params),
  ]);
  return {
    ok: error?.code === "P0002" && Boolean(anonError),
    error: error?.code !== "P0002"
      ? error?.message || "transition_task_review_transaction unexpectedly accepted a missing task"
      : !anonError
        ? "transition_task_review_transaction unexpectedly allowed anonymous execution"
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
    p_second_reviewer_profile_id: null,
    p_second_review_decision: null,
    p_request_ip: null,
    p_user_agent: null,
  };
  const createParams = {
    p_sprint_id: `verify-missing-score-objection-create-${Date.now()}`,
    p_profile_id: `verify-missing-score-objection-profile-${Date.now()}`,
    p_comment: "Verification",
    p_request_ip: null,
    p_user_agent: null,
  };
  const [{ error }, { error: anonError }, { error: createError }, { error: anonCreateError }] = await Promise.all([
    supabase.rpc("process_score_objection_transaction", params),
    anonSupabase.rpc("process_score_objection_transaction", params),
    supabase.rpc("create_score_objection_transaction", createParams),
    anonSupabase.rpc("create_score_objection_transaction", createParams),
  ]);
  return {
    ok: error?.code === "P0002" && Boolean(anonError) && createError?.code === "P0005" && Boolean(anonCreateError),
    error: error?.code !== "P0002"
      ? error?.message || "process_score_objection_transaction unexpectedly accepted a missing sprint"
      : !anonError
        ? "process_score_objection_transaction unexpectedly allowed anonymous execution"
        : createError?.code !== "P0005"
          ? createError?.message || "create_score_objection_transaction unexpectedly accepted a missing contributor"
          : !anonCreateError
            ? "create_score_objection_transaction unexpectedly allowed anonymous execution"
        : "",
  };
}

async function verifyPlanningItemsRpcs() {
  const tokenParams = {
    p_profile_id: `verify-missing-planning-items-profile-${Date.now()}`,
    p_label: "Verification",
    p_token_hash: "a".repeat(64),
    p_token_hint: "…verify",
    p_allow_updates: false,
  };
  const authParams = {
    p_token_hash: "c".repeat(64),
    p_scope: "read:planning-context",
  };
  const revokeParams = {
    p_token_id: randomUUID(),
    p_profile_id: `verify-missing-planning-items-profile-${Date.now()}`,
  };
  const createParams = {
    p_token_id: randomUUID(),
    p_profile_id: `verify-missing-planning-items-profile-${Date.now()}`,
    p_idempotency_key: randomUUID(),
    p_request_hash: "b".repeat(64),
    p_items: [{ itemType: "deliverable", title: "Verification" }],
    p_request_ip: null,
    p_user_agent: null,
  };
  const updateParams = {
    p_token_id: randomUUID(),
    p_profile_id: `verify-missing-planning-items-profile-${Date.now()}`,
    p_item_type: "deliverable",
    p_item_id: `verify-missing-planning-item-${Date.now()}`,
    p_expected_updated_at: new Date().toISOString(),
    p_idempotency_key: randomUUID(),
    p_request_hash: "d".repeat(64),
    p_patch: {},
    p_changed_fields: [],
    p_system_effects: [],
    p_request_ip: null,
    p_user_agent: null,
  };
  const [token, anonToken, auth, anonAuth, revoke, anonRevoke, create, anonCreate, update, anonUpdate] = await Promise.all([
    supabase.rpc("create_team_planning_items_token", tokenParams),
    anonSupabase.rpc("create_team_planning_items_token", tokenParams),
    supabase.rpc("authenticate_team_planning_items_token", authParams),
    anonSupabase.rpc("authenticate_team_planning_items_token", authParams),
    supabase.rpc("revoke_team_planning_items_token", revokeParams),
    anonSupabase.rpc("revoke_team_planning_items_token", revokeParams),
    supabase.rpc("create_team_planning_items_transaction", createParams),
    anonSupabase.rpc("create_team_planning_items_transaction", createParams),
    supabase.rpc("update_team_planning_item_transaction", updateParams),
    anonSupabase.rpc("update_team_planning_item_transaction", updateParams),
  ]);

  return [
    {
      name: "create_team_planning_items_token",
      ok: token.error?.code === "P0002" && Boolean(anonToken.error),
      error: token.error?.code !== "P0002"
        ? token.error?.message || "token RPC unexpectedly accepted a missing profile"
        : !anonToken.error
          ? "token RPC unexpectedly allowed anonymous execution"
          : "",
    },
    {
      name: "authenticate_team_planning_items_token",
      ok: auth.error?.code === "P0004" && Boolean(anonAuth.error),
      error: auth.error?.code !== "P0004"
        ? auth.error?.message || "token auth RPC unexpectedly accepted an inactive token"
        : !anonAuth.error
          ? "token auth RPC unexpectedly allowed anonymous execution"
          : "",
    },
    {
      name: "revoke_team_planning_items_token",
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
      name: "create_team_planning_items_transaction",
      ok: create.error?.code === "P0004" && Boolean(anonCreate.error),
      error: create.error?.code !== "P0004"
        ? create.error?.message || "planning item create unexpectedly accepted an inactive token"
        : !anonCreate.error
          ? "planning item create unexpectedly allowed anonymous execution"
          : "",
    },
    {
      name: "update_team_planning_item_transaction",
      ok: update.error?.code === "P0004" && Boolean(anonUpdate.error),
      error: update.error?.code !== "P0004"
        ? update.error?.message || "planning item update unexpectedly accepted an inactive token"
        : !anonUpdate.error
          ? "planning item update unexpectedly allowed anonymous execution"
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

async function verifyPlanningTrashPurgeRpc() {
  const serviceResult = await supabase.rpc("purge_expired_planning_trash_batch", {
    p_limit: 1,
    p_dry_run: true,
  });
  const anonResult = await anonSupabase.rpc("purge_expired_planning_trash_batch", {
    p_limit: 1,
    p_dry_run: true,
  });
  return {
    ok: !serviceResult.error && Boolean(anonResult.error),
    error: serviceResult.error?.message
      || (!anonResult.error ? "purge RPC unexpectedly allowed anonymous execution" : ""),
  };
}

const { data: project, error: projectError } = await supabase
  .from("projects")
  .select("id,name,range_label,review_objection_window_hours,github_project_owner,github_project_number")
  .eq("id", "findmydoc-founder-execution")
  .single();

if (projectError) throw new Error(`projects: ${projectError.message}`);

const result = {
  project: project.name,
  range: project.range_label,
  reviewObjectionWindowHours: project.review_objection_window_hours,
  githubProjectOwner: project.github_project_owner,
  githubProjectNumber: project.github_project_number,
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
  founderOpsReviewWindowRpc: await verifyFounderOpsReviewWindowRpc(),
  founderOpsGitHubProjectRpc: await verifyFounderOpsGitHubProjectRpc(),
  taskUpdateRpc: await verifyTaskUpdateRpc(),
  taskDeletionRpcs: await verifyTaskDeletionRpcs(),
  taskCreationAndGitHubSyncRpcs: await verifyTaskCreationAndGitHubSyncRpcs(),
  githubCommentDeliveryRpcs: await verifyGitHubCommentDeliveryRpcs(),
  planningBatchRpcs: await verifyPlanningBatchRpcs(),
  sprintFinalizationRpc: await verifySprintFinalizationRpc(),
  taskReviewRpc: await verifyTaskReviewRpc(),
  taskReviewTransitionRpc: await verifyTaskReviewTransitionRpc(),
  scoreObjectionRpc: await verifyScoreObjectionRpc(),
  planningItemsRpcs: await verifyPlanningItemsRpcs(),
  approvalDecisionRpcs: await verifyApprovalDecisionRpcs(),
  planningTrashLifecycleRpcs: await verifyPlanningTrashLifecycleRpcs(),
  planningTrashPurgeRpc: await verifyPlanningTrashPurgeRpc(),
};

console.log(JSON.stringify(result, null, 2));

const missingSchema = result.schema.filter((check) => !check.ok);
if (missingSchema.length) {
  console.error("Supabase schema is incomplete. Apply the canonical migration history with pnpm run db:reset locally or the protected production migration workflow.");
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

if (!result.founderOpsReviewWindowRpc.ok) {
  console.error(`FounderOps review-window RPC check failed: ${result.founderOpsReviewWindowRpc.error}`);
  process.exit(1);
}

if (!result.founderOpsGitHubProjectRpc.ok) {
  console.error(`FounderOps GitHub Project RPC check failed: ${result.founderOpsGitHubProjectRpc.error}`);
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

const missingPlanningItemsRpc = result.planningItemsRpcs.find((check) => !check.ok);
if (missingPlanningItemsRpc) {
  console.error(`Planning Items RPC check failed for ${missingPlanningItemsRpc.name}: ${missingPlanningItemsRpc.error}`);
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

if (!result.planningTrashPurgeRpc.ok) {
  console.error(`Planning trash purge RPC check failed: ${result.planningTrashPurgeRpc.error}`);
  process.exit(1);
}
