import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves release data and reads only the admitted recipient under the service credential", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261121172048");
  await withLocalDatabase(async db => {
    const user = randomUUID(), other = randomUUID();
    const profile = "release-document-migration-reader", foreign = "release-document-migration-other";
    const version = "v9000.89.0", digest = "a".repeat(64);
    const manifest = { schemaVersion: 2, version, manifestDigest: digest, components: [] };
    await db.query(`insert into auth.users(id,email,role,aud) values
      ($1,'release-document-reader@example.test','authenticated','authenticated'),
      ($2,'release-document-other@example.test','authenticated','authenticated')`, [user, other]);
    await db.query(`insert into public.profiles(id,auth_user_id,name,platform_role) values
      ($1,$2,'Reader','viewer'),($3,$4,'Other','founder')`, [profile, user, foreign, other]);
    await db.query(`insert into public.platform_releases(version,schema_version,summary,published_at,plan_digest,content_digest,manifest_digest,manifest)
      values($1,2,'Existing release',now(),$2,$2,$2,$3)`, [version, digest, manifest]);
    const insertNotice = async recipient => (await db.query(`insert into public.notification_events
      (type,entity_type,entity_id,title,recipient_profile_id)
      values('platform_release.published','platform_release',$1,'New release',$2) returning id`, [version, recipient])).rows[0].id;
    await insertNotice(foreign);
    await insertNotice(null);
    const own = Number(await insertNotice(profile));
    const readRelease = () => db.query("select * from public.platform_releases where version=$1", [version]);
    const before = (await readRelease()).rows;

    await applyMigration(db, resolve("supabase/migrations/20261122143658_platform_release_document_snapshot.sql"));

    const read = (versionArg = version, userArg = user, profileArg = profile, role = "viewer") => db.query(
      "select public.platform_release_document_snapshot($1,$2,$3,$4) result", [versionArg, userArg, profileArg, role],
    );
    for (const role of ["anon", "authenticated"]) {
      await db.query(`set role ${role}`);
      try { await expect(read()).rejects.toMatchObject({ code: "42501" }); }
      finally { await db.query("reset role"); }
    }
    await db.query("set role service_role");
    try {
      expect((await read()).rows[0].result).toMatchObject({
        status: "ready",
        release: { version, summary: "Existing release", manifest_digest: digest, manifest },
        notification: { id: own, entity_id: version, seen_at: null },
      });
      for (const [owner, recipient, role] of [[user, foreign, "founder"], [user, profile, "ceo"], [randomUUID(), profile, "viewer"]]) {
        expect((await read(version, owner, recipient, role)).rows[0].result).toEqual({ status: "forbidden" });
      }
      expect((await read("v9000.89.1")).rows[0].result).toEqual({ status: "ready", release: null, notification: null });
      await db.query("delete from public.notification_events where id=$1", [own]);
      expect((await read()).rows[0].result).toMatchObject({ status: "ready", notification: null });
      await insertNotice(profile);
      await insertNotice(profile);
      expect((await read()).rows[0].result).toEqual({ status: "legacy-required" });
    } finally { await db.query("reset role"); }
    expect((await readRelease()).rows).toEqual(before);
  });
});
