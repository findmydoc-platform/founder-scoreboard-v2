import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";
import { listSupabaseMigrations } from "../scripts/lib/supabase-migrations.mjs";

const migrationPath = "supabase/migrations/20260819132108_comment_mention_notifications.sql";

test("local comments and their notification events share one transaction", async () => {
  const [migration, route] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile("src/app/api/tasks/[id]/comments/route.ts", "utf8"),
  ]);

  assert.match(route, /create_task_comment_with_notifications/);
  assert.doesNotMatch(route, /from\("notification_events"\)\.insert/);
  assert.match(migration, /insert into public\.task_comments[\s\S]*insert into public\.notification_events/);
  assert.match(migration, /task\.mention:founderops:/);
  assert.match(migration, /on conflict \(dedupe_key\) where dedupe_key is not null do nothing/);
});

test("GitHub imports atomically upsert comments and deduplicated mention events", async () => {
  const [migration, manualRoute, webhookStore] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile("src/app/api/tasks/[id]/github-comments/route.ts", "utf8"),
    readFile("src/lib/github-issue-comment-webhook.ts", "utf8"),
  ]);

  assert.match(manualRoute, /importGitHubTaskCommentsWithMentions/);
  assert.match(webhookStore, /apply_github_issue_comment_webhook_projection_with_mentions/);
  assert.match(migration, /github_comment_notifications_after/);
  assert.match(migration, /v_source_updated_at >= v_task\.github_comment_notifications_after/);
  assert.match(migration, /mention_recipient_profile_ids/);
  assert.match(migration, /not \(recipient_id = any\(v_previous_recipient_profile_ids\)\)/);
  assert.match(migration, /p_comment_updated_at < v_existing\.source_updated_at/);
  assert.match(migration, /task\.mention:github:/);
  assert.match(migration, /\?comment=github:/);
});

test("the forward migration permits self-mentions without enabling ordinary self-comment notifications", async () => {
  const migrations = await listSupabaseMigrations();
  const migration = migrations.find((entry) => entry.name === "allow_self_mention_notifications")?.sql || "";
  const localMentionInsert = migration.match(/'task\.mention'[\s\S]*?on conflict \(dedupe_key\)[\s\S]*?do nothing;/u)?.[0] || "";
  const localCommentInsert = migration.match(/'task\.comment'[\s\S]*?on conflict \(dedupe_key\)[\s\S]*?do nothing;/u)?.[0] || "";
  const githubMentionInserts = [...migration.matchAll(/'task\.mention'[\s\S]*?from unnest\(v_current_recipient_profile_ids\)[\s\S]*?do nothing;/gu)];

  assert.match(migration, /create or replace function public\.create_task_comment_with_notifications/);
  assert.doesNotMatch(localMentionInsert, /recipient_id is distinct from nullif\(p_profile_id/);
  assert.match(localCommentInsert, /recipient_id is distinct from nullif\(p_profile_id/);
  assert.equal(githubMentionInserts.length, 2);
  for (const [insert] of githubMentionInserts) {
    assert.doesNotMatch(insert, /recipient_id is distinct from (?:v_actor_profile_id|nullif\(trim\(coalesce\(p_actor_profile_id)/);
  }
});

test("the manual import adapter passes resolved mention snapshots to the atomic RPC", async () => {
  const mentions = await loadTranspiledModule("src/lib/mentions.ts");
  const snapshots = await loadTranspiledModule("src/lib/github-comment-mention-snapshot.ts", {
    "@/lib/mentions": mentions,
  });
  const adapter = await loadTranspiledModule("src/lib/github-comment-mention-import.ts", {
    "@supabase/supabase-js": {},
  });
  const snapshot = snapshots.resolveGitHubCommentMentionSnapshot({
    authorLogin: "outside-author",
    body: "Edited @MehmetVolkan.",
    profiles: [{ id: "volkan", name: "Volkan", githubLogin: "MehmetVolkan" }],
    existing: {
      authorLogin: "outside-author",
      body: "Historical @MehmetVolkan",
      sourceUpdatedAt: "2026-08-19T08:00:00Z",
      mentionRecipientProfileIds: [],
      mentionRecipientsInitialized: false,
    },
  });
  const comments = [{ externalId: "42", ...snapshot }];
  const calls = [];
  const supabase = {
    async rpc(name, params) {
      calls.push({ name, params });
      return { data: { imported: 0 }, error: null };
    },
  };

  await adapter.importGitHubTaskCommentsWithMentions(supabase, "task-42", comments);
  assert.deepEqual(calls, [{
    name: "import_github_task_comments_with_mentions",
    params: { p_task_id: "task-42", p_comments: comments },
  }]);
  assert.deepEqual(snapshot.mentionRecipientProfileIds, ["volkan"]);
  assert.deepEqual(snapshot.baselineMentionRecipientProfileIds, ["volkan"]);
});

test("task comment targets map notification IDs to timeline element IDs", async () => {
  const targets = await loadTranspiledModule("src/features/tasks/model/task-comment-target.ts");
  const target = targets.githubTaskCommentTarget("5307392288");
  assert.equal(target, "github:5307392288");
  assert.equal(targets.parseTaskCommentTarget(target), target);
  assert.equal(targets.taskCommentElementId(target), "task-comment-github:5307392288");
  assert.equal(targets.parseTaskCommentTarget("github:"), "");
});

test("the open app refreshes notifications and exact comment targets remain explainable", async () => {
  const [headerHook, headerData, notificationCommands, surface, timeline, settings] = await Promise.all([
    readFile("src/features/planning/hooks/use-planning-header-data.ts", "utf8"),
    readFile("src/lib/planning-header-data.ts", "utf8"),
    readFile("src/features/planning/hooks/use-notification-commands.ts", "utf8"),
    readFile("src/features/tasks/organisms/task-detail-surface.tsx", "utf8"),
    readFile("src/features/tasks/molecules/task-comment-timeline.tsx", "utf8"),
    readFile("src/features/profile/molecules/profile-notification-section.tsx", "utf8"),
  ]);

  assert.match(headerHook, /setInterval\(refreshNotifications, 60_000\)/);
  assert.match(headerHook, /workspace === "notifications" && refreshNotificationsWorkspace/);
  assert.match(headerData, /actorLabel: event\.actorLabel \|\| ""/);
  assert.match(headerData, /targetPath: event\.targetPath \|\| ""/);
  assert.match(notificationCommands, /if \(event\.targetPath\)[\s\S]*router\.push\(target\.href\)/);
  assert.match(surface, /requestedCommentTarget \? Math\.max\(activityCount, 1\) : activityCount/);
  assert.match(timeline, /taskCommentElementId\(requestedCommentTarget\)/);
  assert.match(timeline, /scrollIntoView/);
  assert.match(timeline, /GitHub-Kommentar wurde inzwischen gelöscht/);
  assert.match(settings, /In-App-Notifications sind immer aktiv/);
  assert.match(settings, /nur Hinweise in Google Chat/);
});
