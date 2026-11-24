import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves existing release rows and limits the reference snapshot to its server credential", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261120090930");
  await withLocalDatabase(async db => {
    const user = randomUUID(), session = randomUUID(), profile = "release-reference-migration-viewer";
    const version = "v9000.1.0", manifestDigest = "a".repeat(64);
    await db.query("insert into auth.users(id,email,role,aud) values($1,'release-reference-migration@example.test','authenticated','authenticated')", [user]);
    await db.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,now())", [session, user]);
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,'Reader','viewer')", [profile, user]);
    await db.query(`insert into public.platform_releases(version,schema_version,summary,published_at,plan_digest,content_digest,manifest_digest,manifest)
      values($1,2,'Existing release',now(),$2,$2,$2,$3)`, [version, manifestDigest, { version, manifestDigest, schemaVersion: 2, components: [] }]);
    const before = (await db.query("select * from public.platform_releases where version=$1", [version])).rows;
    await applyMigration(db, resolve("supabase/migrations/20261120102829_planning_release_reference_snapshot.sql"));
    const read = () => db.query(`select public.planning_release_reference_snapshot($1,$2,$3,'viewer',statement_timestamp()+interval '1 minute',$4) result`,
      [user, session, profile, JSON.stringify([{ version, manifestDigest }])]);
    await db.query("set role service_role");
    try { expect((await read()).rows[0].result).toMatchObject({ status: "ready", releases: [{ version, manifestDigest, planningReferences: [] }] }); }
    finally { await db.query("reset role"); }
    await db.query("set role authenticated");
    try { await expect(read()).rejects.toMatchObject({ code: "42501" }); }
    finally { await db.query("reset role"); }
    expect((await db.query("select * from public.platform_releases where version=$1", [version])).rows).toEqual(before);
  });
});
