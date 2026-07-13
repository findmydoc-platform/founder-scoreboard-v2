import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

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
    assert.match(sql, /set_config\('founderops\.trash_lifecycle_write', 'on', true\)/);
    assert.match(sql, /root_trash_revision = v_candidate\.trash_revision/);
    assert.match(sql, /v_outbox_count <> v_task_count/);
    assert.match(sql, /v_completed_outbox_count <> v_task_count/);
    assert.match(sql, /lifecycle\.status = 'completed'/);
    assert.match(sql, /lifecycle\.action = 'close_not_planned'/);
    assert.match(sql, /p_dry_run/);
    assert.match(sql, /to service_role/);
    assert.match(sql, /from public, anon, authenticated/);
  }
  assert.doesNotMatch(migration, /limit v_limit \* 4/);
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
  assert.ok(
    script.indexOf("/api/maintenance/planning-trash/github-lifecycle")
      < script.indexOf("/api/maintenance/planning-trash/purge"),
  );
});
