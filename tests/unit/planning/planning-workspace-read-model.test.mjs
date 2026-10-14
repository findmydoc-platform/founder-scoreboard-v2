import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

function createSupabaseFixture(failedTable = "") {
  const calls = [];
  const data = {
    projects: { id: "findmydoc-founder-execution", name: "findmydoc Planning", range_label: "", review_objection_window_hours: 48 },
    profiles: [{ id: "person", name: "Person", github_login: "person-login" }],
    active_tasks: [
      { id: "epic", task_type: "epic", parent_task_id: null, approval_status: "not_required", updated_at: "2026-08-10T00:00:00.000Z" },
      { id: "initiative", task_type: "initiative", parent_task_id: "epic", approval_status: "approved", updated_at: "2026-08-11T00:00:00.000Z" },
      { id: "deliverable", task_type: "deliverable", parent_task_id: "initiative", approval_status: "approved", updated_at: "2026-08-12T00:00:00.000Z" },
    ],
    planning_item_strategy: [],
    planning_item_raci_assignments: [],
    task_links: [],
    sprints: [{ id: "sprint" }],
    task_relationship_edges: [
      { id: 1, task_id: "deliverable", related_task_id: "initiative", relation_type: "relates_to" },
      { id: 2, task_id: "deliverable", related_task_id: "inactive", relation_type: "relates_to" },
    ],
    profile_ui_preferences: [{ profile_id: "person" }],
  };
  return {
    calls,
    from(table) {
      const call = { table, eq: [], orders: [], limit: null, select: "" };
      calls.push(call);
      const query = {
        select(columns) { call.select = columns; return query; },
        eq(field, value) { call.eq.push([field, value]); return query; },
        single() { return query; },
        order(field, options) { call.orders.push([field, options]); return query; },
        limit(value) { call.limit = value; return query; },
        then(resolve, reject) {
          const result = table === failedTable
            ? { data: null, error: { message: "fixture failure" } }
            : { data: data[table] ?? [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const moduleStubs = {
  "server-only": {},
  "@/lib/planning-row-mappers": { mapTaskRelation: (row) => ({ id: row.id, taskId: row.task_id, relatedTaskId: row.related_task_id, relationType: row.relation_type }) },
  "@/lib/planning-profile-mappers": {
    profileNameById: (profiles, id) => profiles.find((profile) => profile.id === id)?.name || id || "",
    mapProfile: (row) => ({ id: row.id, name: row.name, githubLogin: row.github_login || "" }),
    mapProfileUiPreference: (row) => ({ profileId: row.profile_id }),
  },
  "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
  "@/lib/planning-sprint-mappers": { mapSprint: (row) => row },
  "@/lib/sprint-review-window": { DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS: 48 },
  "@/features/planning-items/server/workspace-profile-avatars": {
    withWorkspaceProfileAvatars: async (profiles) => profiles.map((profile) => ({ ...profile, avatarUrl: "https://lh3.googleusercontent.com/a/profile" })),
  },
};

const { loadPlanningWorkspaceModel, mapPlanningSummaryRows } = await importTestModule(
  "src/features/planning-items/server/planning-workspace-read-source.ts",
  moduleStubs,
);

test("planning workspace reader fails closed and distinguishes dependency failure", async () => {
  const denied = createSupabaseFixture();
  assert.deepEqual(await loadPlanningWorkspaceModel(denied, { authorized: false, actorProfileId: null }), { status: "forbidden" });
  assert.equal(denied.calls.length, 0);
  const unavailable = createSupabaseFixture("task_relationship_edges");
  assert.deepEqual(await loadPlanningWorkspaceModel(unavailable, { authorized: true, actorProfileId: "person" }), { status: "unavailable" });
});

test("planning workspace reader loads only the focused canonical model", async () => {
  const supabase = createSupabaseFixture();
  const result = await loadPlanningWorkspaceModel(supabase, { authorized: true, actorProfileId: "person" });
  assert.equal(result.status, "ready");
  assert.equal(result.model.revision, "2026-08-12T00:00:00.000Z");
  assert.deepEqual(result.model.items.map(({ id }) => id), ["epic", "initiative", "deliverable"]);
  assert.equal(result.model.items.find(({ id }) => id === "deliverable").parentApprovalStatus, "approved");
  assert.deepEqual(result.model.relationships.map(({ id }) => id), [1]);
  assert.equal(result.model.people[0].githubLogin, "person-login");
  assert.equal(result.model.people[0].avatarUrl, "https://lh3.googleusercontent.com/a/profile");
  assert.deepEqual(Object.keys(result.model).sort(), ["items", "people", "preferences", "project", "relationships", "revision", "sprints"]);
  assert.deepEqual(supabase.calls.map(({ table }) => table), [
    "projects",
    "profiles",
    "active_tasks",
    "planning_item_strategy",
    "planning_item_raci_assignments",
    "task_links",
    "sprints",
    "task_relationship_edges",
    "profile_ui_preferences",
  ]);
  assert.equal(supabase.calls.find(({ table }) => table === "task_relationship_edges").limit, 500);
  const select = supabase.calls.find(({ table }) => table === "active_tasks").select;
  assert.doesNotMatch(select, /intended_outcome|scope_constraints|evidence_required|task_notes/);
  assert.match(select, /description/);
  assert.match(select, /acceptance_criteria/);
  assert.match(select, /definition_of_done/);
  for (const column of ["sprint_id", "target_date", "fixed_date", "parent_task_id", "assignee", "status", "priority", "workstream", "task_dependencies(note)"]) {
    assert.ok(select.includes(column), `${column} must remain in the summary query`);
  }
  assert.equal(result.model.items[0].detailAvailability, "summary");
  assert.match(supabase.calls.find(({ table }) => table === "profiles").select, /(?:^|,)github_login(?:,|$)/);
});

test("planning startup summaries omit detail briefs while preserving search, quality and sub-issue context", () => {
  const result = mapPlanningSummaryRows([{ id: "deliverable", task_type: "deliverable", description: "search context", problem_statement: "private brief", intended_outcome: "outcome", scope_constraints: "scope", evidence_required: "proof", acceptance_criteria: "criteria", definition_of_done: "search quality", sprint_id: "sprint-2", target_date: "2026-10-10", fixed_date: "2026-10-11", parent_task_id: "initiative", assignee: "owner", status: "In Arbeit", priority: "P1", workstream: "Engineering", task_dependencies: [{ note: "waiting" }] }], [], [], [], []);
  assert.equal(result[0].detailAvailability, "summary");
  assert.equal(result[0].problemStatement, "");
  assert.equal(result[0].intendedOutcome, "");
  assert.equal(result[0].scopeConstraints, "");
  assert.equal(result[0].evidenceRequired, "");
  assert.equal(result[0].description, "search context");
  assert.equal(result[0].definitionOfDone, "search quality");
  assert.equal(result[0].acceptanceCriteria, "criteria");
  assert.equal(result[0].sprintId, "sprint-2");
  assert.equal(result[0].targetDate, "2026-10-10");
  assert.equal(result[0].fixedDate, "2026-10-11");
  assert.equal(result[0].parentTaskId, "initiative");
  assert.equal(result[0].assigneeId, "owner");
  assert.equal(result[0].status, "In Arbeit");
  assert.equal(result[0].priority, "P1");
  assert.equal(result[0].workstream, "Engineering");
  assert.equal(result[0].dependsOn, "waiting");
  const [subIssue] = mapPlanningSummaryRows([{ id: "child", task_type: "sub_issue", problem_statement: "legacy context" }], [], [], [], []);
  assert.equal(subIssue.description, "legacy context");
});
