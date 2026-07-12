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
