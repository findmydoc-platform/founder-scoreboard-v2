import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const migration = await readFile("supabase/migrations/20260713162208_github_issue_sync_optimistic_concurrency.sql", "utf8");
const pullRequestMigration = await readFile("supabase/migrations/20260724123616_task_evidence_links_and_linked_pull_requests.sql", "utf8");
const route = await readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8");
const listHook = await readFile("src/features/tasks/hooks/use-task-github-sync-command.ts", "utf8");
const detailHook = await readFile("src/features/tasks/hooks/use-task-detail-workflow.ts", "utf8");
const mutationCommands = await readFile("src/features/tasks/hooks/use-task-mutation-commands.ts", "utf8");
const updateHook = await readFile("src/features/tasks/hooks/use-task-update-command.ts", "utf8");

test("GitHub sync v2 RPCs use task revisions for begin and finalize CAS", () => {
  assert.match(migration, /begin_github_issue_sync_transaction_v2/);
  assert.match(migration, /finalize_github_issue_sync_transaction_v2/);
  assert.match(migration, /and updated_at = p_expected_updated_at/);
  assert.match(migration, /and github_issue_sync_status = 'pending'/);
  assert.match(migration, /errcode = 'P0001'/);
  assert.match(migration, /errcode = 'P0002'/);
  assert.match(migration, /revoke all on function public\.begin_github_issue_sync_transaction_v2[\s\S]*from public/);
  assert.match(migration, /grant execute on function public\.finalize_github_issue_sync_transaction_v2[\s\S]*to service_role/);
});

test("route checks the revision before the GitHub write and before finalization", () => {
  const beginIndex = route.indexOf('supabase.rpc("begin_github_issue_sync_transaction_v2"');
  const writeIndex = route.indexOf("const issue = await upsertGitHubIssue");
  const finalizeIndex = route.indexOf('supabase.rpc("finalize_github_issue_sync_with_pull_requests_v1"');

  assert.ok(beginIndex > 0);
  assert.ok(beginIndex < writeIndex);
  assert.ok(writeIndex < finalizeIndex);
  assert.match(route, /p_expected_updated_at: task\.updatedAt/);
  assert.match(route, /p_expected_updated_at: pendingUpdatedAt/);
  assert.match(route, /pendingError\?\.code === "P0001"/);
  assert.match(route, /finalizeError\?\.code === "P0001"/);
  assert.match(route, /code: "github_sync_stale"/);
  assert.match(pullRequestMigration, /and updated_at = p_expected_updated_at/);
  assert.match(pullRequestMigration, /and github_issue_sync_status = 'pending'/);
});

test("stale responses remain retryable instead of becoming failed", () => {
  for (const hook of [listHook, detailHook]) {
    assert.match(hook, /code === "github_sync_stale"/);
    assert.match(hook, /githubIssueSyncStatus: "not_synced"/);
    assert.match(hook, /während des GitHub-Syncs geändert/);
  }
  assert.doesNotMatch(route, /github_sync_stale[\s\S]{0,300}fail_github_issue_sync_transaction/);
});

test("single-task sync failures preserve the current domain state", () => {
  const singleTaskSync = listHook.slice(
    listHook.indexOf("const syncTaskToGitHub"),
    listHook.indexOf("const syncLinkedGitHubTasks"),
  );

  assert.doesNotMatch(singleTaskSync, /\.\.\.previousTask/);
  assert.match(singleTaskSync, /\.\.\.item,[\s\S]{0,180}githubIssueSyncStatus: "pending"/);
  assert.match(singleTaskSync, /\.\.\.item,[\s\S]{0,180}githubIssueSyncStatus: "not_synced"/);
  assert.match(singleTaskSync, /\.\.\.item,[\s\S]{0,180}githubIssueSyncStatus: "failed"/);
});

test("GitHub sync advances the shared task revision used by the next edit", async () => {
  const { rememberTaskServerRevision, taskServerRevision } = await loadTranspiledModule(
    "src/features/tasks/model/task-server-revision.ts",
  );
  const store = { current: new Map() };
  const task = { id: "task-1", updatedAt: "revision-before-status" };

  rememberTaskServerRevision(store, task.id, "revision-after-status");
  assert.equal(taskServerRevision(store, task), "revision-after-status");

  rememberTaskServerRevision(store, task.id, "revision-after-sync");
  assert.equal(taskServerRevision(store, task), "revision-after-sync");
  assert.match(mutationCommands, /serverUpdatedAtByTask[\s\S]*useTaskGitHubSyncCommand\(\{[\s\S]*serverUpdatedAtByTask[\s\S]*useTaskUpdateCommand\(\{[\s\S]*serverUpdatedAtByTask/);
  assert.match(listHook, /rememberTaskServerRevision\(serverUpdatedAtByTask, task\.id, body\?\.task\?\.updatedAt\)/);
  assert.match(detailHook, /if \(body\?\.task\?\.updatedAt\) updatedAtRef\.current = body\.task\.updatedAt;/);
});

test("bulk sync preserves current domain state on lock, retry, and failure", () => {
  const bulkSync = listHook.slice(listHook.indexOf("const syncLinkedGitHubTasks"));

  assert.doesNotMatch(bulkSync, /previousTasks|\.\.\.previousTask/);
  assert.match(bulkSync, /\.\.\.item,[\s\S]{0,120}\.\.\.serverTaskPatch,[\s\S]{0,120}githubIssueSyncStatus: "pending"/);
  assert.match(bulkSync, /\.\.\.item,[\s\S]{0,120}\.\.\.serverTaskPatch,[\s\S]{0,120}githubIssueSyncStatus: "not_synced"/);
  assert.match(bulkSync, /\.\.\.item,[\s\S]{0,120}\.\.\.serverTaskPatch,[\s\S]{0,120}githubIssueSyncStatus: "failed"/);
  assert.match(bulkSync, /item\.githubIssueSyncStatus === "pending"[\s\S]{0,100}item\.githubIssueSyncPendingSince === bulkStartedAt[\s\S]{0,120}\? \{ \.\.\.item, \.\.\.previousSyncState \}/);
  assert.match(updateHook, /githubIssueSyncStatus: "not_synced" as const,[\s\S]{0,120}githubIssueSyncPendingSince: ""/);
});
