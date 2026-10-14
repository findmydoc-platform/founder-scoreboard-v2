import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const baseFilters = {
  query: "",
  assignee: "Alle",
  status: "Alle",
  priority: "Alle",
  review: "Alle",
  initiativeId: "Alle",
  quick: ["mine"],
  sprintId: "Alle",
  workstream: "Alle",
  risk: "Alle",
  targetFrom: "",
  targetTo: "",
  sort: "priority",
  direction: "asc",
};

async function loadViewModel() {
  return importTestModule(
    "src/features/planning/model/planning-task-table-view-model.ts",
    {
      "@/features/planning/model/planning-app-model": {
        isThisWeek: () => false,
        sortTasks: (tasks) => tasks,
        taskText: (task) => `${task.title} ${task.description || ""}`,
      },
      "@/features/tasks/model/task-attention-signals": {
        taskHasCriticalAttention: () => false,
        taskHasMissingEvidenceAttention: () => false,
      },
      "@/lib/platform": {
        hasGitHubIssue: () => true,
        hasOpenWaitingRelation: () => false,
        taskBelongsToProfile: (task, profile) => task.assigneeId === profile?.id,
      },
      "@/lib/status": { normalizeStatus: (status) => status },
    },
  );
}

function planningTask(overrides = {}) {
  return {
    id: "task",
    order: 1,
    title: "Task",
    description: "",
    taskType: "deliverable",
    parentTaskId: "initiative-1",
    status: "In Arbeit",
    priority: "P2",
    assigneeId: "p2",
    assignee: "Volkan",
    sprintId: "sprint-1",
    workstream: "Operations",
    fixedDate: "",
    ...overrides,
  };
}

function planningData(tasks) {
  return {
    tasks,
    profiles: [],
    sprints: [],
    taskRelations: [],
    taskBlockers: [],
  };
}

test("My Deliverables includes a foreign parent while I have an open assigned Sub-Issue", async () => {
  const { buildPlanningTaskTableViewModel } = await loadViewModel();
  const data = {
    tasks: [
      {
        id: "foreign-deliverable",
        order: 1,
        title: "Document founder milestones",
        description: "",
        taskType: "deliverable",
        parentTaskId: "initiative-1",
        status: "In Arbeit",
        priority: "P2",
        assigneeId: "p2",
        assignee: "Volkan",
        sprintId: "sprint-1",
        workstream: "Operations",
        fixedDate: "",
      },
      {
        id: "my-sub-issue",
        order: 1,
        title: "Document my milestone",
        description: "",
        taskType: "sub_issue",
        parentTaskId: "foreign-deliverable",
        status: "Offen",
        priority: "",
        assigneeId: "p1",
        assignee: "Ada",
        sprintId: "",
        workstream: "",
        fixedDate: "",
      },
    ],
    profiles: [],
    sprints: [],
    taskRelations: [],
    taskBlockers: [],
  };

  const model = buildPlanningTaskTableViewModel({
    currentProfile: { id: "p1", name: "Ada" },
    data,
    filters: baseFilters,
    includeAssignedSubIssueParents: true,
  });

  assert.deepEqual(model.visibleTasks.map((task) => task.id), ["foreign-deliverable"]);
  assert.equal("viewerOpenSubIssueCountByDeliverableId" in model, false);
  assert.deepEqual(model.viewerOpenSubIssueIdsByDeliverableId, { "foreign-deliverable": ["my-sub-issue"] });
});

test("All Deliverables shows the notice count without changing normal board inclusion", async () => {
  const { buildPlanningTaskTableViewModel } = await loadViewModel();
  const deliverable = planningTask({ id: "foreign-deliverable" });
  const data = planningData([
    deliverable,
    planningTask({ id: "mine-open-1", taskType: "sub_issue", parentTaskId: deliverable.id, status: "Offen", assigneeId: "p1" }),
    planningTask({ id: "mine-open-2", taskType: "sub_issue", parentTaskId: deliverable.id, status: "Blockiert", assigneeId: "p1" }),
    planningTask({ id: "mine-done", taskType: "sub_issue", parentTaskId: deliverable.id, status: "Erledigt", assigneeId: "p1" }),
    planningTask({ id: "other-open", taskType: "sub_issue", parentTaskId: deliverable.id, status: "Offen", assigneeId: "p3" }),
  ]);

  const model = buildPlanningTaskTableViewModel({
    currentProfile: { id: "p1", name: "Ada" },
    data,
    filters: { ...baseFilters, quick: [] },
    includeAssignedSubIssueParents: true,
  });

  assert.deepEqual(model.visibleTasks.map((task) => task.id), [deliverable.id]);
  assert.equal("viewerOpenSubIssueCountByDeliverableId" in model, false);
  assert.deepEqual(model.viewerOpenSubIssueIdsByDeliverableId, {
    [deliverable.id]: ["mine-open-1", "mine-open-2"],
  });
});

