import { resolve } from "node:path";
import { it, expect } from "vitest";
import { resetLocalDatabaseTo, withLocalDatabase, applyMigration } from "./helpers/migration-test-harness.mjs";

it("adds an inactive linking boundary without changing accounts or integrations", async () => {
  await resetLocalDatabaseTo("20260926204911");
  await withLocalDatabase(async client => {
    const uid = "62000000-0000-0000-0000-000000000002";
    await client.query("insert into auth.users(id,email) values ($1,'original@example.com')", [uid]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ('linking-founder',$1,'Founder','founder')", [uid]);
    const before = (await client.query("select * from public.profiles where id='linking-founder'")).rows;
    await applyMigration(client, resolve("supabase/migrations/20260928115917_mandatory_google_linking.sql"));
    expect((await client.query("select * from public.profiles where id='linking-founder'")).rows).toEqual(before);
    expect((await client.query("select email from auth.users where id=$1", [uid])).rows[0].email).toBe("original@example.com");
    expect((await client.query("select linking_enforced from workspace_private.configuration")).rows[0].linking_enforced).toBe(false);
    for (const role of ["anon", "authenticated"]) {
      expect((await client.query("select has_function_privilege($1,'public.workspace_record_google_login(uuid,uuid,text)','execute') as allowed", [role])).rows[0].allowed).toBe(false);
      expect((await client.query("select has_function_privilege($1,'public.workspace_linking_session_allowed(uuid,uuid)','execute') as allowed", [role])).rows[0].allowed).toBe(false);
      expect((await client.query("select has_function_privilege($1,'public.workspace_issue_permit(text,uuid,text,text,text,uuid)','execute') as allowed", [role])).rows[0].allowed).toBe(false);
    }
  });
});
