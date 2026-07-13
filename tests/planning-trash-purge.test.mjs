import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const maintenanceScriptPath = fileURLToPath(
  new URL(".github/scripts/maintenance/purge-planning-trash.sh", root),
);

function validateMaintenanceResponse(functionName, response) {
  return spawnSync(
    "bash",
    ["-c", 'source "$1"; "$2" "$3"', "_", maintenanceScriptPath, functionName, JSON.stringify(response)],
    { encoding: "utf8" },
  );
}

test("planning trash purge is bounded, locked, and fails closed on GitHub lifecycle coverage", async () => {
  const [migration, schema] = await Promise.all([
    read("supabase/0065_planning_trash_purge.sql"),
    read("supabase/schema.sql"),
  ]);

  for (const sql of [migration, schema]) {
    assert.match(sql, /create or replace function public\.purge_expired_planning_trash_batch/);
    assert.match(sql, /greatest\(1, least\(coalesce\(p_limit, 25\), 25\)\)/);
    assert.match(sql, /pg_try_advisory_xact_lock/);
    assert.match(sql, /for update skip locked/);
    assert.match(sql, /with expired_roots as/);
    assert.match(sql, /eligible_roots as/);
    assert.match(sql, /from eligible_roots candidate[\s\S]*limit v_limit/);
    assert.match(sql, /set_config\('founderops\.trash_lifecycle_write', 'on', true\)/);
    assert.match(sql, /root_trash_revision = v_candidate\.trash_revision/);
    assert.match(sql, /v_outbox_count <> v_task_count/);
    assert.match(sql, /v_completed_outbox_count <> v_task_count/);
    assert.match(sql, /lifecycle\.status = 'completed'/);
    assert.match(sql, /lifecycle\.task_id = expected\.task_id/);
    assert.match(sql, /not \(lifecycle\.task_id = any\(v_task_ids\)\)/);
    assert.match(sql, /lifecycle\.action = 'close_not_planned'/);
    assert.match(sql, /github_issue_number is null and lifecycle\.status_reason = 'issue_missing'/);
    assert.match(sql, /github_issue_number is not null and lifecycle\.status_reason = 'delivered'/);
    assert.match(sql, /p_dry_run/);
    assert.match(sql, /to service_role/);
    assert.match(sql, /from public, anon, authenticated/);
  }
  assert.doesNotMatch(migration, /limit v_limit \* 4/);
  assert.ok(migration.indexOf("limit v_limit") < migration.indexOf("for update skip locked"));
});

test("purge retains audit and notification history while removing only eligible source rows", async () => {
  const migration = await read("supabase/0065_planning_trash_purge.sql");

  assert.match(migration, /set status = 'resolved'/);
  assert.match(migration, /resolution_reason = coalesce\(notification\.resolution_reason, 'source_purged'\)/);
  assert.match(migration, /insert into public\.audit_log/);
  assert.match(migration, /'planning_trash\.purge'/);
  assert.match(migration, /delete from public\.tasks/);
  assert.match(migration, /delete from public\.packages/);
  assert.doesNotMatch(migration, /delete from public\.audit_log/i);
  assert.doesNotMatch(migration, /delete from public\.notification_events/i);
  assert.doesNotMatch(migration, /github\.com|api\.github/i);
});

