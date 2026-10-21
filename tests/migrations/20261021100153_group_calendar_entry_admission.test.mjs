import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("groups Calendar entry admission without changing identity, session or profile data and denies user-role execution", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261017144737");
  await withLocalDatabase(async client => {
    const userId = randomUUID(), sessionId = randomUUID(), subject = randomUUID(), profileId = `calendar-entry-${randomUUID()}`;
    await client.query("insert into auth.users(id,email) values($1,'synthetic-entry@findmydoc.eu')", [userId]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,'Synthetic Calendar entry','viewer')", [profileId,userId]);
    await client.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values($1,'google',$2,$3)", [userId,subject,JSON.stringify({ sub: subject, email: "synthetic-entry@findmydoc.eu", email_verified: true, iss: "accounts.google.com", custom_claims: { hd: "findmydoc.eu" } })]);
    await client.query("insert into workspace_private.identity_bindings(user_id,google_subject) values($1,$2)", [userId,subject]);
    await client.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())", [sessionId,userId]);
    const snapshot = async () => ({
      profiles: (await client.query("select * from public.profiles where id=$1", [profileId])).rows,
      identities: (await client.query("select * from auth.identities where user_id=$1", [userId])).rows,
      sessions: (await client.query("select * from auth.sessions where id=$1", [sessionId])).rows,
      bindings: (await client.query("select * from workspace_private.identity_bindings where user_id=$1", [userId])).rows,
      grants: (await client.query("select grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='profiles' order by grantee,privilege_type")).rows,
    });
    const before = await snapshot();
    await applyMigration(client, resolve("supabase/migrations/20261021100153_group_calendar_entry_admission.sql"));
    expect(await snapshot()).toEqual(before);
    const signature = "public.workspace_calendar_entry(uuid,uuid)";
    const definition = (await client.query("select pg_get_userbyid(proowner) as owner,prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure", [signature])).rows[0];
    expect(definition).toEqual({ owner: "postgres", prosecdef: true, provolatile: "s", proconfig: ['search_path=""'] });
    expect((await client.query("select has_function_privilege('service_role',$1,'execute') as allowed", [signature])).rows[0].allowed).toBe(true);
    expect((await client.query("select count(*)::int as count from pg_proc p, lateral aclexplode(p.proacl) acl where p.oid=$1::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE'", [signature])).rows[0].count).toBe(0);
    for (const role of ["anon", "authenticated"]) {
      expect((await client.query("select has_function_privilege($1,$2,'execute') as allowed", [role,signature])).rows[0].allowed).toBe(false);
      expect((await client.query("select has_schema_privilege($1,'workspace_private','usage') as allowed", [role])).rows[0].allowed).toBe(false);
      await client.query(`set role ${role}`);
      try {
        await expect(client.query("select public.workspace_calendar_entry($1,$2)", [userId,sessionId])).rejects.toMatchObject({ code: "42501" });
      } finally { await client.query("reset role"); }
    }
    const entry = async (uid = userId, sid = sessionId) => {
      await client.query("set role service_role");
      try { return (await client.query("select public.workspace_calendar_entry($1,$2) as context", [uid,sid])).rows[0].context; }
      finally { await client.query("reset role"); }
    };
    for (const [mode,enforced] of [["legacy",false],["linking",false]]) {
      await client.query("update workspace_private.configuration set mode=$1,linking_enforced=$2", [mode,enforced]);
      expect(await entry(userId,randomUUID())).toMatchObject({ mode, linkingEnforced: enforced, userId, profileId, linked: true, sessionAllowed: null, sessionError: false });
    }
    await client.query("update workspace_private.configuration set mode='linking',linking_enforced=true");
    expect(await entry()).toMatchObject({ sessionAllowed: false, sessionError: false });
    await client.query("select public.workspace_record_google_login($1,$2,$3)", [userId,sessionId,subject]);
    expect(await entry()).toMatchObject({ sessionAllowed: true, sessionError: false });
    expect(await entry(userId,randomUUID())).toMatchObject({ sessionAllowed: false, sessionError: false });
    expect(await entry(randomUUID(),sessionId)).toMatchObject({ profileId: null, userId: null, sessionAllowed: false });
    await client.query("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id=$1", [sessionId]);
    expect(await entry()).toMatchObject({ sessionAllowed: false });
    await client.query("update auth.sessions set not_after=null where id=$1", [sessionId]);
    await client.query("update workspace_private.configuration set mode='google',linking_enforced=false");
    expect(await entry()).toMatchObject({ mode: "google", sessionAllowed: false });
    await client.query("update auth.sessions set created_at=clock_timestamp()+interval '1 second' where id=$1", [sessionId]);
    expect(await entry()).toMatchObject({ mode: "google", sessionAllowed: true });
    await client.query("delete from auth.sessions where id=$1", [sessionId]);
    expect(await entry()).toMatchObject({ sessionAllowed: false });
  });
});
