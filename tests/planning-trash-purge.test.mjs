import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parsePlanningTrashPurgeResult } from "../src/lib/planning-trash-maintenance-result.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");





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
