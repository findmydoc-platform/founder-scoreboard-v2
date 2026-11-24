import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("adds a service-only count without mutating existing notifications", { timeout: 120_000 }, async () => {
  await resetLocalDatabaseTo("20261119215534");
  await withLocalDatabase(async db => {
    const userId = randomUUID(), sessionId = randomUUID(), profileId = "notification-count-migration-viewer";
    await db.query("insert into auth.users(id,email,role,aud) values($1,'notification-count-migration@example.test','authenticated','authenticated')", [userId]);
    await db.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,now())", [sessionId, userId]);
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,'Count reader','viewer')", [profileId, userId]);
    await db.query(`insert into public.notification_events(type,recipient_profile_id,entity_type,entity_id,title)
      values('platform_release.published',$1,'platform_release','existing-release','Existing release')`, [profileId]);
    const before = await db.query("select * from public.notification_events where recipient_profile_id=$1", [profileId]);
    await applyMigration(db, resolve("supabase/migrations/20261120085202_notification_count_fast_path.sql"));
    const read = () => db.query(`select public.notification_count_fast_path($1,$2,$3,'viewer',statement_timestamp()+interval '1 minute') result`, [userId, sessionId, profileId]);
    await db.query("set role service_role");
    try { expect((await read()).rows[0].result).toMatchObject({ status: "ready", unread_count: 1 }); }
    finally { await db.query("reset role"); }
    await db.query("set role authenticated");
    try { await expect(read()).rejects.toMatchObject({ code: "42501" }); }
    finally { await db.query("reset role"); }
    expect((await db.query("select * from public.notification_events where recipient_profile_id=$1", [profileId])).rows).toEqual(before.rows);
  });
});
