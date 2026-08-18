import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20260818093517_archive_webhook_terminal_failures.sql";

function archiveUpdateBlock(migration, table, followingTable = null) {
  const archiveSection = migration.slice(migration.indexOf("do $$\ndeclare\n  v_planning_count integer;"));
  const start = archiveSection.indexOf(`update public.${table} delivery`);
  assert.ok(start >= 0, `Missing archive update for ${table}.`);
  const end = followingTable
    ? archiveSection.indexOf(`\n\n  update public.${followingTable} delivery`, start)
    : archiveSection.indexOf("\nend;\n$$;", start);
  assert.ok(end > start, `Missing archive update boundary for ${table}.`);
  return archiveSection.slice(start, end);
}

function assertExactArchiveUpdate(update, {
  table,
  eventName,
  action,
  issueNumber,
  errorPrefix,
  archiveReason,
}) {
  assert.match(
    update,
    new RegExp(
      `^update public\\.${table} delivery\\n  set archived_at = clock_timestamp\\(\\),\\n      archive_reason = '${archiveReason}',\\n      updated_at = clock_timestamp\\(\\)\\n  where`,
      "i",
    ),
  );
  for (const predicate of [
    /delivery\.status = 'failed'/i,
    /delivery\.archived_at is null/i,
    new RegExp(`delivery\\.event_name = '${eventName}'`, "i"),
    new RegExp(`delivery\\.action = '${action}'`, "i"),
    /delivery\.repository_full_name = 'findmydoc-platform\/website'/i,
    new RegExp(`delivery\\.issue_number = ${issueNumber}`, "i"),
    new RegExp(`delivery\\.last_error like '${errorPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}%`),
  ]) {
    assert.match(update, predicate);
  }
}

test("webhook terminal failure archival retains failure rows and prevents replay", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(
    migration,
    /alter table public\.github_planning_webhook_deliveries[\s\S]*add column if not exists archived_at timestamptz[\s\S]*add column if not exists archive_reason text/i,
  );
  assert.match(
    migration,
    /alter table public\.github_webhook_deliveries[\s\S]*add column if not exists archived_at timestamptz[\s\S]*add column if not exists archive_reason text/i,
  );
  assert.match(migration, /github_planning_webhook_deliveries_archive_check[\s\S]*archived_at is null and archive_reason is null/i);
  assert.match(migration, /github_webhook_deliveries_archive_check[\s\S]*archived_at is null and archive_reason is null/i);
  assert.match(
    migration,
    /create or replace function public\.claim_github_planning_webhook_delivery[\s\S]*delivery\.archived_at is null/i,
  );
  assert.match(
    migration,
    /create or replace function public\.claim_github_issue_comment_webhook_delivery[\s\S]*delivery\.archived_at is null[\s\S]*delivery\.status in \('received', 'retry_scheduled', 'failed'\)/i,
  );
  assert.match(migration, /issue_number = 1712[\s\S]*tasks\.evidence_links does not exist/i);
  assert.match(migration, /issue_number = 1619[\s\S]*GitHub Kommentar konnte nicht geladen werden: 404/i);
});

test("webhook terminal failure archival updates only the known historical rows", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assertExactArchiveUpdate(archiveUpdateBlock(
    migration,
    "github_planning_webhook_deliveries",
    "github_webhook_deliveries",
  ), {
    table: "github_planning_webhook_deliveries",
    eventName: "issues",
    action: "edited",
    issueNumber: 1712,
    errorPrefix: "FounderOps planning task could not be loaded: column tasks.evidence_links does not exist",
    archiveReason: "superseded_test_failure_task_links_fixed",
  });
  assertExactArchiveUpdate(archiveUpdateBlock(migration, "github_webhook_deliveries"), {
    table: "github_webhook_deliveries",
    eventName: "issue_comment",
    action: "created",
    issueNumber: 1619,
    errorPrefix: "GitHub Kommentar konnte nicht geladen werden: 404",
    archiveReason: "source_comment_unavailable_without_projection",
  });
});
