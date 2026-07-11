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
  externalComments: await count("task_external_comments"),
  blockers: await count("task_blockers"),
  relationships: await count("task_relationship_edges"),
  focusItems: await count("task_focus_items"),
  notifications: await count("notification_events"),
  notificationDeliveries: await count("notification_deliveries"),
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
  planningBatchRpcs: await verifyPlanningBatchRpcs(),
  sprintFinalizationRpc: await verifySprintFinalizationRpc(),
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

const missingPlanningBatchRpc = result.planningBatchRpcs.find((check) => !check.ok);
if (missingPlanningBatchRpc) {
  console.error(`Planning batch RPC check failed for ${missingPlanningBatchRpc.name}: ${missingPlanningBatchRpc.error}`);
  process.exit(1);
}

if (!result.sprintFinalizationRpc.ok) {
  console.error(`Sprint finalization RPC check failed: ${result.sprintFinalizationRpc.error}`);
  process.exit(1);
}
