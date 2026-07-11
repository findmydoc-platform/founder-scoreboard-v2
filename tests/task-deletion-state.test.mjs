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

test("task deletion removes and restores the complete descendant subtree", async () => {
  const { removeTaskTreeFromPlanningData, restoreTaskTreeToPlanningData } = await loadTranspiledModule(
    "src/features/tasks/model/task-deletion-state.ts",
  );
  const source = planningData();

  const deletion = removeTaskTreeFromPlanningData(source, "root");

  assert.deepEqual(deletion.data.tasks.map((task) => task.id), ["unrelated"]);
  assert.deepEqual([...deletion.taskIds].sort(), ["child", "grandchild", "root"]);
  assert.deepEqual(deletion.data.taskComments.map((comment) => comment.id), [2]);
  assert.deepEqual(deletion.data.taskExternalComments, []);
  assert.deepEqual(deletion.data.taskBlockers, []);
  assert.deepEqual(deletion.data.taskRelations.map((relation) => relation.id), [6]);
  assert.deepEqual(deletion.data.taskActivity, []);
  assert.deepEqual(deletion.data.taskFocusItems, []);

  const withConcurrentData = {
    ...deletion.data,
    tasks: [...deletion.data.tasks, { id: "new-task" }],
    taskComments: [...deletion.data.taskComments, { id: 9, taskId: "new-task" }],
  };
  const restored = restoreTaskTreeToPlanningData(withConcurrentData, deletion.snapshot);

  assert.deepEqual(restored.tasks.map((task) => task.id).sort(), ["child", "grandchild", "new-task", "root", "unrelated"]);
  assert.deepEqual(restored.taskComments.map((comment) => comment.id).sort(), [1, 2, 9]);
  assert.deepEqual(restored.taskRelations.map((relation) => relation.id).sort(), [5, 6]);
  assert.deepEqual(restored.taskFocusItems.map((item) => item.id), [8]);
});
