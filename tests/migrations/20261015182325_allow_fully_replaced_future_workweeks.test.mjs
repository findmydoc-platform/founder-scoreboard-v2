import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, assertRowsPreserved, resetLocalDatabaseTo, snapshotRows, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves confirmed future plans and permits only explicitly superseded empty intervals", { timeout: 120_000 }, async () => {
  await resetLocalDatabaseTo("20261015132520");
  await withLocalDatabase(async db => {
    await db.query("insert into public.profiles(id,name,platform_role) values('replacement-upgrade-owner','Owner','founder')");
    const versions = (await db.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) select 'replacement-upgrade-owner','2099-01-12'::date from generate_series(1,2) returning id")).rows;
    const publications = [];
    for (const version of versions) {
      publications.push((await db.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,effective_at,windows,status,sync_state,publication_revision,published_at,last_sync_at)
        values($1,'replacement-upgrade-owner','2099-01-12','2099-01-11T23:00:00Z','[]','published','confirmed',$2,clock_timestamp(),clock_timestamp()) returning id`, [version.id, publications.length + 1])).rows[0]);
    }
    const contract = { table: "team_workweek_publications", columns: ["id", "source_version_id", "effective_at", "effective_until", "status", "windows", "superseded_by_publication_id"], orderBy: ["id"] };
    const before = await snapshotRows(db, contract);
    await applyMigration(db, resolve("supabase/migrations/20261015182325_allow_fully_replaced_future_workweeks.sql"));
    assertRowsPreserved(before, await snapshotRows(db, contract));
    await expect(db.query("update public.team_workweek_publications set effective_until=effective_at where id=$1", [publications[0].id])).rejects.toMatchObject({ code: "23514" });
    await db.query("update public.team_workweek_publications set effective_until=effective_at,effective_to='2099-01-11',superseded_by_publication_id=$2 where id=$1", [publications[0].id, publications[1].id]);
    await expect(db.query("update public.team_workweek_publications set superseded_by_publication_id=id where id=$1", [publications[0].id])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("update public.team_workweek_publications set effective_until=effective_at-interval '1 second' where id=$1", [publications[0].id])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("update public.team_workweek_publications set activation_mode='immediate' where id=$1", [publications[0].id])).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("update public.team_workweek_publications set status='preparing' where id=$1", [publications[0].id])).rejects.toMatchObject({ code: "23514" });
  });
});
