import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readSupabaseMigrationCorpus } from "../scripts/lib/supabase-migrations.mjs";

test("Sub-Issue status updates lock and revalidate the active parent approval", async () => {
  const corpus = await readSupabaseMigrationCorpus();
  const latestDefinition = corpus.slice(corpus.lastIndexOf("create or replace function public.update_planning_task_transaction"));

  assert.match(latestDefinition, /v_changes_status boolean := v_patch \? 'status'/);
  assert.match(latestDefinition, /where id = v_parent_id[\s\S]*task_type = 'deliverable'[\s\S]*trashed_at is null[\s\S]*for share/);
  assert.match(latestDefinition, /v_changes_status and v_parent\.approval_status is distinct from 'approved'/);
  assert.match(latestDefinition, /errcode = 'P0008', message = 'sub-issue parent is not approved'/);
  assert.ok(latestDefinition.indexOf("for share") < latestDefinition.indexOf("from public.tasks\n  where id = p_task_id\n  for update"));
});

test("task updates expose an atomic parent-approval conflict as a stable 409", async () => {
  const route = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");

  assert.match(route, /transactionError\.code === "P0008"/);
  assert.match(route, /Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv/);
});

test("same-status requests become unchanged responses before status side effects", async () => {
  const route = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const normalizeIndex = route.indexOf("withoutUnchangedTaskStatus(currentTask, payload)");

  assert.ok(normalizeIndex > 0);
  assert.ok(normalizeIndex < route.indexOf("startsTaskReviewRequest(payload)"));
  assert.ok(normalizeIndex < route.indexOf("validateSubIssueStatusParentApproval({"));
  assert.ok(normalizeIndex < route.indexOf("applyFinalStatusReopen(update"));
  assert.ok(normalizeIndex < route.indexOf("markTaskGitHubSyncDirty(update)"));
  assert.match(route, /\(statusNoop \|\| sprintAssignmentNoop\)[\s\S]{0,180}Object\.keys\(update\)\.length === 0/);
  assert.match(route, /statusNoop[\s\S]{0,500}updatedAt: currentTask\.updated_at/);
});
