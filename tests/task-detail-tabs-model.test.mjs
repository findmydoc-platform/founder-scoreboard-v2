import assert from "node:assert/strict";
import test from "node:test";

import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const {
  normalizeTaskDetailTabs,
  resolveTaskDetailTab,
  taskDetailAvailableTabs,
} = await loadTranspiledModule("src/features/tasks/model/task-detail-tabs-model.ts");

const emptyKnownState = {
  activityCount: 0,
  activityKnown: true,
  canAddRelationship: false,
  canComment: false,
  canCreateSubIssue: false,
  relationshipCount: 0,
  relationshipsKnown: true,
  subIssueCount: 0,
};

test("empty read-only item renders only the overview tab", () => {
  assert.deepEqual(taskDetailAvailableTabs(emptyKnownState), ["overview"]);
});

test("tabs remain available for content, actions, and unresolved detail data", () => {
  assert.deepEqual(
    taskDetailAvailableTabs({
      ...emptyKnownState,
      activityCount: 2,
      canAddRelationship: true,
      canCreateSubIssue: true,
    }),
    ["overview", "subIssues", "relationships", "activity"],
  );
  assert.deepEqual(
    taskDetailAvailableTabs({
      ...emptyKnownState,
      activityKnown: false,
      relationshipsKnown: false,
    }),
    ["overview", "relationships", "activity"],
  );
});

test("tab normalization preserves order and falls back to overview", () => {
  assert.deepEqual(normalizeTaskDetailTabs(["activity", "relationships", "activity"]), ["overview", "relationships", "activity"]);
  assert.equal(resolveTaskDetailTab("activity", ["overview", "relationships"]), "overview");
  assert.equal(resolveTaskDetailTab("relationships", ["overview", "relationships"]), "relationships");
});
