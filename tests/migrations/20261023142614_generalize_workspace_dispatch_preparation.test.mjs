import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

const migration = resolve("supabase/migrations/20261023142614_generalize_workspace_dispatch_preparation.sql");
const signature = "public.workspace_dispatch_prepare(text,uuid,text,text,text,uuid,text,text,boolean,text,text)";
async function snapshot(client) {
  const profiles = (await client.query("select id,auth_user_id,name,platform_role from public.profiles order by id")).rows;
  const configuration = (await client.query("select * from workspace_private.configuration")).rows;
  const functions = (await client.query("select oid::regprocedure::text as signature,proacl,proconfig from pg_proc where oid in ('public.workspace_calendar_prepare(text,uuid,text,text,text,uuid,text,text,boolean,text,text)'::regprocedure,'public.current_authenticated_profile()'::regprocedure,'public.workspace_issue_permit(text,uuid,text,text,text,uuid)'::regprocedure,'public.workspace_access_context(uuid,text)'::regprocedure) order by oid::regprocedure::text")).rows;
  const boundaries = (await client.query("select schemaname,tablename,policyname,roles,cmd,qual,with_check from pg_policies where schemaname in ('public','workspace_private','storage') order by schemaname,tablename,policyname")).rows;
  return { profiles,configuration,functions,boundaries };
}
it("generalizes server-only preparation while preserving rows and the Calendar compatibility contract", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261021100245");
  await withLocalDatabase(async client => {
    const user = "64000000-0000-4000-8000-000000000052";
    await client.query("insert into auth.users(id,email) values($1,'calendar-migration@example.test')",[user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('calendar-migration',$1,'Preserved viewer','viewer')",[user]);
    const before = await snapshot(client);
    await applyMigration(client,migration);
    expect(await snapshot(client)).toEqual(before);
    for (const role of ["anon","authenticated"]) {
      expect((await client.query("select has_function_privilege($1,$2,'execute') as allowed",[role,signature])).rows[0].allowed).toBe(false);
    }
    expect((await client.query("select has_function_privilege('service_role',$1,'execute') as allowed",[signature])).rows[0].allowed).toBe(true);
    await applyMigration(client,migration);
    expect(await snapshot(client)).toEqual(before);
  });
});
