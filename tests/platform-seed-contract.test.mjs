import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

async function readSeedSource() {
  return JSON.parse(await readFile("src/lib/seed/source.json", "utf8"));
}

test("source.json is the single maintained seed data source", async () => {
  const legacyFullSeedPath = ["src/lib/seed/full", "data.ts"].join("-");
  const legacyLeanSeedPath = ["src/lib/seed/lean", "data.ts"].join("-");
  const legacySqlSeedPath = ["supabase", "seed.sql"].join("/");
  const legacyTerms = [
    "lean" + "Seed",
    "full" + "Seed",
    "lean" + "-data",
    "full" + "-data",
    "import" + ":legacy",
    "import" + "-dashboard",
  ];
  const legacyTermPattern = new RegExp(legacyTerms.join("|"));
  const packageJson = await readFile("package.json", "utf8");
  const index = await readFile("src/lib/seed/index.ts", "utf8");
  const data = await readFile("src/lib/seed/data.ts", "utf8");
  const shared = await readFile("src/lib/seed/shared.ts", "utf8");
  const planningData = await readFile("src/lib/planning-data.ts", "utf8");
  const loader = await readFile("src/lib/planning-data-loader.ts", "utf8");

  assert.ok(existsSync("src/lib/seed/source.json"), "source.json should be the maintained seed source");
  assert.equal(existsSync(legacyFullSeedPath), false, "legacy full seed source should not exist");
  assert.equal(existsSync(legacyLeanSeedPath), false, "legacy lean seed source should not exist");
  assert.equal(existsSync("src/lib/seed/tasks.ts"), false, "task definitions should live in source.json");
  assert.equal(existsSync(legacySqlSeedPath), false, "legacy SQL seed output should not be committed");

  assert.match(index, /export \{ seedData \} from "\.\/data"/);
  assert.match(data, /createPlanningSeed\(\)/);
  assert.match(shared, /from "\.\/source\.json"/);
  assert.match(planningData, /emptyPlanningData/);
  assert.doesNotMatch(planningData, /seedData/);
  assert.doesNotMatch(loader, /seedData/);

  for (const source of [packageJson, index, data, shared, planningData, loader]) {
    assert.doesNotMatch(source, legacyTermPattern);
  }
});

test("runtime fallback stays empty until the sample data button writes seed data", async () => {
  const planningData = await readFile("src/lib/planning-data.ts", "utf8");
  const availability = await readFile("src/lib/planning-data-availability.ts", "utf8");
  const loader = await readFile("src/lib/planning-data-loader.ts", "utf8");
  const route = await readFile("src/app/api/demo-seed/import/route.ts", "utf8");
  const helper = await readFile("src/lib/seed/demo-import.ts", "utf8");
  const importHook = await readFile("src/features/planning/hooks/use-demo-seed-import.ts", "utf8");
  const localStateHook = await readFile("src/features/planning/hooks/use-local-planning-state.ts", "utf8");

  assert.match(planningData, /if \(!supabase\) return planningDataFailureResult\(\)/);
  assert.match(planningData, /hasCorePlanningDataError\(rows\)[\s\S]*return planningDataFailureResult\(\)/);
  assert.match(planningData, /allowsLocalPlanningFallback\(\)[\s\S]*source: "seed"[\s\S]*availability: "ready"/);
  assert.match(planningData, /source: "supabase"[\s\S]*availability: "unavailable"/);
  assert.match(availability, /NODE_ENV === "development"/);
  assert.match(availability, /!environment\.VERCEL_ENV/);
  assert.match(availability, /environment\.CI !== "true"/);
  assert.doesNotMatch(planningData, /seedData/);
  assert.doesNotMatch(loader, /seedData/);
  assert.match(route, /importDemoSeed\(supabase\)/);
  assert.match(helper, /seedData/);
  assert.match(helper, /export function isDemoSeedImportButtonAvailable/);
  assert.match(importHook, /persistLocalPlanningData\(seedData\)/);
  assert.match(importHook, /setData\(seedData\)/);
  assert.match(localStateHook, /localDataKey = "fmd-planning-local-data-v1"/);
  assert.match(localStateHook, /window\.localStorage\.getItem\(localDataKey\)/);
});

