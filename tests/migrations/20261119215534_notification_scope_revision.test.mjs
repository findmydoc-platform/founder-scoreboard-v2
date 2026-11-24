import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("publishes an authenticated notification source that changes on same-count lifecycle edits", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261118114446");
  await withLocalDatabase(async db => {
    const userId = randomUUID(), sessionId = randomUUID();
    await db.query("insert into auth.users(id,email,role,aud) values($1,'notification-revision@example.test','authenticated','authenticated')", [userId]);
    await db.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,now())", [sessionId, userId]);
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('notification-revision-owner',$1,'Owner','viewer')", [userId]);
    const inserted = await db.query("insert into public.notification_events(type,recipient_profile_id,entity_type,entity_id,title) values('task.mention','notification-revision-owner','task','target','Existing') returning id");
    const eventId = inserted.rows[0].id;
    await applyMigration(db, resolve("supabase/migrations/20261119215534_notification_scope_revision.sql"));
    expect((await db.query("select title from public.notification_events where id=$1", [eventId])).rows).toEqual([{ title: "Existing" }]);
    const identity = { sub: userId, role: "authenticated", session_id: sessionId };
    const read = async () => {
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(identity)]);
      await db.query("set role authenticated");
      try { return (await db.query("select public.notification_publication_context() value")).rows[0].value; }
      finally { await db.query("reset role"); }
    };
    const initial = await read();
    expect(initial).toMatchObject({ profile_id: "notification-revision-owner", platform_role: "viewer" });
    await db.query("update public.notification_events set seen_at=now() where id=$1", [eventId]);
    const seen = await read();
    expect(seen.source_revision).not.toBe(initial.source_revision);
    await db.query("update public.profiles set name='Updated' where id='notification-revision-owner'");
    const profile = await read();
    expect(profile.source_revision).not.toBe(seen.source_revision);
    await db.query("delete from public.notification_events where id=$1", [eventId]);
    expect((await read()).source_revision).not.toBe(profile.source_revision);
    expect((await db.query("select has_function_privilege('anon','public.notification_publication_context()','execute') allowed")).rows[0].allowed).toBe(false);
    expect((await db.query("select has_function_privilege('service_role','public.notification_publication_context()','execute') allowed")).rows[0].allowed).toBe(false);
    await db.query("delete from auth.sessions where id=$1", [sessionId]);
    await expect(read()).rejects.toMatchObject({ code: "42501" });
  });
});
