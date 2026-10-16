import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves existing effect and dispatch evidence while keeping abort decisions service-only",{timeout:120000},async()=>{
  await resetLocalDatabaseTo("20261016080545");
  await withLocalDatabase(async db=>{
    await db.query("insert into public.profiles(id,name,platform_role) values('abort-upgrade-owner','Owner','viewer')");
    const source=(await db.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('abort-upgrade-owner','2099-01-12') returning id")).rows[0];
    const pub=(await db.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,effective_at,activation_mode,attempt_generation,write_journal_version,windows,status,sync_state) values($1,'abort-upgrade-owner','2099-01-12','2099-01-12T00:00:00+01','future_monday',1,1,'[]','preparing','delayed') returning id",[source.id])).rows[0];
    const effect=(await db.query("insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,kind,google_event_id,payload) values($1,'abort-upgrade-owner',1,'weekly','fopsabortupgrade','{}') returning id",[pub.id])).rows[0];
    const operation=(await db.query("insert into public.team_workweek_provider_operations(publication_id,owner_profile_id,generation,purpose) values($1,'abort-upgrade-owner',1,'publish') returning id",[pub.id])).rows[0];
    await db.query("insert into public.team_workweek_provider_writes(operation_id,effect_id,state) values($1,$2,'uncertain')",[operation.id,effect.id]);
    const tables=["team_workweek_versions","team_workweek_publications","team_workweek_publication_effects","team_workweek_provider_operations","team_workweek_provider_writes"];
    const snapshots=async()=>{
      const rows=[];
      for(const table of tables) rows.push((await db.query(`select to_jsonb(row_data)-'cleanup_skipped'-'last_error_class' as value from public.${table} row_data order by to_jsonb(row_data)::text`)).rows);
      return rows;
    };
    const before=await snapshots();
    await applyMigration(db,resolve("supabase/migrations/20261016092132_abort_undispatched_workweek_predecessors.sql"));
    expect(await snapshots()).toEqual(before);
    expect((await db.query("select cleanup_skipped from public.team_workweek_publication_effects where id=$1",[effect.id])).rows[0].cleanup_skipped).toBe(false);
    for(const signature of ["prepare_team_workweek_effect_cleanup(uuid,integer)","record_team_workweek_provider_write(uuid,uuid,text)","confirm_team_workweek_planned_cleanup(uuid,integer,text,boolean)","delay_team_workweek_publication(uuid,text,timestamp with time zone)"]){
      for(const role of ["anon","authenticated"]) expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,`public.${signature}`])).rows[0].allowed).toBe(false);
      expect((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') as allowed",[`public.${signature}`])).rows[0].allowed).toBe(true);
    }
  });
});