test("seedData is assembled from source.json defaults and stable core ids", async () => {
  const source = await readSeedSource();
  const shared = await readFile("src/lib/seed/shared.ts", "utf8");
  const requiredDefaultKeys = [
    "status",
    "evidenceLink",
    "issueNumber",
    "issueUrl",
    "note",
    "watched",
    "sprintId",
    "reviewStatus",
    "scorePoints",
    "scoreFinal",
    "githubRepo",
    "githubIssueNumber",
    "githubIssueUrl",
    "githubSyncStatus",
    "githubLastSyncedAt",
    "githubSyncError",
    "taskType",
    "parentTaskId",
    "scoreRelevant",
  ];

  assert.match(shared, /export function createPlanningSeed/);
  assert.match(shared, /export function defineTask/);
  assert.match(shared, /profileNameById/);
  assert.match(shared, /const ownerId = input\.ownerId \|\| assigneeId/);
  assert.match(shared, /assignee: profileNameById\.get\(assigneeId\)/);

  assert.equal(source.project.id, "findmydoc-founder-execution");
  assert.deepEqual(source.profiles.map((profile) => profile.id), ["volkan", "sebastian", "anil", "ozen", "youssef"]);
  assert.deepEqual(source.packages.map((pkg) => pkg.id), ["GC1", "GC2", "GC3", "GC4", "GC5"]);
  assert.deepEqual(source.sprints.map((sprint) => sprint.id), ["sprint-1"]);
  assert.equal(source.fmdTools.length, 11);
  assert.deepEqual(source.fmdTools.map((tool) => tool.id), [
    "email-signature-tool",
    "investor-calculator",
    "liquidity-planning-calculator",
    "offer-calculator",
    "sebastian-crawler",
    "tool-repos",
    "clinic-outreach-crm",
    "notion-docs-source",
    "pitchdeck-site",
    "brand-asset-library",
    "google-drive-assets",
  ]);
  assert.equal(source.meetings.length, 1);
  assert.equal(source.tasks.length, 14);

  for (const key of requiredDefaultKeys) {
    assert.ok(Object.hasOwn(source.taskDefaults, key), `taskDefaults should centralize ${key}`);
  }

  for (const task of source.tasks) {
    assert.ok(task.assigneeId, `${task.id} should store assigneeId`);
    assert.equal(Object.hasOwn(task, "owner"), false, `${task.id} should not store display owner`);
    assert.equal(Object.hasOwn(task, "assignee"), false, `${task.id} should not store display assignee`);

    const expanded = { ...source.taskDefaults, ...task };
    for (const key of requiredDefaultKeys) {
      assert.ok(Object.hasOwn(expanded, key), `${task.id} should include defaulted ${key}`);
    }
  }
});

test("demo import route is local only and non destructive", async () => {
  const route = await readFile("src/app/api/demo-seed/import/route.ts", "utf8");
  const helper = await readFile("src/lib/seed/demo-import.ts", "utf8");

  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function GET/);
  assert.match(route, /getDemoSeedImportAvailability/);
  assert.match(route, /availability\.available/);
  assert.match(route, /getPlanningData/);
  assert.match(route, /source !== "seed"/);
  assert.match(route, /importDemoSeed\(supabase\)/);

  assert.match(helper, /seedData/);
  assert.match(helper, /bootstrapEmptyTables = \["projects", "profiles", "packages", "tasks", "sprints", "meetings"\]/);
  assert.match(helper, /export async function getDemoSeedImportAvailability/);
  assert.match(helper, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(helper, /SUPABASE_SECRET_KEY/);
  assert.match(helper, /process\.env\.NODE_ENV === "production"/);
  assert.match(helper, /process\.env\.NODE_ENV !== "production"/);
  assert.match(helper, /countRows/);
  assert.match(helper, /Object\.values\(counts\)\.every\(\(count\) => count === 0\)/);
  assert.match(helper, /leere Supabase-Bootstrap-Datenbank/);
  assert.match(helper, /\.from\("projects"\)\.upsert/);
  assert.match(helper, /\.from\("profiles"\)\.upsert/);
  assert.match(helper, /\.from\("packages"\)\.upsert/);
  assert.match(helper, /\.from\("sprints"\)\.upsert/);
  assert.match(helper, /\.from\("fmd_tools"\)\.upsert/);
  assert.match(helper, /\.from\("tasks"\)\.upsert/);
  assert.match(helper, /sourceTaskIds/);
  assert.match(helper, /\.from\("task_dependencies"\)\.delete\(\)\.in\("task_id", sourceTaskIds\)/);
  assert.doesNotMatch(helper, /\.from\("tasks"\)\.delete\(/);
});

test("header exposes gated sample data import before notifications", async () => {
  const header = await readFile("src/features/planning/organisms/planning-header.tsx", "utf8");
  const app = await readFile("src/features/planning/PlanningApp.tsx", "utf8");
  const page = await readFile("src/app/(workspaces)/workspace-page.tsx", "utf8");
  const controller = await readFile("src/features/planning/hooks/use-planning-app-controller.ts", "utf8");
  const commandRegistry = await readFile("src/features/planning/hooks/use-planning-command-registry.ts", "utf8");
  const hook = await readFile("src/features/planning/hooks/use-demo-seed-import.ts", "utf8");
  const apiClient = await readFile("src/features/planning/model/planning-api-client.ts", "utf8");

  assert.match(header, /Import/);
  assert.match(header, /demoSeedImportAvailable/);
  assert.match(header, /importDemoSeed/);
  assert.match(header, /Beispieldaten laden/);
  assert.match(header, /<Import size=\{16\}/);
  assert.ok(header.indexOf("Beispieldaten laden") < header.indexOf("<PlanningHeaderDataActions"), "sample data import should render before header data actions");

  assert.match(page, /isDemoSeedImportButtonAvailable/);
  assert.doesNotMatch(page, new RegExp("isDemoSeed" + "ImportAvailable"));
  assert.match(app, /demoSeedImportAvailable\?: boolean/);
  assert.match(controller, /demoSeedImportAvailable: source === "seed" && demoSeedImportAvailable && data\.tasks\.length === 0/);
  assert.match(controller, /demoSeedImportPending/);
  assert.match(commandRegistry, /useDemoSeedImport/);
  assert.match(hook, /window\.location\.reload\(\)/);
  assert.match(hook, /importDemoSeedRequest/);
  assert.match(hook, /source === "seed"/);
  assert.match(apiClient, /export function importDemoSeedRequest/);
  assert.match(apiClient, /\/api\/demo-seed\/import/);
  assert.match(apiClient, /method: "POST"/);
});
