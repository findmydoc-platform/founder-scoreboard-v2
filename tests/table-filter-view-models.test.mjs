import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const statusMock = { normalizeStatus: (status) => status };
const platformMock = {
  hasGitHubIssue: (task) => Boolean(task.githubIssueUrl),
  hasOpenWaitingRelation: () => false,
  taskBelongsToProfile: (task, profile) => task.assigneeId === profile?.id,
};

test("planning task view model combines fields with AND and quick values with OR", async () => {
  const { buildPlanningTaskTableViewModel } = await loadTranspiledModule(
    "src/features/planning/model/planning-task-table-view-model.ts",
    {
      "@/features/planning/model/planning-app-model": {
        isThisWeek: () => false,
        sortTasks: (tasks) => tasks,
        taskText: (task) => `${task.title} ${task.description}`,
      },
      "@/features/tasks/model/task-attention-signals": {
        taskHasCriticalAttention: (task) => task.id === "critical",
        taskHasMissingEvidenceAttention: () => false,
      },
      "@/lib/platform": platformMock,
      "@/lib/status": statusMock,
    },
  );
  const tasks = [
    { id: "mine", order: 1, title: "Alpha", description: "", taskType: "deliverable", status: "Offen", priority: "P2", assigneeId: "p1", assignee: "Ada", packageId: "i1", sprintId: "s1", workstream: "Product", deadline: "2026-07-15" },
    { id: "critical", order: 2, title: "Beta", description: "", taskType: "deliverable", status: "In Arbeit", priority: "P0", assigneeId: "p2", assignee: "Bob", packageId: "i1", sprintId: "s1", workstream: "Product", deadline: "2026-07-20" },
    { id: "other", order: 3, title: "Gamma", description: "", taskType: "deliverable", status: "Offen", priority: "P0", assigneeId: "p2", assignee: "Bob", packageId: "i2", sprintId: "s2", workstream: "Sales", deadline: "2026-08-01" },
  ];
  const data = { tasks, packages: [{ id: "i1", title: "Launch", goal: "" }], sprints: [{ id: "s1", name: "Sprint 1" }], profiles: [], taskRelations: [], taskBlockers: [] };
  const filters = {
    query: "", assignee: "Alle", status: "Alle", priority: "P0", packageId: "Alle",
    quick: ["mine", "critical"], sprintId: "s1", workstream: "Product", risk: "Alle",
    targetFrom: "", targetTo: "2026-07-31", sort: "priority", direction: "asc",
  };
  const model = buildPlanningTaskTableViewModel({ currentProfile: { id: "p1" }, data, filters });

  assert.deepEqual(model.visibleTasks.map((task) => task.id), ["critical"]);
  assert.equal(model.metrics.total, 1);
  assert.deepEqual(buildPlanningTaskTableViewModel({ currentProfile: null, data, filters: { ...filters, query: "missing" } }).visibleTasks, []);
});

test("sprint task table filters review and score and sorts deterministically", async () => {
  const { buildSprintTaskTableRows, DEFAULT_SPRINT_TASK_FILTERS } = await loadTranspiledModule(
    "src/features/sprint/model/sprint-task-table-view-model.ts",
    { "@/lib/platform": platformMock, "@/lib/status": statusMock },
  );
  const tasks = [
    { id: "b", order: 2, title: "Beta", description: "", status: "Review", priority: "P1", assignee: "Bob", sprintId: "s1", reviewStatus: "requested", scoreFinal: false, scorePoints: 0 },
    { id: "a", order: 1, title: "Alpha", description: "", status: "Review", priority: "P1", assignee: "Ada", sprintId: "s1", reviewStatus: "accepted", scoreFinal: true, scorePoints: 2 },
  ];
  assert.deepEqual(buildSprintTaskTableRows(tasks, { sprints: [] }, DEFAULT_SPRINT_TASK_FILTERS).map((task) => task.id), ["a", "b"]);
  assert.deepEqual(buildSprintTaskTableRows(tasks, { sprints: [] }, { ...DEFAULT_SPRINT_TASK_FILTERS, review: "requested", score: "open" }).map((task) => task.id), ["b"]);
  assert.deepEqual(buildSprintTaskTableRows(tasks, { sprints: [] }, { ...DEFAULT_SPRINT_TASK_FILTERS, query: "none" }), []);
});

