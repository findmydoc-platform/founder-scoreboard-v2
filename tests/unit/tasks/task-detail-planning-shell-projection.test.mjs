import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const { applyTaskDetailModel, taskDetailDegradationMessage, taskDetailModelToPlanningShellState } = await loadTranspiledModule(
  "src/features/tasks/model/task-detail-planning-shell-projection.ts",
);

function model() {
  return {
    revision: "revision",
    project: { id: "project" },
    item: { id: "target", taskType: "deliverable" },
    ancestors: [{ id: "epic", taskType: "epic" }, { id: "initiative", taskType: "initiative" }],
    children: [{ id: "child", taskType: "sub_issue" }],
    relatedItems: [{ id: "related", taskType: "deliverable" }],
    people: [{ id: "person" }],
    sprints: [{ id: "sprint" }],
    discussion: { comments: [{ id: "new-comment", taskId: "target" }], externalComments: [] },
    blockers: [],
    relationships: [{ id: "new-relation", taskId: "target", relatedTaskId: "related" }],
    activity: [],
    reviews: [],
  };
}

test("task detail compatibility projection contains only the feature model", () => {
  const data = taskDetailModelToPlanningShellState(model());
  assert.deepEqual(data.tasks.map(({ id }) => id), ["target", "epic", "initiative", "child", "related"]);
  assert.equal(Object.hasOwn(data, "milestones"), false);
  assert.equal(Object.hasOwn(data, "packages"), false);
  assert.deepEqual(data.taskComments.map(({ id }) => id), ["new-comment"]);
  assert.deepEqual(data.notificationEvents, []);
});

test("task detail refresh replaces only selected detail rows and referenced items", () => {
  const current = {
    ...taskDetailModelToPlanningShellState(model()),
    tasks: [{ id: "other", taskType: "deliverable" }, { id: "target", taskType: "deliverable", stale: true }],
    taskComments: [{ id: "old-target", taskId: "target" }, { id: "other-comment", taskId: "other" }],
    taskRelations: [
      { id: "old-target-relation", taskId: "target", relatedTaskId: "other" },
      { id: "unrelated", taskId: "other", relatedTaskId: "third" },
    ],
  };
  const updated = applyTaskDetailModel(current, model());
  assert.deepEqual(updated.tasks.map(({ id }) => id), ["other", "target", "epic", "initiative", "child", "related"]);
  assert.deepEqual(updated.taskComments.map(({ id }) => id), ["new-comment", "other-comment"]);
  assert.deepEqual(updated.taskRelations.map(({ id }) => id), ["new-relation", "unrelated"]);
});

test("task detail degradation copy names every unavailable area", () => {
  assert.equal(
    taskDetailDegradationMessage(["discussion", "relationships", "timeline"]),
    "Diskussion, Beziehungen und Blocker, Aktivität und Reviews konnten nicht vollständig geladen werden.",
  );
});
