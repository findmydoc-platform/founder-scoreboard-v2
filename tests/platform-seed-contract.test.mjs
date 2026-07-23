import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

async function readSeedSource() {
  return JSON.parse(await readFile("src/lib/seed/source.json", "utf8"));
}

test("source.json is the single maintained local seed data source", async () => {
  const packageJson = await readFile("package.json", "utf8");
  const shared = await readFile("src/lib/seed/shared.ts", "utf8");
  const runner = await readFile("scripts/local-development.mjs", "utf8");

  assert.ok(existsSync("src/lib/seed/source.json"));
  assert.equal(existsSync("supabase/seed.sql"), false);
  assert.match(shared, /from "\.\/source\.json"/);
  assert.match(runner, /src\/lib\/seed\/source\.json/);
  assert.match(packageJson, /"local:seed": "node scripts\/local-development\.mjs seed"/);
});

test("local seed covers planning roles and stable core data", async () => {
  const source = await readSeedSource();
  const profileById = new Map(source.profiles.map((profile) => [profile.id, profile]));
  const packageIds = new Set(source.packages.map((item) => item.id));
  const taskIds = source.tasks.map((task) => task.id);

  assert.equal(source.project.id, "findmydoc-founder-execution");
  assert.deepEqual(source.packages.map((item) => item.id), ["GC1", "GC2", "GC3", "GC4", "GC5"]);
  assert.ok(source.tasks.length > 0);
  assert.equal(new Set(taskIds).size, taskIds.length);
  assert.ok(taskIds.includes("sebastian-contact-404-beheben-oder-links-umstellen"));
  assert.ok(source.tasks.every((task) => packageIds.has(task.packageId)));
  assert.ok(source.tasks.every((task) => profileById.has(task.assigneeId)));
  assert.equal(source.fmdTools.length, 11);
  assert.equal(profileById.get("volkan")?.platformRole, "ceo");
  assert.equal(profileById.get("local-deputy")?.platformRole, "deputy");
  assert.equal(profileById.get("local-deputy")?.deputyFor, "volkan");
  assert.equal(profileById.get("local-viewer")?.platformRole, "viewer");
});

test("planning data fails closed without Supabase and has no browser fallback", async () => {
  const planningData = await readFile("src/lib/planning-data.ts", "utf8");
  const bootstrap = await readFile("src/features/planning/hooks/use-planning-bootstrap-state.ts", "utf8");
  const header = await readFile("src/features/planning/organisms/planning-header.tsx", "utf8");

  assert.match(planningData, /if \(!supabase\) return planningDataFailureResult\(\)/);
  assert.match(planningData, /source: "supabase"[\s\S]*availability: "unavailable"/);
  assert.doesNotMatch(planningData, /source: "seed"|allowsLocalPlanningFallback/);
  assert.doesNotMatch(bootstrap, /useLocalPlanningState|localStateLoaded/);
  assert.doesNotMatch(header, /Beispieldaten laden|demoSeedImport/);
  assert.equal(existsSync("src/features/planning/hooks/use-local-planning-state.ts"), false);
  assert.equal(existsSync("src/features/planning/hooks/use-demo-seed-import.ts"), false);
  assert.equal(existsSync("src/app/api/demo-seed/import/route.ts"), false);
});

test("local database commands are loopback guarded and seed a real auth identity", async () => {
  const packageJson = await readFile("package.json", "utf8");
  const runner = await readFile("scripts/local-development.mjs", "utf8");
  const authz = await readFile("src/lib/authz.ts", "utf8");

  for (const command of ["local:start", "local:reset", "local:seed", "local:stop", "dev:local", "test:integration:local"]) {
    assert.match(packageJson, new RegExp(`"${command.replace(":", "\\:")}"`));
  }
  assert.match(runner, /assertLocalUrl\(status\.API_URL, "54321"/);
  assert.match(runner, /assertLocalUrl\(status\.DB_URL, "54322"/);
  assert.match(runner, /auth\.admin\.createUser/);
  assert.match(runner, /auth\.admin\.updateUserById/);
  assert.match(runner, /update profiles set auth_user_id=\$1 where id=\$2/);
  assert.match(runner, /LOCAL_LOGIN_PASSWORD: current\.LOCAL_LOGIN_PASSWORD \|\| randomBytes/);
  assert.match(runner, /NEXT_PUBLIC_ENABLE_LOCAL_LOGIN: "true"/);
  assert.match(runner, /spawnSync\(nextCli, \["dev", "--hostname", "127\.0\.0\.1"\]/);
  assert.match(runner, /delete from projects where id=\$1/);
  assert.match(runner, /github_project_owner/);
  assert.match(runner, /github_project_number/);
  assert.match(authz, /isLocalLoginRequestAllowed/);
});

test("local GitHub button creates the simulated Supabase login only behind local gates", async () => {
  const route = await readFile("src/app/api/auth/local-login/route.ts", "utf8");
  const policy = await readFile("src/lib/local-development-auth.ts", "utf8");
  const authHook = await readFile("src/features/planning/hooks/use-planning-auth.ts", "utf8");

  assert.match(route, /export async function POST/);
  assert.match(route, /isLocalLoginRequestAllowed/);
  assert.match(route, /signInWithPassword/);
  assert.doesNotMatch(route, /signInWithOAuth|github/);
  assert.match(policy, /NODE_ENV === "development"/);
  assert.match(policy, /ENABLE_LOCAL_LOGIN === "true"/);
  assert.match(policy, /isLoopbackRequestHost/);
  assert.match(policy, /isLoopbackSupabaseUrl/);
  assert.match(authHook, /fetch\("\/api\/auth\/local-login", \{ method: "POST" \}\)/);
  assert.match(authHook, /signInWithOAuth/);
});
