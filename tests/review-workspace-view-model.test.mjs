import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const platformMock = {
  hasOpenWaitingRelation: (taskId) => taskId === "open-blocked",
  isOperationalLeadRole: () => false,
};

const statusMock = {
  normalizeStatus: (status) => status,
};

test("open reviews remain visible in both open and blocked filters", async () => {
  const { buildReviewWorkspaceViewModel } = await loadTranspiledModule(
    "src/features/reviews/model/review-workspace-view-model.ts",
    {
      "@/lib/platform": platformMock,
      "@/lib/status": statusMock,
      "@/features/tasks/model/task-attention-signals": { taskHasCriticalAttention: () => false },
    },
  );
  const openBlockedTask = {
    id: "open-blocked",
    order: 1,
    title: "Open review with blocker",
    description: "",
    status: "Review",
    reviewStatus: "requested",
    scoreFinal: false,
    priority: "P1",
    assignee: "Founder",
    workstream: "Product",
    reviewOwnerProfileId: "reviewer",
  };
  const data = {
    tasks: [openBlockedTask],
    taskRelations: [],
    profiles: [{ id: "reviewer", name: "Reviewer" }],
  };

  const open = buildReviewWorkspaceViewModel({
    data,
    currentProfile: null,
    filters: { status: "open", owner: "all" },
  });
  const blocked = buildReviewWorkspaceViewModel({
    data,
    currentProfile: null,
    filters: { status: "blocked", owner: "all" },
  });

  assert.deepEqual(open.visibleTasks.map((task) => task.id), ["open-blocked"]);
  assert.deepEqual(blocked.visibleTasks.map((task) => task.id), ["open-blocked"]);
  assert.equal(open.metrics.open, 1);
  assert.equal(open.metrics.blocked, 1);
});

test("review filters combine owner priority and date and return no-results cleanly", async () => {
  const { buildReviewWorkspaceViewModel, DEFAULT_REVIEW_FILTERS } = await loadTranspiledModule(
    "src/features/reviews/model/review-workspace-view-model.ts",
    {
      "@/lib/platform": { ...platformMock, hasOpenWaitingRelation: () => false },
      "@/lib/status": statusMock,
      "@/features/tasks/model/task-attention-signals": { taskHasCriticalAttention: () => false },
    },
  );
  const tasks = [
    { id: "match", order: 2, title: "Alpha", description: "", status: "Review", reviewStatus: "requested", scoreFinal: false, priority: "P0", assigneeId: "p1", assignee: "Ada", reviewOwnerProfileId: "reviewer", reviewRequestedAt: "2026-07-12" },
    { id: "other", order: 1, title: "Beta", description: "", status: "Review", reviewStatus: "requested", scoreFinal: false, priority: "P2", assigneeId: "p2", assignee: "Bob", reviewOwnerProfileId: "reviewer", reviewRequestedAt: "2026-07-13" },
  ];
  const data = { tasks, taskRelations: [], profiles: [{ id: "reviewer", name: "Reviewer" }] };
  const filters = { ...DEFAULT_REVIEW_FILTERS, owner: "reviewer", priority: "P0", assignee: "p1", from: "2026-07-01", to: "2026-07-31" };
  assert.deepEqual(buildReviewWorkspaceViewModel({ data, currentProfile: null, filters }).visibleTasks.map((task) => task.id), ["match"]);
  assert.deepEqual(buildReviewWorkspaceViewModel({ data, currentProfile: null, filters: { ...filters, query: "missing" } }).visibleTasks, []);
});
