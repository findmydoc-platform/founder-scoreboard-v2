import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

test("project hierarchy search finds milestones and empty initiatives", async () => {
  const { buildProjectsFilterViewModel } = await loadTranspiledModule(
    "src/features/projects/model/projects-filter-view-model.ts",
    {
      "@/lib/status": { normalizeStatus: (status) => status },
      "@/features/tasks/model/task-attention-signals": { taskHasCriticalAttention: () => false },
      "@/lib/platform": { hasGitHubIssue: () => true },
    },
  );
  const data = {
    milestones: [{
      id: "milestone-expansion",
      title: "Expansion 2027",
      description: "New market preparation",
      targetDate: "",
      status: "planned",
      sortOrder: 1,
    }],
    packages: [{
      id: "initiative-empty",
      milestoneId: "milestone-expansion",
      title: "Leere Initiative",
      goal: "Prepare later",
      priority: "P2",
      sortOrder: 1,
    }],
  };

  const byMilestone = buildProjectsFilterViewModel({
    data,
    tasks: [],
    filters: {
      query: "Expansion", owner: "Alle", status: "Alle", priority: "Alle", milestone: "Alle",
      initiative: "Alle", risk: "all", from: "", to: "", sort: "title", direction: "asc",
    },
  });
  const byInitiative = buildProjectsFilterViewModel({
    data,
    tasks: [],
    filters: {
      query: "Leere Initiative", owner: "Alle", status: "Alle", priority: "Alle", milestone: "Alle",
      initiative: "Alle", risk: "all", from: "", to: "", sort: "title", direction: "asc",
    },
  });

  assert.equal(byMilestone.hierarchy[0].milestone.id, "milestone-expansion");
  assert.equal(byMilestone.hierarchy[0].initiatives[0].initiative.id, "initiative-empty");
  assert.equal(byInitiative.hierarchy[0].initiatives[0].initiative.id, "initiative-empty");
  assert.equal(byInitiative.visibleCount, 2);
  assert.equal(byInitiative.totalCount, 2);
});

test("deliverable filters combine with AND and keep table sorting stable", async () => {
  const { buildProjectsFilterViewModel, DEFAULT_PROJECTS_FILTERS } = await loadTranspiledModule(
    "src/features/projects/model/projects-filter-view-model.ts",
    {
      "@/lib/status": { normalizeStatus: (status) => status },
      "@/features/tasks/model/task-attention-signals": { taskHasCriticalAttention: () => false },
      "@/lib/platform": { hasGitHubIssue: () => true },
    },
  );
  const data = {
    milestones: [{ id: "m1", title: "Milestone", description: "", targetDate: "", status: "planned", sortOrder: 1 }],
    packages: [{ id: "i1", milestoneId: "m1", title: "Initiative", goal: "", priority: "P1", sortOrder: 1 }],
  };
  const tasks = [
    { id: "later", order: 2, taskType: "deliverable", title: "Same", description: "", packageId: "i1", assigneeId: "p1", assignee: "Ada", status: "Offen", priority: "P1", hours: 2, deadline: "2026-07-15" },
    { id: "first", order: 1, taskType: "deliverable", title: "Same", description: "", packageId: "i1", assigneeId: "p1", assignee: "Ada", status: "Offen", priority: "P1", hours: 1, deadline: "2026-07-10" },
    { id: "other", order: 3, taskType: "deliverable", title: "Other", description: "", packageId: "i1", assigneeId: "p2", assignee: "Bob", status: "Erledigt", priority: "P2", hours: 1, deadline: "2026-07-10" },
  ];
  const filters = { ...DEFAULT_PROJECTS_FILTERS, owner: "p1", status: "Offen", priority: "P1", to: "2026-07-31" };
  const model = buildProjectsFilterViewModel({ data, tasks, filters });
  assert.deepEqual(model.hierarchy[0].tasks.map((task) => task.id), ["first", "later"]);
  assert.equal(model.totalCount, 5);
  assert.equal(buildProjectsFilterViewModel({ data, tasks, filters: { ...filters, query: "missing" } }).hierarchy.length, 0);
});
