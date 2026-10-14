import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("batches existing context results without granting direct user access", async () => {
  await resetLocalDatabaseTo("20260928115917");
  await withLocalDatabase(async client => {
    const linkedUser = "62000000-0000-0000-0000-000000000011";
    const unlinkedUser = "62000000-0000-0000-0000-000000000012";
    const unmappedUser = "62000000-0000-0000-0000-000000000013";
    const ids = ["unlinked-profile", "missing-profile", "linked-profile"];
    const identity = { sub: "workspace-sub", iss: "https://accounts.google.com", email: "member@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } };

    await client.query("insert into auth.users(id) values ($1),($2),($3)", [linkedUser, unlinkedUser, unmappedUser]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ('linked-profile',$1,'Linked','founder'),('unlinked-profile',$2,'Unlinked','founder')", [linkedUser, unlinkedUser]);
    await client.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'google','workspace-sub',$2)", [linkedUser, JSON.stringify(identity)]);
    await client.query("insert into workspace_private.identity_bindings(user_id,google_subject) values ($1,'workspace-sub')", [linkedUser]);
    const original = [];
    for (const id of ids) {
      original.push((await client.query("select public.workspace_access_context(null::uuid,$1) as context", [id])).rows[0].context);
    }

    await applyMigration(client, resolve("supabase/migrations/20260930165131_batch_workspace_access_contexts.sql"));
    const batched = (await client.query("select public.workspace_access_contexts($1::text[]) as contexts", [ids])).rows[0].contexts;
    expect(batched).toEqual(original);
    expect(batched[0].linked).toBe(false);
    expect(batched[2].linked).toBe(true);
    expect((await client.query("select public.workspace_access_contexts('{}'::text[]) as contexts")).rows[0].contexts).toEqual([]);

    for (const role of ["anon", "authenticated"]) {
      expect((await client.query("select has_function_privilege($1,'public.workspace_access_contexts(text[])','execute') as allowed", [role])).rows[0].allowed).toBe(false);
    }
    expect((await client.query("select has_function_privilege('service_role','public.workspace_access_contexts(text[])','execute') as allowed")).rows[0].allowed).toBe(true);

    for (const [role, userId] of [["anon", null], ["authenticated", linkedUser], ["authenticated", unmappedUser]]) {
      await client.query("begin");
      try {
        if (userId) await client.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
        await client.query(`set local role ${role}`);
        await expect(client.query("select public.workspace_access_contexts($1::text[])", [ids])).rejects.toMatchObject({ code: "42501" });
      } finally {
        await client.query("rollback");
      }
    }
    await client.query("begin");
    try {
      await client.query("set local role service_role");
      expect((await client.query("select public.workspace_access_contexts($1::text[]) as contexts", [ids])).rows[0].contexts).toEqual(original);
    } finally {
      await client.query("rollback");
    }
  });
});
