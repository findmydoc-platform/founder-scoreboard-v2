import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves published history and existing attempts while installing the journal contract", async () => {
  await resetLocalDatabaseTo("20261028045846");
  await withLocalDatabase(async db => {
    await db.query("insert into public.profiles(id,name,platform_role) values('journal-history','History','viewer')");
    const versions = (await db.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('journal-history','2026-10-05'),('journal-history','2099-01-12') returning id,effective_from")).rows;
    await db.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision,attempt_generation,write_journal_version)
      values($1,'journal-history','2026-10-05','[]','published','confirmed',now(),now(),1,0,0),
      ($2,'journal-history','2099-01-12','[]','preparing','delayed',null,null,2,1,1)`, versions.map(row => row.id));
    const tables = ["profiles", "team_workweek_versions", "team_workweek_publications"];
    const snapshot = async () => {
      const rows = {};
      for (const table of tables) rows[table] = (await db.query(`select to_jsonb(row) as data from public.${table} row order by to_jsonb(row)::text`)).rows;
      return rows;
    };
    const before = await snapshot();
    await applyMigration(db, resolve("supabase/migrations/20261031183529_require_workweek_write_journals.sql"));
    expect(await snapshot()).toEqual(before);
    for (const role of ["anon", "authenticated"]) {
      for (const signature of ["dispatch_google_calendar_mutation(text,text,uuid,uuid,text,text,boolean)", "record_google_workspace_disconnect_write(uuid,text)"]) {
        expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, `public.${signature}`])).rows[0].allowed).toBe(false);
      }
    }
    expect((await db.query("select write_journal_version,attempt_generation from public.team_workweek_publications where status='published'")).rows).toEqual([{write_journal_version:0,attempt_generation:0}]);
  });
});