test("My Deliverables removes a foreign parent after my last Sub-Issue is completed", async () => {
  const { buildPlanningTaskTableViewModel } = await loadViewModel();
  const deliverable = planningTask({ id: "foreign-deliverable" });
  const data = planningData([
    deliverable,
    planningTask({ id: "mine-done", taskType: "sub_issue", parentTaskId: deliverable.id, status: "Erledigt", assigneeId: "p1" }),
  ]);

  const model = buildPlanningTaskTableViewModel({
    currentProfile: { id: "p1", name: "Ada" },
    data,
    filters: baseFilters,
    includeAssignedSubIssueParents: true,
  });

  assert.deepEqual(model.visibleTasks, []);
  assert.equal("viewerOpenSubIssueCountByDeliverableId" in model, false);
  assert.deepEqual(model.viewerOpenSubIssueIdsByDeliverableId, {});
});

test("an owned Deliverable stays unchanged even when it contains my open Sub-Issue", async () => {
  const { buildPlanningTaskTableViewModel } = await loadViewModel();
  const deliverable = planningTask({ id: "owned-deliverable", assigneeId: "p1", assignee: "Ada" });
  const data = planningData([
    deliverable,
    planningTask({ id: "mine-open", taskType: "sub_issue", parentTaskId: deliverable.id, status: "Offen", assigneeId: "p1" }),
  ]);

  const model = buildPlanningTaskTableViewModel({
    currentProfile: { id: "p1", name: "Ada" },
    data,
    filters: baseFilters,
    includeAssignedSubIssueParents: true,
  });

  assert.deepEqual(model.visibleTasks.map((task) => task.id), [deliverable.id]);
  assert.equal("viewerOpenSubIssueCountByDeliverableId" in model, false);
  assert.deepEqual(model.viewerOpenSubIssueIdsByDeliverableId, {});
});

test("personal Sub-Issue context needs a profile and stays disabled outside the Deliverable board", async () => {
  const { buildPlanningTaskTableViewModel } = await loadViewModel();
  const deliverable = planningTask({ id: "foreign-deliverable" });
  const data = planningData([
    deliverable,
    planningTask({ id: "mine-open", taskType: "sub_issue", parentTaskId: deliverable.id, status: "Offen", assigneeId: "p1" }),
  ]);

  const withoutProfile = buildPlanningTaskTableViewModel({
    currentProfile: null,
    data,
    filters: baseFilters,
    includeAssignedSubIssueParents: true,
  });
  const outsideBoard = buildPlanningTaskTableViewModel({
    currentProfile: { id: "p1", name: "Ada" },
    data,
    filters: baseFilters,
  });

  assert.deepEqual(withoutProfile.visibleTasks, []);
  assert.equal("viewerOpenSubIssueCountByDeliverableId" in withoutProfile, false);
  assert.deepEqual(withoutProfile.viewerOpenSubIssueIdsByDeliverableId, {});
  assert.deepEqual(outsideBoard.visibleTasks, []);
  assert.equal("viewerOpenSubIssueCountByDeliverableId" in outsideBoard, false);
  assert.deepEqual(outsideBoard.viewerOpenSubIssueIdsByDeliverableId, {});
});

test("additional filters continue to evaluate the parent Deliverable", async () => {
  const { buildPlanningTaskTableViewModel } = await loadViewModel();
  const mismatches = [
    { label: "priority", child: { priority: "P1" }, filters: { priority: "P1" } },
    { label: "status", child: { status: "Offen" }, filters: { status: "Offen" } },
    { label: "sprint", child: { sprintId: "sprint-2" }, filters: { sprintId: "sprint-2" } },
    { label: "initiative", child: { initiativeId: "initiative-2" }, filters: { initiativeId: "initiative-2" } },
  ];

  for (const mismatch of mismatches) {
    const deliverable = planningTask({ id: `foreign-deliverable-${mismatch.label}` });
    const data = planningData([
      deliverable,
      planningTask({
        id: `mine-open-${mismatch.label}`,
        taskType: "sub_issue",
        parentTaskId: deliverable.id,
        assigneeId: "p1",
        ...mismatch.child,
      }),
    ]);
    const model = buildPlanningTaskTableViewModel({
      currentProfile: { id: "p1", name: "Ada" },
      data,
      filters: { ...baseFilters, ...mismatch.filters },
      includeAssignedSubIssueParents: true,
    });

    assert.deepEqual(model.visibleTasks, [], `${mismatch.label} must filter the parent Deliverable`);
  }
});
