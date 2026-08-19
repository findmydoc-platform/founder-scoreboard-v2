import pg from "pg";
import { readFile } from "node:fs/promises";

const client = new pg.Client({
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: "postgres",
  database: "postgres",
  ssl: false,
});

const suffix = Date.now();
const localTaskId = `verify-local-mention-${suffix}`;
const githubTaskId = `verify-github-mention-${suffix}`;
const existingLinkedTaskId = `verify-existing-github-link-${suffix}`;
const externalId = String(suffix);
const projectId = `verify-project-${suffix}`;
const actorProfileId = `verify-actor-${suffix}`;
const recipientProfileId = `verify-recipient-${suffix}`;
const secondRecipientProfileId = actorProfileId;

await client.connect();
await client.query("begin");

try {
  await client.query(
    "insert into public.projects (id, name) values ($1, 'Mention verification')",
    [projectId],
  );
  await client.query(
    `insert into public.profiles (id, name, role, github_login)
     values ($1, 'Verification Actor', 'member', 'verification-actor'),
            ($2, 'Verification Recipient', 'member', 'verification-recipient')`,
    [actorProfileId, recipientProfileId],
  );

  await client.query(
    `insert into public.tasks (id, project_id, title, status, priority)
     values ($1, $2, 'Local mention verification', 'Offen', 'P2')`,
    [localTaskId, projectId],
  );
  await client.query(
    `select public.create_task_comment_with_notifications($1, $2, $3, true, $4::text[], '{}'::text[])`,
    [localTaskId, actorProfileId, "Hello @recipient", [recipientProfileId]],
  );
  const localRows = await client.query(
    `select
      (select count(*)::integer from public.task_comments where task_id = $1) as comment_count,
      (select count(*)::integer from public.notification_events where entity_id = $1 and type = 'task.mention') as mention_count`,
    [localTaskId],
  );
  if (localRows.rows[0]?.comment_count !== 1 || localRows.rows[0]?.mention_count !== 1) {
    throw new Error("Local comment and mention notification were not created together.");
  }

  await client.query("savepoint invalid_local_recipient");
  try {
    await client.query(
      `select public.create_task_comment_with_notifications($1, $2, $3, true, $4::text[], '{}'::text[])`,
      [localTaskId, actorProfileId, "Atomic failure", ["missing-profile"]],
    );
    throw new Error("Invalid local mention recipient unexpectedly succeeded.");
  } catch (error) {
    if (error?.code !== "23503") throw error;
    await client.query("rollback to savepoint invalid_local_recipient");
  }
  const localAfterFailure = await client.query(
    "select count(*)::integer as count from public.task_comments where task_id = $1",
    [localTaskId],
  );
  if (localAfterFailure.rows[0]?.count !== 1) {
    throw new Error("A failed local notification left an orphan comment.");
  }

  await client.query("alter table public.tasks disable trigger tasks_github_comment_notification_watermark");
  await client.query(
    `insert into public.tasks (
       id, project_id, title, status, priority, github_repo, github_issue_number, github_comment_notifications_after
     ) values ($1, $2, 'Existing GitHub link verification', 'Offen', 'P2', 'findmydoc-platform/management', $3, null)`,
    [existingLinkedTaskId, projectId, Number(String(suffix).slice(-7)) + 2_000_000],
  );
  await client.query("alter table public.tasks enable trigger tasks_github_comment_notification_watermark");
  const migration = await readFile("supabase/migrations/20260819132108_comment_mention_notifications.sql", "utf8");
  const backfill = migration.match(/-- verify:watermark-backfill:start\n([\s\S]*?)\n-- verify:watermark-backfill:end/u)?.[1];
  if (!backfill) throw new Error("GitHub watermark backfill SQL could not be extracted.");
  await client.query(backfill);
  const existingWatermark = await client.query(
    "select github_comment_notifications_after as watermark from public.tasks where id = $1",
    [existingLinkedTaskId],
  );
  if (!existingWatermark.rows[0]?.watermark) {
    throw new Error("The migration did not backfill an existing linked task.");
  }

  await client.query(
    `insert into public.tasks (
       id, project_id, title, status, priority, github_repo, github_issue_number
     ) values ($1, $2, 'GitHub mention verification', 'Offen', 'P2', 'findmydoc-platform/management', $3)`,
    [githubTaskId, projectId, Number(String(suffix).slice(-7)) + 1_000_000],
  );
  const watermarkResult = await client.query(
    "select github_comment_notifications_after as watermark from public.tasks where id = $1",
    [githubTaskId],
  );
  const watermark = watermarkResult.rows[0]?.watermark;
  if (!watermark) throw new Error("GitHub notification watermark was not initialized.");

  const baseComment = {
    externalId,
    authorLogin: "outside-author",
    authorAvatarUrl: "",
    actorProfileId: "",
    mentionRecipientProfileIds: [recipientProfileId],
    body: "Historical comment with an existing mention",
    htmlUrl: "https://github.com/findmydoc-platform/management/issues/1#issuecomment-1",
    createdAt: new Date(watermark.getTime() - 60_000).toISOString(),
    sourceUpdatedAt: new Date(watermark.getTime() - 30_000).toISOString(),
    importedAt: new Date().toISOString(),
  };
  await client.query(
    "select public.import_github_task_comments_with_mentions($1, $2::jsonb)",
    [githubTaskId, JSON.stringify([baseComment])],
  );
  const historicalMentions = await client.query(
    "select count(*)::integer as count from public.notification_events where dedupe_key like $1",
    [`task.mention:github:${externalId}:%`],
  );
  if (historicalMentions.rows[0]?.count !== 0) {
    throw new Error("Historical first-import comment created a notification.");
  }

  const unrelatedEdit = {
    ...baseComment,
    body: "Historical mention with unrelated edited text",
    sourceUpdatedAt: new Date(watermark.getTime() + 1_000).toISOString(),
  };
  await client.query(
    "select public.import_github_task_comments_with_mentions($1, $2::jsonb)",
    [githubTaskId, JSON.stringify([unrelatedEdit])],
  );
  const unchangedHistoricalMention = await client.query(
    "select count(*)::integer as count from public.notification_events where dedupe_key = $1",
    [`task.mention:github:${externalId}:${recipientProfileId}`],
  );
  if (unchangedHistoricalMention.rows[0]?.count !== 0) {
    throw new Error("An unchanged historical mention created a notification after an unrelated edit.");
  }

  const editedComment = {
    ...unrelatedEdit,
    mentionRecipientProfileIds: [recipientProfileId, secondRecipientProfileId, secondRecipientProfileId],
    body: "Edited with one existing and one new mention",
    sourceUpdatedAt: new Date(watermark.getTime() + 2_000).toISOString(),
  };
  await client.query(
    "select public.import_github_task_comments_with_mentions($1, $2::jsonb)",
    [githubTaskId, JSON.stringify([editedComment])],
  );
  await client.query(
    "select public.import_github_task_comments_with_mentions($1, $2::jsonb)",
    [githubTaskId, JSON.stringify([editedComment])],
  );

  const staleComment = {
    ...baseComment,
    body: "Stale manual snapshot",
    sourceUpdatedAt: new Date(watermark.getTime() + 1_500).toISOString(),
  };
  await client.query(
    "select public.import_github_task_comments_with_mentions($1, $2::jsonb)",
    [githubTaskId, JSON.stringify([staleComment])],
  );
  const storedSnapshot = await client.query(
    "select body, mention_recipient_profile_ids from public.task_external_comments where source = 'github' and external_id = $1",
    [externalId],
  );
  if (
    storedSnapshot.rows[0]?.body !== editedComment.body
    || !storedSnapshot.rows[0]?.mention_recipient_profile_ids?.includes(secondRecipientProfileId)
  ) {
    throw new Error("A stale manual snapshot replaced newer GitHub comment state.");
  }
  await client.query(
    "delete from public.task_external_comments where source = 'github' and external_id = $1",
    [externalId],
  );
  const durableMention = await client.query(
    `select count(*)::integer as count, min(actor_label) as actor_label, min(target_path) as target_path
     from public.notification_events where dedupe_key = $1`,
    [`task.mention:github:${externalId}:${secondRecipientProfileId}`],
  );
  if (
    durableMention.rows[0]?.count !== 1
    || durableMention.rows[0]?.actor_label !== "outside-author"
    || !durableMention.rows[0]?.target_path?.includes(`comment=github:${externalId}`)
  ) {
    throw new Error("GitHub mention deduplication or durable target contract failed.");
  }

  console.log("Comment mention notification verification passed; all test data will be rolled back.");
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
