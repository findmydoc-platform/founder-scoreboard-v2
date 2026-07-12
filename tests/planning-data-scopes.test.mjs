import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const { getPlanningDataScopeForWorkspace, taskDetailPageDataScope } = await loadTranspiledModule(
  "src/lib/planning-data-scopes.ts",
);

const identityMappers = new Proxy({}, {
  get: () => (row) => row,
});
const { loadPlanningDataRows, mapPlanningDataRows } = await loadTranspiledModule(
  "src/lib/planning-data-loader.ts",
  {
    "./planning-data-mappers": identityMappers,
    "./planning-data-row-types": { taskRowSelect: "id" },
  },
);

function recordingSupabase() {
  const queriedTables = [];
  return {
    queriedTables,
    from(table) {
      queriedTables.push(table);
      const result = {
        data: table === "projects"
          ? { id: "findmydoc-founder-execution", name: "findmydoc Planning", range_label: "" }
          : [],
        error: null,
      };
      const query = {
        select() { return query; },
        eq() { return query; },
        single() { return query; },
        order() { return query; },
        limit() { return query; },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
      return query;
    },
  };
}

const expectedTablesByWorkspace = {
  planning: ["projects", "profiles", "packages", "milestones", "tasks", "sprints", "task_relationship_edges", "profile_ui_preferences", "profile_feature_tour_acknowledgements"],
  backlog: ["projects", "profiles", "packages", "milestones", "tasks", "sprints", "sprint_commitments", "profile_ui_preferences", "profile_feature_tour_acknowledgements"],
  reviews: ["projects", "profiles", "packages", "milestones", "tasks", "sprints", "task_relationship_edges", "profile_ui_preferences", "profile_feature_tour_acknowledgements"],
  events: ["projects", "profiles", "profile_ui_preferences", "profile_feature_tour_acknowledgements", "founder_events"],
  sprint: ["projects", "profiles", "packages", "milestones", "tasks", "sprints", "sprint_commitments", "founder_sprint_scores", "founder_strike_state", "strike_events", "score_objections", "profile_ui_preferences", "profile_feature_tour_acknowledgements", "meetings", "meeting_attendance"],
  projects: ["projects", "profiles", "packages", "milestones", "tasks", "sprints", "task_relationship_edges", "profile_ui_preferences", "profile_feature_tour_acknowledgements"],
  tools: ["projects", "profiles", "profile_ui_preferences", "profile_feature_tour_acknowledgements", "fmd_tools"],
  team: ["projects", "profiles", "tasks", "profile_ui_preferences", "profile_feature_tour_acknowledgements"],
  notifications: ["projects", "profiles", "tasks", "notification_events", "notification_deliveries", "profile_ui_preferences", "profile_feature_tour_acknowledgements"],
  "ceo-intake": ["projects", "profiles", "packages", "sprints", "profile_ui_preferences", "profile_feature_tour_acknowledgements"],
  profile: ["projects", "profiles", "packages", "notification_preferences", "profile_ui_preferences", "profile_feature_tour_acknowledgements"],
};

for (const [workspace, expectedTables] of Object.entries(expectedTablesByWorkspace)) {
  test(`${workspace} only queries collections used by its workspace`, async () => {
    const supabase = recordingSupabase();
    await loadPlanningDataRows(supabase, getPlanningDataScopeForWorkspace(workspace));
    assert.deepEqual(supabase.queriedTables, expectedTables);
  });
}

test("task detail keeps every core collection while loading detail rows separately", async () => {
  const supabase = recordingSupabase();
  await loadPlanningDataRows(supabase, taskDetailPageDataScope);
  assert.deepEqual(supabase.queriedTables, [
    "projects",
    "profiles",
    "packages",
    "milestones",
    "tasks",
    "sprints",
    "profile_ui_preferences",
    "profile_feature_tour_acknowledgements",
  ]);
});

test("skipped collections keep the PlanningData response shape as empty arrays", async () => {
  const supabase = recordingSupabase();
  const rows = await loadPlanningDataRows(supabase, getPlanningDataScopeForWorkspace("tools"));
  const data = mapPlanningDataRows(rows);

  assert.deepEqual(data.packages, []);
  assert.deepEqual(data.milestones, []);
  assert.deepEqual(data.tasks, []);
  assert.deepEqual(data.sprints, []);
  assert.deepEqual(data.taskRelations, []);
  assert.deepEqual(data.fmdTools, []);
});
