import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const syncContract = await readFile("src/lib/github-sync/contract.ts", "utf8");
const listHook = await readFile("src/features/tasks/hooks/use-task-github-sync-command.ts", "utf8");
const detailHook = await readFile("src/features/tasks/hooks/use-task-detail-workflow.ts", "utf8");
const mutationCommands = await readFile("src/features/tasks/hooks/use-task-mutation-commands.ts", "utf8");
const updateHook = await readFile("src/features/tasks/hooks/use-task-update-command.ts", "utf8");





test("stale responses remain retryable instead of becoming failed", () => {
  for (const hook of [listHook, detailHook]) {
    assert.match(hook, /classifyTaskGitHubSyncResponse/);
    assert.match(hook, /classification\.taskStatus/);
  }
  assert.match(syncContract, /github_sync_stale[\s\S]*retryableCodes/);
});

test("single-task sync failures preserve the current domain state", () => {
  const singleTaskSync = listHook.slice(
    listHook.indexOf("const syncTaskToGitHub"),
    listHook.indexOf("const syncLinkedGitHubTasks"),
  );

  assert.doesNotMatch(singleTaskSync, /\.\.\.previousTask/);
  assert.match(singleTaskSync, /\.\.\.item,[\s\S]{0,180}githubIssueSyncStatus: "pending"/);
  assert.match(singleTaskSync, /\.\.\.classification\.result\.task/);
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
  assert.match(listHook, /rememberTaskServerRevision\(serverUpdatedAtByTask, task\.id, classification\.result\.task\?\.updatedAt\)/);
  assert.match(detailHook, /if \(classification\.result\.task\?\.updatedAt\) updatedAtRef\.current = classification\.result\.task\.updatedAt;/);
});

test("bulk sync preserves current domain state on lock, retry, and failure", () => {
  const bulkSync = listHook.slice(listHook.indexOf("const syncLinkedGitHubTasks"));

  assert.doesNotMatch(bulkSync, /previousTasks|\.\.\.previousTask/);
  assert.match(bulkSync, /\.\.\.item,[\s\S]{0,120}\.\.\.serverTaskPatch,[\s\S]{0,120}githubIssueSyncStatus: "pending"/);
  assert.match(bulkSync, /\.\.\.classification\.result\.task/);
  assert.match(bulkSync, /\.\.\.item,[\s\S]{0,120}\.\.\.serverTaskPatch,[\s\S]{0,120}githubIssueSyncStatus: "failed"/);
  assert.match(bulkSync, /item\.githubIssueSyncStatus === "pending"[\s\S]{0,100}item\.githubIssueSyncPendingSince === bulkStartedAt[\s\S]{0,120}\? \{ \.\.\.item, \.\.\.previousSyncState \}/);
  assert.match(updateHook, /githubIssueSyncStatus: "not_synced" as const,[\s\S]{0,120}githubIssueSyncPendingSince: ""/);
});
