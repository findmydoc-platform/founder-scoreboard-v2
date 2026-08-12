import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const { getPlanningDataScopeForWorkspace } = await loadTranspiledModule(
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
    "./planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
    "./planning-profile-mappers": {
      mapLegacyMilestoneFromEpic: (item) => item,
      mapLegacyPackageFromInitiative: (item) => item,
    },
    "./sprint-review-window": { DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS: 48 },
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
  "decision-log": ["projects", "profiles", "profile_ui_preferences", "profile_feature_tour_acknowledgements"],
  sprint: ["projects", "profiles", "active_tasks", "planning_item_strategy", "planning_item_raci_assignments", "task_links", "sprints", "sprint_commitments", "founder_sprint_scores", "founder_strike_state", "strike_events", "score_objections", "profile_ui_preferences", "profile_feature_tour_acknowledgements", "meetings", "meeting_attendance"],
};

for (const [workspace, expectedTables] of Object.entries(expectedTablesByWorkspace)) {
  test(`${workspace} only queries collections used by its workspace`, async () => {
    const supabase = recordingSupabase();
    await loadPlanningDataRows(supabase, getPlanningDataScopeForWorkspace(workspace));
    assert.deepEqual(supabase.queriedTables, expectedTables);
  });
}

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

test("planning mapping removes task-scoped rows that belong to inactive tasks", async () => {
  const supabase = recordingSupabase();
  const rows = await loadPlanningDataRows(supabase);
  rows.taskResult.data = [{ id: "active-task", taskType: "deliverable", approvalStatus: "approved" }];
  rows.taskCommentResult.data = [{ id: 1, task_id: "active-task" }, { id: 2, task_id: "trashed-task" }];
  rows.taskExternalCommentResult.data = [{ id: 1, task_id: "trashed-task" }];
  rows.taskBlockerResult.data = [{ id: 1, task_id: "active-task" }];
  rows.taskRelationResult.data = [
    { id: 1, task_id: "active-task", related_task_id: "active-task" },
    { id: 2, task_id: "active-task", related_task_id: "trashed-task" },
  ];
  rows.taskActivityResult.data = [{ id: 1, task_id: "trashed-task" }];
  rows.taskFocusResult.data = [{ id: 1, task_id: "active-task" }];

  const data = mapPlanningDataRows(rows);

  assert.deepEqual(data.taskComments.map((row) => row.id), [1]);
  assert.deepEqual(data.taskExternalComments, []);
  assert.deepEqual(data.taskBlockers.map((row) => row.id), [1]);
  assert.deepEqual(data.taskRelations.map((row) => row.id), [1]);
  assert.deepEqual(data.taskActivity, []);
  assert.deepEqual(data.taskFocusItems.map((row) => row.id), [1]);
});
