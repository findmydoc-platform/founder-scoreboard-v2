import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const mocks = {
  "@/lib/status": { normalizeStatus: (status) => status },
  "@/features/tasks/model/task-attention-signals": { taskHasCriticalAttention: () => false },
  "@/lib/platform": { hasGitHubIssue: () => true },
};

const emptyProjectRelations = { taskBlockers: [], taskRelations: [] };

test("project hierarchy search finds epics and empty initiatives", async () => {
  const { buildProjectsFilterViewModel } = await importTestModule(
    "src/features/projects/model/projects-filter-view-model.ts",
    mocks,
  );
  const tasks = [
    {
      id: "epic-expansion",
      taskType: "epic",
      title: "Expansion 2027",
      description: "New market preparation",
      status: "planned",
      order: 1,
    },
    {
      id: "initiative-empty",
      taskType: "initiative",
      parentTaskId: "epic-expansion",
      title: "Leere Initiative",
      description: "",
      strategy: { goal: "Prepare later" },
      priority: "P2",
      order: 1,
    },
  ];

  const byEpic = buildProjectsFilterViewModel({
    data: emptyProjectRelations,
    tasks,
    filters: {
      query: "Expansion", owner: "Alle", status: "Alle", priority: "Alle", epic: "Alle",
      initiative: "Alle", risk: "all", from: "", to: "", sort: "title", direction: "asc",
    },
  });
  const byInitiative = buildProjectsFilterViewModel({
    data: emptyProjectRelations,
    tasks,
    filters: {
      query: "Leere Initiative", owner: "Alle", status: "Alle", priority: "Alle", epic: "Alle",
      initiative: "Alle", risk: "all", from: "", to: "", sort: "title", direction: "asc",
    },
  });

  assert.equal(byEpic.hierarchy[0].epic.id, "epic-expansion");
  assert.equal(byEpic.hierarchy[0].initiatives[0].initiative.id, "initiative-empty");
  assert.equal(byInitiative.hierarchy[0].initiatives[0].initiative.id, "initiative-empty");
  assert.equal(byInitiative.visibleCount, 2);
  assert.equal(byInitiative.totalCount, 2);
});

test("deliverable filters combine with AND and keep table sorting stable", async () => {
  const { buildProjectsFilterViewModel, DEFAULT_PROJECTS_FILTERS } = await importTestModule(
    "src/features/projects/model/projects-filter-view-model.ts",
    mocks,
  );
  const tasks = [
    { id: "e1", taskType: "epic", title: "Epic", description: "", status: "planned", order: 1 },
    { id: "i1", taskType: "initiative", parentTaskId: "e1", title: "Initiative", description: "", priority: "P1", order: 1 },
    { id: "later", order: 2, taskType: "deliverable", title: "Same", description: "", parentTaskId: "i1", assigneeId: "p1", assignee: "Ada", status: "Offen", priority: "P1", hours: 2, fixedDate: "2026-07-15" },
    { id: "first", order: 1, taskType: "deliverable", title: "Same", description: "", parentTaskId: "i1", assigneeId: "p1", assignee: "Ada", status: "Offen", priority: "P1", hours: 1, fixedDate: "2026-07-10" },
    { id: "other", order: 3, taskType: "deliverable", title: "Other", description: "", parentTaskId: "i1", assigneeId: "p2", assignee: "Bob", status: "Erledigt", priority: "P2", hours: 1, fixedDate: "2026-07-10" },
  ];
  const filters = { ...DEFAULT_PROJECTS_FILTERS, owner: "p1", status: "Offen", priority: "P1", to: "2026-07-31" };
  const model = buildProjectsFilterViewModel({ data: emptyProjectRelations, tasks, filters });
  assert.deepEqual(model.hierarchy[0].tasks.map((task) => task.id), ["first", "later"]);
  assert.equal(model.totalCount, 5);
  assert.equal(buildProjectsFilterViewModel({ data: emptyProjectRelations, tasks, filters: { ...filters, query: "missing" } }).hierarchy.length, 0);
});

test("project hierarchy distinguishes true empty data from orphan initiatives", async () => {
  const { buildProjectsFilterViewModel, DEFAULT_PROJECTS_FILTERS } = await importTestModule(
    "src/features/projects/model/projects-filter-view-model.ts",
    mocks,
  );

  const empty = buildProjectsFilterViewModel({
    data: emptyProjectRelations,
    tasks: [],
    filters: DEFAULT_PROJECTS_FILTERS,
  });
  assert.deepEqual(empty.hierarchy, []);
  assert.equal(empty.totalCount, 0);

  const withOrphan = buildProjectsFilterViewModel({
    data: emptyProjectRelations,
    tasks: [
      { id: "e1", taskType: "epic", title: "Real", description: "", status: "planned", order: 1 },
      { id: "i1", taskType: "initiative", parentTaskId: "e1", title: "Assigned", description: "", priority: "P1", order: 1 },
      { id: "i2", taskType: "initiative", parentTaskId: "missing", title: "Orphan", description: "", priority: "P2", order: 2 },
    ],
    filters: DEFAULT_PROJECTS_FILTERS,
  });
  assert.deepEqual(withOrphan.hierarchy.map((entry) => entry.epic?.title || "Ohne Epic"), ["Real", "Ohne Epic"]);
  assert.equal(withOrphan.hierarchy[1].initiatives[0].initiative.id, "i2");
  assert.equal(withOrphan.totalCount, 4);
});
