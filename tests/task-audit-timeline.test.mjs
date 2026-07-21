import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const presentation = await loadTranspiledModule("src/features/tasks/model/task-activity-presentation.ts");
const migrationPath = "supabase/migrations/20260721120056_replace_task_activity_with_audit_log.sql";

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

test("task activity storage is replaced by structured audit rows with a compatibility view", async () => {
  const migration = await readFile(migrationPath, "utf8");
  const migrationContract = await readFile("scripts/lib/supabase-migrations.mjs", "utf8");
  const migrationDeploy = await readFile("scripts/deploy-production-migrations.mjs", "utf8");
  const migrationVerifier = await readFile("scripts/verify-supabase-migrations.mjs", "utf8");

  assert.match(migration, /insert into public\.audit_log/);
  assert.match(migration, /drop table public\.task_activity/);
  assert.match(migration, /create view public\.task_activity/);
  assert.match(migration, /create view public\.task_audit_timeline/);
  assert.match(migration, /avoids transferring complete audit snapshots/);
  assert.match(migration, /security_invoker = true/);
  assert.match(migration, /task_audit_action_from_legacy_message/);
  assert.match(migration, /instead of insert on public\.task_activity/);
  assert.match(migration, /task\.github_sync_succeeded/);
  assert.match(migrationContract, /20260721120056_replace_task_activity_with_audit_log\.sql/);
  assert.match(migrationContract, /new Set\(\["drop table"\]\)/);
  assert.match(migrationDeploy, /findUnapprovedDestructiveDdl\(migration\)/);
  assert.match(migrationVerifier, /findUnapprovedDestructiveDdl\(migration\)/);
});
