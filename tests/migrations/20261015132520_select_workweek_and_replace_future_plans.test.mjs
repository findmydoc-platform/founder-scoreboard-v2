import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, assertRowsPreserved, resetLocalDatabaseTo, snapshotRows, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves existing plans and restricts selected-week helpers to their intended callers", {timeout:120_000}, async()=>{
  await resetLocalDatabaseTo("20261015070014");
  await withLocalDatabase(async db=>{
    await db.query("insert into public.profiles(id,name,platform_role) values('week-upgrade-owner','Owner','founder')");
    const source=(await db.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('week-upgrade-owner','2099-01-12') returning id")).rows[0];
    await db.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,publication_revision,published_at,last_sync_at)
      values($1,'week-upgrade-owner','2099-01-12','[]','published','confirmed',1,clock_timestamp(),clock_timestamp())`,[source.id]);
    const contracts=[
      {table:'team_workweek_versions',columns:['id','owner_profile_id','effective_from','activation_mode','successor_snapshot'],orderBy:['id']},
      {table:'team_workweek_publications',columns:['id','source_version_id','owner_profile_id','effective_from','effective_at','effective_until','windows','status','sync_state','publication_revision'],orderBy:['id']},
    ];
    const before=[];for(const contract of contracts)before.push(await snapshotRows(db,contract));
    await applyMigration(db,resolve('supabase/migrations/20261015132520_select_workweek_and_replace_future_plans.sql'));
    for(const [index,contract] of contracts.entries())assertRowsPreserved(before[index],await snapshotRows(db,contract));
    for(const role of ['anon','authenticated','service_role']){
      for(const signature of ['team_workweek_selected_binding(text,date)','team_workweek_selected_snapshot(text,uuid)','prepare_team_workweek_publication_before_week_selection(uuid)','finalize_team_workweek_publication_before_week_selection(uuid)']){
        expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,`public.${signature}`])).rows[0].allowed).toBe(false);
      }
      for(const signature of ['team_workweek_edit_context(date)','create_private_selected_team_workweek_version(date,jsonb,text)']){
        expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') as allowed",[role,`public.${signature}`])).rows[0].allowed).toBe(role==='authenticated');
      }
    }
    expect((await db.query("select selected_week_start from public.team_workweek_versions where id=$1",[source.id])).rows[0].selected_week_start).toBeNull();
  });
});
