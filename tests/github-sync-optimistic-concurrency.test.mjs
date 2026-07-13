import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile("supabase/migrations/20260713162208_github_issue_sync_optimistic_concurrency.sql", "utf8");
const route = await readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8");
const listHook = await readFile("src/features/tasks/hooks/use-task-github-sync-command.ts", "utf8");
const detailHook = await readFile("src/features/tasks/hooks/use-task-detail-workflow.ts", "utf8");

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
  const finalizeIndex = route.indexOf('supabase.rpc("finalize_github_issue_sync_transaction_v2"');

  assert.ok(beginIndex > 0);
  assert.ok(beginIndex < writeIndex);
  assert.ok(writeIndex < finalizeIndex);
  assert.match(route, /p_expected_updated_at: task\.updatedAt/);
  assert.match(route, /p_expected_updated_at: pendingUpdatedAt/);
  assert.match(route, /pendingError\?\.code === "P0001"/);
  assert.match(route, /finalizeError\?\.code === "P0001"/);
  assert.match(route, /code: "github_sync_stale"/);
});

test("stale responses remain retryable instead of becoming failed", () => {
  for (const hook of [listHook, detailHook]) {
    assert.match(hook, /code === "github_sync_stale"/);
    assert.match(hook, /githubIssueSyncStatus: "not_synced"/);
    assert.match(hook, /während des GitHub-Syncs geändert/);
  }
  assert.doesNotMatch(route, /github_sync_stale[\s\S]{0,300}fail_github_issue_sync_transaction/);
});
