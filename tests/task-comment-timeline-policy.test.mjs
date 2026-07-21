import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const policy = await loadTranspiledModule("src/features/tasks/model/task-comment-timeline-policy.ts");

test("comment audit events stay hidden because the comment already appears in the timeline", () => {
  assert.equal(policy.isUsefulActivity({ action: "task.comment" }), false);
});

test("relevant task audit events remain visible in the timeline", () => {
  assert.equal(policy.isUsefulActivity({ action: "task.github_sync_succeeded" }), true);
  assert.equal(policy.isUsefulActivity({ action: "task.status_changed" }), true);
});

test("legacy mutation messages map to typed audit actions", () => {
  assert.equal(policy.taskAuditActionFromMessage("GitHub-Sync ausgeführt: management#338"), "task.github_sync_succeeded");
  assert.equal(policy.taskAuditActionFromMessage("Status geändert: Offen → In Arbeit"), "task.status_changed");
  assert.equal(policy.taskAuditActionFromMessage("Notiz aktualisiert"), "");
});
