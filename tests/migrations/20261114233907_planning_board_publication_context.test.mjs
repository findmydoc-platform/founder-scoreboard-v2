import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves existing data and restricts publication context to the authenticated live actor", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261114152512");
  await withLocalDatabase(async client => {
    const user = randomUUID(), session = randomUUID(), missingUser = randomUUID();
    await client.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values($1,'synthetic-publication@example.test','authenticated','authenticated',now())", [user]);
    await client.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,now())", [session, user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('publication-founder',$1,'Synthetic publication Founder','founder')", [user]);
    const tables = ["public.profiles", "auth.users", "auth.sessions"];
    const before = new Map();
    for (const table of tables) before.set(table, (await client.query(`select * from ${table} order by id`)).rows);
    const revision = (await client.query("select public.planning_source_version() as value")).rows[0].value;
    await applyMigration(client, resolve("supabase/migrations/20261114233907_planning_board_publication_context.sql"));
    for (const table of tables) expect((await client.query(`select * from ${table} order by id`)).rows).toEqual(before.get(table));
    expect((await client.query("select public.planning_source_version() as value")).rows[0].value).toBe(revision);
    for (const role of ["anon", "service_role"]) {
      await client.query(`set role ${role}`);
      try { await expect(client.query("select public.planning_board_publication_context()")).rejects.toMatchObject({ code: "42501" }); }
      finally { await client.query("reset role"); }
    }
    await client.query("set role authenticated");
    try {
      const claims = async sub => client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub, role: "authenticated", session_id: session })]);
      await claims(user);
      expect((await client.query("select public.planning_board_publication_context() as value")).rows[0].value).toEqual({
        profile_id: "publication-founder", platform_role: "founder", source_revision: revision,
      });
      await claims(missingUser);
      await expect(client.query("select public.planning_board_publication_context()")).rejects.toMatchObject({ code: "42501" });
    } finally { await client.query("reset role"); }
    await client.query("delete from auth.sessions where id=$1", [session]);
    await client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role: "authenticated", session_id: session })]);
    await client.query("set role authenticated");
    try { await expect(client.query("select public.planning_board_publication_context()")).rejects.toMatchObject({ code: "42501" }); }
    finally { await client.query("reset role"); }
  });
});
