import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("planning trash purge is bounded, locked, and fails closed on GitHub lifecycle coverage", async () => {
  const migration = await read("supabase/0065_planning_trash_purge.sql");

  assert.match(migration, /greatest\(1, least\(coalesce\(p_limit, 25\), 25\)\)/);
  assert.match(migration, /pg_try_advisory_xact_lock/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /root_trash_revision = v_candidate\.trash_revision/);
  assert.match(migration, /v_outbox_count <> v_task_count/);
  assert.match(migration, /v_completed_outbox_count <> v_task_count/);
  assert.match(migration, /lifecycle\.status = 'completed'/);
  assert.match(migration, /lifecycle\.action = 'close_not_planned'/);
  assert.match(migration, /p_dry_run/);
  assert.match(migration, /to service_role/);
  assert.match(migration, /from public, anon, authenticated/);
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
  const [route, auth, supabase] = await Promise.all([
    read("src/app/api/maintenance/planning-trash/purge/route.ts"),
    read("src/lib/maintenance-auth.ts"),
    read("src/lib/supabase.ts"),
  ]);

  assert.match(route, /getServerServiceRoleSupabase/);
  assert.match(route, /p_limit: 25/);
  assert.match(route, /p_dry_run: false/);
  assert.doesNotMatch(route, /requireOperationalLead|requireApiContext|Authorization|github/i);
  assert.match(auth, /x-founderops-maintenance-secret/);
  assert.match(auth, /FOUNDEROPS_MAINTENANCE_SECRET/);
  assert.match(auth, /timingSafeEqual/);
  assert.match(supabase, /export function getServerServiceRoleSupabase/);
  assert.match(supabase, /SUPABASE_SERVICE_ROLE_KEY/);
  const strictClientStart = supabase.indexOf("export function getServerServiceRoleSupabase");
  const strictClientTail = supabase.slice(strictClientStart);
  const nextExport = strictClientTail.indexOf("\nexport function", 1);
  const strictClient = nextExport === -1 ? strictClientTail : strictClientTail.slice(0, nextExport);
  assert.doesNotMatch(strictClient, /runtimeSupabaseAnonKey/);
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
  assert.match(script, /\/api\/maintenance\/planning-trash\/purge/);
});
