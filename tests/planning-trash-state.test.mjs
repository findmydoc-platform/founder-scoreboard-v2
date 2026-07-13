import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

function planningData() {
  return {
    project: { id: "project" },
    profiles: [],
    packages: [],
    milestones: [],
    tasks: [
      { id: "root" },
      { id: "child", parentTaskId: "root" },
      { id: "grandchild", parentTaskId: "child" },
      { id: "unrelated" },
    ],
    sprints: [],
    sprintCommitments: [],
    founderSprintScores: [],
    founderStrikeStates: [],
    strikeEvents: [],
    scoreObjections: [],
    taskComments: [
      { id: 1, taskId: "child" },
      { id: 2, taskId: "unrelated" },
    ],
    taskExternalComments: [{ id: 3, taskId: "grandchild" }],
    taskBlockers: [{ id: 4, taskId: "root" }],
    taskRelations: [
      { id: 5, taskId: "root", relatedTaskId: "unrelated" },
      { id: 6, taskId: "unrelated", relatedTaskId: "other" },
    ],
    taskActivity: [{ id: 7, taskId: "child" }],
    taskFocusItems: [{ id: 8, taskId: "grandchild" }],
    notificationEvents: [],
    notificationDeliveries: [],
    notificationPreferences: [],
    profileUiPreferences: [],
    profileFeatureTourAcknowledgements: [],
    fmdTools: [],
    events: [],
    meetings: [],
    meetingAttendance: [],
    audit: [],
  };
}

test("planning trash state removes and restores the complete Deliverable subtree", async () => {
  const { removePlanningRootFromData, restorePlanningRootToData } = await loadTranspiledModule(
    "src/features/planning/model/planning-trash-state.ts",
  );
  const source = planningData();

  const withdrawal = removePlanningRootFromData(source, "deliverable", "root");

  assert.deepEqual(withdrawal.data.tasks.map((task) => task.id), ["unrelated"]);
  assert.deepEqual([...withdrawal.taskIds].sort(), ["child", "grandchild", "root"]);
  assert.deepEqual(withdrawal.data.taskComments.map((comment) => comment.id), [2]);
  assert.deepEqual(withdrawal.data.taskExternalComments, []);
  assert.deepEqual(withdrawal.data.taskBlockers, []);
  assert.deepEqual(withdrawal.data.taskRelations.map((relation) => relation.id), [6]);
  assert.deepEqual(withdrawal.data.taskActivity, []);
  assert.deepEqual(withdrawal.data.taskFocusItems, []);

  const withConcurrentData = {
    ...withdrawal.data,
    tasks: [...withdrawal.data.tasks, { id: "new-task" }],
    taskComments: [...withdrawal.data.taskComments, { id: 9, taskId: "new-task" }],
  };
  const restored = restorePlanningRootToData(withConcurrentData, withdrawal.snapshot);

  assert.deepEqual(restored.tasks.map((task) => task.id).sort(), ["child", "grandchild", "new-task", "root", "unrelated"]);
  assert.deepEqual(restored.taskComments.map((comment) => comment.id).sort(), [1, 2, 9]);
  assert.deepEqual(restored.taskRelations.map((relation) => relation.id).sort(), [5, 6]);
  assert.deepEqual(restored.taskFocusItems.map((item) => item.id), [8]);
});

test("planning trash state removes an Initiative and all assigned tasks", async () => {
  const { removePlanningRootFromData, restorePlanningRootToData } = await loadTranspiledModule(
    "src/features/planning/model/planning-trash-state.ts",
  );
  const source = planningData();
  source.packages = [{ id: "initiative" }, { id: "other-initiative" }];
  source.tasks = source.tasks.map((task) => ({
    ...task,
    packageId: task.id === "unrelated" ? "other-initiative" : "initiative",
  }));

  const withdrawal = removePlanningRootFromData(source, "initiative", "initiative");
  assert.deepEqual(withdrawal.data.packages.map((pack) => pack.id), ["other-initiative"]);
  assert.deepEqual(withdrawal.data.tasks.map((task) => task.id), ["unrelated"]);

  const restored = restorePlanningRootToData(withdrawal.data, withdrawal.snapshot);
  assert.deepEqual(restored.packages.map((pack) => pack.id).sort(), ["initiative", "other-initiative"]);
  assert.deepEqual(restored.tasks.map((task) => task.id).sort(), ["child", "grandchild", "root", "unrelated"]);
});
