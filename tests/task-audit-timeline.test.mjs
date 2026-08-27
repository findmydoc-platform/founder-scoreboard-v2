import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const presentation = await loadTranspiledModule("src/features/tasks/model/task-activity-presentation.ts");

function activity(action, overrides = {}) {
  return {
    id: 1,
    taskId: "task-1",
    action,
    actorProfileId: "profile-1",
    message: "",
    beforeData: null,
    afterData: null,
    createdAt: "2026-07-21T12:00:00.000Z",
    ...overrides,
  };
}

test("important task audit classes receive distinct icons and plain-language labels", () => {
  assert.deepEqual(
    presentation.describeTaskActivity(activity("task.status_changed", { message: "Status geändert: Offen → In Arbeit" })),
    { title: "Status geändert", detail: "Offen → In Arbeit", icon: "status", tone: "blue" },
  );
  assert.equal(presentation.describeTaskActivity(activity("task.priority_changed")).icon, "priority");
  assert.equal(presentation.describeTaskActivity(activity("task.review.reopen")).icon, "review");
  assert.equal(presentation.describeTaskActivity(activity("task.github_sync_failed")).icon, "github-error");
  assert.equal(presentation.describeTaskActivity(activity("task.relationship_deleted")).icon, "relationship-remove");
  assert.equal(presentation.describeTaskActivity(activity("task.attachment_uploaded", { afterData: { filename: "brief.pdf" } })).detail, "brief.pdf");
});