test("maintenance API has a separate secret and an explicit service-role client", async () => {
  const [route, lifecycleRoute, auth, serviceRoleClient] = await Promise.all([
    read("src/app/api/maintenance/planning-trash/purge/route.ts"),
    read("src/app/api/maintenance/planning-trash/github-lifecycle/route.ts"),
    read("src/lib/maintenance-auth.ts"),
    read("src/lib/supabase-service-role.ts"),
  ]);

  assert.match(route, /getServerServiceRoleSupabase/);
  assert.match(route, /p_limit: 25/);
  assert.match(route, /p_dry_run: false/);
  assert.doesNotMatch(route, /requireOperationalLead|requireApiContext|Authorization|github/i);
  assert.match(auth, /x-founderops-maintenance-secret/);
  assert.match(auth, /FOUNDEROPS_MAINTENANCE_SECRET/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(serviceRoleClient, /export function getServerServiceRoleSupabase/);
  assert.match(serviceRoleClient, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(serviceRoleClient, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(serviceRoleClient, /ANON|PUBLISHABLE/);
  assert.match(lifecycleRoute, /drainPlanningGitHubLifecycleJobs/);
  assert.match(lifecycleRoute, /limit: 25/);
  assert.match(lifecycleRoute, /validateMaintenanceSecret/);
});

test("daily workflow warms up and retries one production batch without GitHub credentials", async () => {
  const [workflow, script] = await Promise.all([
    read(".github/workflows/purge-planning-trash.yml"),
    read(".github/scripts/maintenance/purge-planning-trash.sh"),
  ]);

  assert.match(workflow, /cron: "15 3 \* \* \*"/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /name: production/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /FOUNDEROPS_MAINTENANCE_SECRET/);
  assert.doesNotMatch(workflow, /GITHUB_TOKEN|permissions:\s*write/);
  assert.match(script, /sleep 45/);
  assert.match(script, /backoffs=\(0 45 90 180\)/);
  assert.match(script, /RANDOM % 6/);
  assert.match(script, /--fail-with-body/);
  assert.match(script, /\/api\/health/);
  assert.match(script, /\/api\/maintenance\/planning-trash\/github-lifecycle/);
  assert.match(script, /\/api\/maintenance\/planning-trash\/purge/);
  assert.match(script, /validate_lifecycle_response/);
  assert.match(script, /validate_purge_response/);
  assert.match(script, /\.retryScheduled == 0/);
  assert.match(script, /\.failed == 0/);
  assert.match(script, /\.completed == \.claimed/);
  assert.match(script, /\(\.hasMore == false\) or \(\.purgedRoots == 25\)/);
  assert.ok(
    script.indexOf("/api/maintenance/planning-trash/github-lifecycle")
      < script.indexOf("/api/maintenance/planning-trash/purge"),
  );
});

test("daily workflow rejects partial lifecycle and blocked purge responses", () => {
  const successfulLifecycle = validateMaintenanceResponse("validate_lifecycle_response", {
    ok: true,
    claimed: 1,
    completed: 1,
    retryScheduled: 0,
    failed: 0,
  });
  assert.equal(successfulLifecycle.status, 0, successfulLifecycle.stderr);

  for (const response of [
    { ok: true, claimed: 1, completed: 0, retryScheduled: 1, failed: 0 },
    { ok: true, claimed: 1, completed: 0, retryScheduled: 0, failed: 1 },
    { ok: true, claimed: 1, completed: 0, retryScheduled: 0, failed: 0 },
    { ok: false, claimed: 0, completed: 0, retryScheduled: 0, failed: 0 },
  ]) {
    assert.notEqual(
      validateMaintenanceResponse("validate_lifecycle_response", response).status,
      0,
    );
  }

  for (const response of [
    {
      ok: true,
      busy: false,
      purgedRoots: 1,
      purgedTasks: 2,
      resolvedNotifications: 0,
      hasMore: false,
    },
    {
      ok: true,
      busy: false,
      purgedRoots: 25,
      purgedTasks: 40,
      resolvedNotifications: 3,
      hasMore: true,
    },
  ]) {
    const result = validateMaintenanceResponse("validate_purge_response", response);
    assert.equal(result.status, 0, result.stderr);
  }

  for (const response of [
    {
      ok: true,
      busy: true,
      purgedRoots: 0,
      purgedTasks: 0,
      resolvedNotifications: 0,
      hasMore: true,
    },
    {
      ok: true,
      busy: false,
      purgedRoots: 0,
      purgedTasks: 0,
      resolvedNotifications: 0,
      hasMore: true,
    },
  ]) {
    assert.notEqual(validateMaintenanceResponse("validate_purge_response", response).status, 0);
  }
});