test("Founder Score view model filters attention signals and reports its own count", async () => {
  const { buildSprintScoreTableViewModel, DEFAULT_SPRINT_SCORE_FILTERS } = await loadTranspiledModule(
    "src/features/sprint/model/sprint-score-table-view-model.ts",
  );
  const row = (name, overrides = {}) => ({
    profile: { name, platformRole: "founder" }, commitment: { commitmentLevel: "committed" }, committed: 2,
    hours: 4, openScore: 0, openScoreObjections: 0, v21Score: { fulfilled: true, awayNeutral: false, totalPoints: 2 },
    strikeState: { strikeLevel: 0 }, ...overrides,
  });
  const rows = [row("Ada"), row("Bob", { openScore: 1, v21Score: { fulfilled: false, awayNeutral: false, totalPoints: 0 } })];
  const model = buildSprintScoreTableViewModel(rows, { ...DEFAULT_SPRINT_SCORE_FILTERS, attention: "open" });
  assert.deepEqual(model.visibleRows.map((item) => item.profile.name), ["Bob"]);
  assert.equal(model.totalCount, 2);
  assert.deepEqual(buildSprintScoreTableViewModel(rows, { ...DEFAULT_SPRINT_SCORE_FILTERS, query: "nobody" }).visibleRows, []);
});

test("weekly attendance view model combines founder and signal filters", async () => {
  const { buildSprintAttendanceTableViewModel, DEFAULT_SPRINT_ATTENDANCE_FILTERS } = await loadTranspiledModule(
    "src/features/sprint/model/sprint-attendance-table-view-model.ts",
  );
  const meetings = [{ id: 1, title: "Weekly 1", meetingAt: "2026-07-10" }];
  const data = {
    profiles: [{ id: "p1", name: "Ada" }, { id: "p2", name: "Bob" }],
    meetingAttendance: [
      { meetingId: 1, profileId: "p1", status: "present", absenceReason: "", reasonAccepted: false, writtenUpdate: "Done", points: 2 },
      { meetingId: 1, profileId: "p2", status: "absent", absenceReason: "Travel", reasonAccepted: false, writtenUpdate: "", points: 0 },
    ],
  };
  const model = buildSprintAttendanceTableViewModel({ data, meetings, filters: { ...DEFAULT_SPRINT_ATTENDANCE_FILTERS, founder: "p2", signal: "open_reason" } });
  assert.deepEqual(model.visibleRows.map((row) => row.profile.id), ["p2"]);
  assert.equal(model.totalCount, 2);
  assert.deepEqual(buildSprintAttendanceTableViewModel({ data, meetings, filters: { ...DEFAULT_SPRINT_ATTENDANCE_FILTERS, query: "missing" } }).visibleRows, []);
});

test("task table view model applies a stable secondary order", async () => {
  const { buildTaskTableViewModel } = await loadTranspiledModule(
    "src/features/tasks/model/task-table-view-model.ts",
    {
      "@/lib/display": { taskAssigneeOptions: () => [] },
      "@/lib/status": statusMock,
    },
  );
  const tasks = [
    { id: "later", order: 2, title: "Same", priority: "P1", status: "Offen", assignee: "", sprintId: "", startDate: "", deadline: "", endDate: "" },
    { id: "first", order: 1, title: "Same", priority: "P1", status: "Offen", assignee: "", sprintId: "", startDate: "", deadline: "", endDate: "" },
  ];
  const model = buildTaskTableViewModel({ tasks, profiles: [], sprints: [], filters: { sort: "title", direction: "asc" } });
  assert.deepEqual(model.rows.map((task) => task.id), ["first", "later"]);
  assert.equal(model.totalCount, 2);
});

