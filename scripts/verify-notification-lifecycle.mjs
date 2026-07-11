import pg from "pg";
import { loadLocalEnv } from "./lib/env.mjs";

await loadLocalEnv();

const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error("Missing SUPABASE_DB_PASSWORD.");
  process.exit(1);
}

const client = new pg.Client({
  host: process.env.SUPABASE_DB_HOST || "db.wmccchyodlljkkytebwg.supabase.co",
  port: 5432,
  user: process.env.SUPABASE_DB_USER || "postgres",
  password,
  database: process.env.SUPABASE_DB_NAME || "postgres",
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const columns = await client.query(
    `select column_name
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'notification_events'
       and column_name = any($1::text[])`,
    [["seen_at", "dismissed_at", "resolved_at", "resolution_reason"]],
  );
  if (columns.rows.length !== 4) throw new Error("Notification lifecycle columns are incomplete.");

  const index = await client.query(
    `select indexdef
     from pg_indexes
     where schemaname = 'public'
       and tablename = 'notification_events'
       and indexname = 'notification_events_unseen_recipient_created_idx'`,
  );
  if (!/status = 'pending'.*seen_at is null/i.test(index.rows[0]?.indexdef || "")) {
    throw new Error("Unseen notification partial index is missing or incomplete.");
  }

  const policies = await client.query(
    `select policyname, qual, with_check
     from pg_policies
     where schemaname = 'public'
       and tablename = 'notification_events'
       and policyname in ('notification_events_select_team', 'notification_events_update_recipient')`,
  );
  const policyText = JSON.stringify(policies.rows);
  if (
    policies.rows.length !== 2
    || !policyText.includes("recipient_profile_id IS NULL")
    || !policyText.includes("current_platform_role")
    || !policyText.includes("current_profile_id")
  ) {
    throw new Error("Notification lifecycle RLS policies do not enforce recipient and team-notification ownership.");
  }

  await client.query("begin");
  try {
    const profiles = await client.query(
      `select profile.id,
              auth_user.id::text as auth_user_id,
              profile.github_login,
              profile.platform_role
       from public.profiles as profile
       join auth.users as auth_user
         on lower(profile.github_login) = lower(coalesce(
           auth_user.raw_user_meta_data ->> 'user_name',
           auth_user.raw_user_meta_data ->> 'preferred_username'
         ))
       where profile.platform_role in ('ceo', 'founder')
       order by case profile.platform_role when 'ceo' then 0 else 1 end, profile.id`,
    );
    const ceo = profiles.rows.find((profile) => profile.platform_role === "ceo");
    const member = profiles.rows.find((profile) => profile.platform_role === "founder");
    if (!ceo || !member) throw new Error("Notification RLS verification requires one CEO and one team member.");

    await client.query("update public.profiles set platform_role = 'viewer' where id = $1", [member.id]);
    const events = await client.query(
      `insert into public.notification_events (type, recipient_profile_id, entity_type, entity_id, title)
       values
         ('task.comment', $1, 'task', 'notification-rls-own', 'Own notification'),
         ('task.comment', $2, 'task', 'notification-rls-foreign', 'Foreign notification'),
         ('task.proposed', null, 'task', 'notification-rls-team', 'Team notification')
       returning id, recipient_profile_id`,
      [member.id, ceo.id],
    );
    const ownId = events.rows.find((event) => event.recipient_profile_id === member.id)?.id;
    const foreignId = events.rows.find((event) => event.recipient_profile_id === ceo.id)?.id;
    const teamId = events.rows.find((event) => event.recipient_profile_id === null)?.id;

    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({
      sub: member.auth_user_id,
      role: "authenticated",
      user_metadata: { user_name: member.github_login },
    })]);
    await client.query("set local role authenticated");
    const viewerOwn = await client.query(
      "update public.notification_events set seen_at = now() where id = $1 returning id",
      [ownId],
    );
    const viewerForeign = await client.query(
      "update public.notification_events set seen_at = now() where id = $1 returning id",
      [foreignId],
    );
    const viewerTeam = await client.query(
      "update public.notification_events set seen_at = now() where id = $1 returning id",
      [teamId],
    );
    if (viewerOwn.rowCount !== 1 || viewerForeign.rowCount !== 0 || viewerTeam.rowCount !== 0) {
      throw new Error("Viewer notification ownership boundary is incorrect.");
    }
    const viewerDismiss = await client.query(
      "update public.notification_events set status = 'dismissed', seen_at = coalesce(seen_at, now()), dismissed_at = now() where id = $1 returning id",
      [ownId],
    );
    if (viewerDismiss.rowCount !== 1) throw new Error("Viewer could not dismiss an own notification.");

    await client.query("savepoint viewer_system_resolution");
    try {
      await client.query(
        "update public.notification_events set status = 'resolved', resolved_at = now(), resolution_reason = 'forbidden' where id = $1",
        [ownId],
      );
      throw new Error("Viewer unexpectedly set a system resolution.");
    } catch (error) {
      if (error?.code !== "42501") throw error;
      await client.query("rollback to savepoint viewer_system_resolution");
    }

    await client.query("reset role");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({
      sub: ceo.auth_user_id,
      role: "authenticated",
      user_metadata: { user_name: ceo.github_login },
    })]);
    await client.query("set local role authenticated");
    const leadForeignPersonal = await client.query(
      "update public.notification_events set seen_at = now() where id = $1 returning id",
      [ownId],
    );
    const leadTeam = await client.query(
      "update public.notification_events set seen_at = now() where id = $1 returning id",
      [teamId],
    );
    if (leadForeignPersonal.rowCount !== 0 || leadTeam.rowCount !== 1) {
      throw new Error("Operational lead notification ownership boundary is incorrect.");
    }
  } finally {
    await client.query("reset role").catch(() => {});
    await client.query("rollback").catch(() => {});
  }

  console.log("Notification lifecycle schema, partial index, user transitions, and RLS verification passed.");
} finally {
  await client.end();
}
