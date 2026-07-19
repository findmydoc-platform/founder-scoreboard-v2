import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const { mergeTaskDetailData } = await loadTranspiledModule(
  "src/features/tasks/model/task-detail-data-merge.ts",
);

test("task detail data merge replaces only data for the selected task", () => {
  const current = {
    marker: "preserved",
    taskComments: [
      { id: "old-target-comment", taskId: "target" },
      { id: "other-comment", taskId: "other" },
    ],
    taskExternalComments: [
      { id: "old-target-external", taskId: "target" },
      { id: "other-external", taskId: "other" },
    ],
    taskBlockers: [
      { id: "old-target-blocker", taskId: "target" },
      { id: "other-blocker", taskId: "other" },
    ],
    taskActivity: [
      { id: "old-target-activity", taskId: "target" },
      { id: "other-activity", taskId: "other" },
    ],
    taskReviews: [
      { id: "old-target-review", taskId: "target" },
      { id: "other-review", taskId: "other" },
    ],
    taskRelations: [
      { id: "old-outgoing", taskId: "target", relatedTaskId: "other" },
      { id: "old-incoming", taskId: "other", relatedTaskId: "target" },
      { id: "unrelated", taskId: "other", relatedTaskId: "third" },
    ],
  };
  const detailData = {
    taskComments: [{ id: "new-target-comment", taskId: "target" }],
    taskExternalComments: [{ id: "new-target-external", taskId: "target" }],
    taskBlockers: [{ id: "new-target-blocker", taskId: "target" }],
    taskActivity: [{ id: "new-target-activity", taskId: "target" }],
    taskReviews: [{ id: "new-target-review", taskId: "target" }],
    taskRelations: [{ id: "new-target-relation", taskId: "target", relatedTaskId: "fourth" }],
  };

  const merged = mergeTaskDetailData(current, "target", detailData);

  assert.equal(merged.marker, "preserved");
  assert.deepEqual(merged.taskComments.map(({ id }) => id), ["new-target-comment", "other-comment"]);
  assert.deepEqual(merged.taskExternalComments.map(({ id }) => id), ["new-target-external", "other-external"]);
  assert.deepEqual(merged.taskBlockers.map(({ id }) => id), ["new-target-blocker", "other-blocker"]);
  assert.deepEqual(merged.taskActivity.map(({ id }) => id), ["new-target-activity", "other-activity"]);
  assert.deepEqual(merged.taskReviews.map(({ id }) => id), ["new-target-review", "other-review"]);
  assert.deepEqual(merged.taskRelations.map(({ id }) => id), ["new-target-relation", "unrelated"]);
});

test("task detail page uses a boundary-neutral merge module", async () => {
  const [route, mergeModule, apiClient] = await Promise.all([
    readFile("src/app/tasks/[id]/page.tsx", "utf8"),
    readFile("src/features/tasks/model/task-detail-data-merge.ts", "utf8"),
    readFile("src/features/tasks/model/task-api-client.ts", "utf8"),
  ]);

  assert.match(route, /from "@\/features\/tasks\/model\/task-detail-data-merge"/);
  assert.doesNotMatch(route, /from "@\/features\/tasks\/model\/task-api-client"/);
  assert.doesNotMatch(mergeModule, /^["']use client["'];/m);
  assert.match(apiClient, /^"use client";/);
});
