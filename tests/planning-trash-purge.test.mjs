import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsePlanningTrashPurgeResult } from "../src/lib/planning-trash-maintenance-result.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("planning trash purge is bounded, locked, and fails closed on GitHub lifecycle coverage", async () => {
  const [migration, schema] = await Promise.all([
    readSupabaseSchemaContract(),
    readSupabaseSchemaContract(),
  ]);

  for (const sql of [migration, schema]) {
    assert.match(sql, /create or replace function public\.planning_trash_root_is_purge_eligible/);
    assert.match(sql, /create or replace function public\.purge_expired_planning_trash_batch/);
    assert.match(sql, /greatest\(1, least\(coalesce\(p_limit, 25\), 25\)\)/);
    assert.match(sql, /pg_try_advisory_xact_lock/);
    assert.match(sql, /for update skip locked/);
    assert.match(sql, /v_scan_limit integer := least\([\s\S]*\* 4, 100\)/);
    assert.match(sql, /with initiative_candidates as/);
    assert.match(sql, /deliverable_candidates as/);
    assert.match(sql, /from candidate_roots candidate[\s\S]*limit v_scan_limit/);
    assert.match(sql, /set_config\('founderops\.trash_lifecycle_write', 'on', true\)/);
    assert.match(sql, /set_config\('founderops\.trash_lifecycle_write', 'off', true\)/);
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
    assert.match(sql, /'blockedExpiredRoots'/);
    assert.match(sql, /task\.parent_task_id is null/);
    assert.match(sql, /child\.task_type <> 'sub_issue'/);
    assert.match(sql, /child\.package_id is distinct from v_root_package_id/);
    assert.match(sql, /descendant\.parent_task_id in/);
    assert.match(sql, /external_task\.parent_task_id in/);
    assert.match(sql, /external_task\.package_id is distinct from p_root_id/);
    assert.match(sql, /task\.trashed_at is not distinct from v_root_trashed_at/);
    assert.match(sql, /task\.purge_after is not distinct from v_root_purge_after/);
    assert.match(sql, /task\.trash_cause is not distinct from v_root_trash_cause/);
    assert.match(sql, /exit when v_locked_roots >= v_limit/);
    assert.match(sql, /perform task\.id[\s\S]*order by task\.id[\s\S]*for update/);
    assert.match(sql, /expired_probe as/);
    assert.match(sql, /grant all on function public\.purge_expired_planning_trash_batch[^]*to service_role/);
    assert.match(sql, /revoke all on function public\.purge_expired_planning_trash_batch[^]*from public/);
  }
  const initiativeCandidates = migration.match(/with initiative_candidates as \(([\s\S]*?)\), deliverable_candidates as/)?.[1] || "";
  const deliverableCandidates = migration.match(/deliverable_candidates as \(([\s\S]*?)\), candidate_roots as/)?.[1] || "";
  for (const candidates of [initiativeCandidates, deliverableCandidates]) {
    assert.match(candidates, /limit v_scan_limit/);
    assert.doesNotMatch(candidates, /planning_trash_root_is_purge_eligible|for update/);
  }
});

test("purge retains audit and notification history while removing only eligible source rows", async () => {
  const migration = await readSupabaseSchemaContract();
  const migrationWithoutRetiredAgentAuditCleanup = migration.replace(
    /delete from public\.audit_log\s+where action = 'agent\.task_intake\.create';/gi,
    "",
  );

  assert.match(migration, /set status = 'resolved'/);
  assert.match(migration, /resolution_reason = coalesce\(notification\.resolution_reason, 'source_purged'\)/);
  assert.match(migration, /insert into public\.audit_log/);
  assert.match(migration, /'planning_trash\.purge'/);
  assert.match(migration, /delete from public\.tasks/);
  assert.match(migration, /delete from public\.packages/);
  assert.doesNotMatch(migrationWithoutRetiredAgentAuditCleanup, /delete from public\.audit_log/i);
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
  assert.match(lifecycleRoute, /planning_github_lifecycle_outbox/);
  assert.match(lifecycleRoute, /\.eq\("status", "failed"\)/);
  assert.match(lifecycleRoute, /\.neq\("status", "completed"\)/);
  assert.match(lifecycleRoute, /terminalFailed/);
  assert.match(lifecycleRoute, /outstandingLifecycleJobs/);
  assert.match(route, /parsePlanningTrashPurgeResult/);
});

test("purge API result parsing fails closed on missing or malformed safety metrics", () => {
  const valid = {
    busy: false,
    purgedRoots: 1,
    purgedTasks: 2,
    resolvedNotifications: 0,
    blockedExpiredRoots: 0,
    hasMore: false,
  };
  assert.deepEqual(parsePlanningTrashPurgeResult(valid), valid);

  for (const invalid of [
    null,
    {},
    { ...valid, blockedExpiredRoots: undefined },
    { ...valid, blockedExpiredRoots: "0" },
    { ...valid, blockedExpiredRoots: -1 },
    { ...valid, busy: 0 },
    { ...valid, hasMore: null },
    { ...valid, purgedRoots: 26 },
    { ...valid, purgedTasks: Number.NaN },
  ]) {
    assert.equal(parsePlanningTrashPurgeResult(invalid), null);
  }
});
