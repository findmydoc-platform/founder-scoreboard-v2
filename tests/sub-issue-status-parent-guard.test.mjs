import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";



test("task updates expose an atomic parent-approval conflict as a stable 409", async () => {
  const route = await readFile("src/features/planning-items/model/planning-items-browser-task-update.ts", "utf8");

  assert.match(route, /reviseResult\.error\.code === "conflict" && reviseResult\.error\.reason === "state"/);
  assert.match(route, /Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv/);
});

test("same-status requests become unchanged responses before status side effects", async () => {
  const route = await readFile("src/features/planning-items/model/planning-items-browser-task-update.ts", "utf8");
  const normalizeIndex = route.indexOf("withoutUnchangedTaskStatus(currentTask, payload)");
  const reviewRequestIndex = route.indexOf("isPlanningReviewRequestPayload(rawPayload)");

  assert.ok(normalizeIndex > 0);
  assert.ok(reviewRequestIndex > 0);
  assert.ok(reviewRequestIndex < normalizeIndex);
  assert.ok(normalizeIndex < route.indexOf("validateSubIssueStatusParentApproval({"));
  assert.ok(normalizeIndex < route.indexOf("applyFinalStatusReopen(update"));
  assert.ok(normalizeIndex < route.indexOf("markTaskGitHubSyncDirty(update)"));
  assert.match(route, /\(statusNoop \|\| sprintAssignmentNoop\)[\s\S]{0,180}Object\.keys\(update\)\.length === 0/);
  assert.match(route, /statusNoop[\s\S]{0,500}updatedAt: currentTask\.updated_at/);
});
