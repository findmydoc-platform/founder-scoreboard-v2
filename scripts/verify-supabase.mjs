import { readFile } from "node:fs/promises";
import { createSupabaseScriptClient } from "./lib/supabase.mjs";

const supabase = await createSupabaseScriptClient();

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
