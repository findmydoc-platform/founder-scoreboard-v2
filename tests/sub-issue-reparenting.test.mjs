import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Sub-Issue reparenting stays guarded by task type, ownership, and CAS", async () => {
  const [route, permissions, migration] = await Promise.all([
    readFile("src/app/api/tasks/[id]/route.ts", "utf8"),
    readFile("src/features/tasks/model/task-detail-permissions.ts", "utf8"),
    readSupabaseSchemaContract(),
  ]);

  assert.match(route, /payload\.parentTaskId !== undefined/);
  assert.match(route, /currentTask\.task_type !== "sub_issue"/);
  assert.match(route, /detailPermissions\.canReparentSubIssue/);
  assert.match(route, /nextParent\.task_type !== "deliverable"/);
  assert.match(route, /p_expected_updated_at: payload\.expectedUpdatedAt/);
  assert.match(permissions, /task\.taskType === "sub_issue" && canWorkOnTask/);
  assert.match(migration, /v_before_task\.updated_at <> p_expected_updated_at/);
  assert.match(migration, /v_before_task\.task_type <> 'sub_issue'/);
  assert.match(migration, /task_type = 'deliverable'/);
});

test("database transaction inherits hierarchy and audits the old and new parent", async () => {
  const [migration, schema, approvalMigration] = await Promise.all([
    readSupabaseSchemaContract(),
    readSupabaseSchemaContract(),
    readSupabaseSchemaContract(),
  ]);

  for (const sql of [migration, schema]) {
    assert.match(sql, /v_patch - 'parent_task_id'/);
    assert.match(sql, /set parent_task_id = v_parent_id/);
    assert.match(sql, /'task\.parent_changed'/);
    assert.match(sql, /'parentTaskId', v_before_task\.parent_task_id/);
    assert.match(sql, /'parentTaskId', v_updated_task\.parent_task_id/);
    assert.match(sql, /jsonb_set\(v_result, '\{task\}', to_jsonb\(v_updated_task\), true\)/);
    assert.match(sql, /'\{parentApprovalStatus\}'/);
  }
  assert.match(approvalMigration, /new\.package_id := v_parent\.package_id/);
  assert.match(approvalMigration, /new\.milestone_id := v_parent\.milestone_id/);
  assert.match(approvalMigration, /new\.approval_status := null/);
  assert.match(approvalMigration, /new\.sprint_id := null/);
  assert.match(approvalMigration, /new\.score_relevant := false/);
});

test("task detail uses a custom Parent control and GitHub replaces the native parent", async () => {
  const [surface, sidebar, customSelect, syncRoute, github, docs] = await Promise.all([
    readFile("src/features/tasks/organisms/task-detail-surface.tsx", "utf8"),
    readFile("src/features/tasks/organisms/task-detail-panel-sidebar.tsx", "utf8"),
    readFile("src/shared/atoms/custom-select.tsx", "utf8"),
    readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8"),
    readFile("src/lib/github.ts", "utf8"),
    readFile("docs/planning-hierarchy.md", "utf8"),
  ]);

  assert.match(surface, /canReparentSubIssue=\{controller\.permissions\.canReparentSubIssue\}/);
  assert.match(sidebar, /label="Parent-Deliverable"/);
  assert.match(sidebar, /parentDeliverableOptions\(parentDeliverables, packages\)/);
  assert.match(sidebar, /Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv/);
  assert.doesNotMatch(sidebar, /<select\b|<option\b/);
  assert.match(customSelect, /role="listbox"/);
  assert.match(syncRoute, /connectGitHubSubIssue/);
  assert.match(github, /replaceParent: true/);
  assert.match(docs, /next explicit GitHub sync replaces the native parent relationship/);
});
