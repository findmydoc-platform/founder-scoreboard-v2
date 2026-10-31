import { confirmObservedCleanup, confirmObservedEffect } from "./helpers/workweek-provider";
import { expect,it } from "vitest";
import { asAuthenticated,captureDatabaseError,withIsolatedLocalDatabase } from "./helpers/local-database";

it.each([["founderops","immediate"],["google","immediate"],["founderops","future_monday"]])("publishes the explicit %s choice with %s activation and replays its identity",async(decision,mode)=>{
  await withIsolatedLocalDatabase(async client=>{
    const user="59300000-0000-4000-8000-000000000001";
    await client.query("insert into auth.users(id) values($1)",[user]);await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('conflict-owner',$1,'Owner','founder')",[user]);
    const source=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('conflict-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date-7) returning id,effective_from")).rows[0];
    const pub=(await client.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at) values($1,'conflict-owner',$2,'[{\"weekday\":1,\"startMinute\":540,\"endMinute\":1020}]','published','confirmed',clock_timestamp(),clock_timestamp()) returning id,publication_revision",[source.id,source.effective_from])).rows[0];
    const privateDraft=(await asAuthenticated(client,user,()=>mode==="future_monday"?client.query("select public.create_private_team_workweek_version(date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7,'[{\"weekday\":1,\"startMinute\":600,\"endMinute\":1080}]') as result"):client.query("select public.create_private_current_team_workweek_version('[{\"weekday\":1,\"startMinute\":600,\"endMinute\":1080}]',$1,$2) as result",[pub.id,pub.publication_revision]))).rows[0].result;
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");await client.query("set local role service_role");
    const captured=(await client.query("select public.capture_team_workweek_physical_conflict('conflict-owner',$1,$2,'[{\"weekday\":1,\"startMinute\":660,\"endMinute\":1140}]','[]',$3,true,true,clock_timestamp()) as result",[pub.id,pub.publication_revision,"a".repeat(64)])).rows[0].result;
    const conflict=(await client.query("select * from public.team_workweek_google_conflicts where id=$1",[captured.id])).rows[0];
    expect(conflict.founderops_binding_snapshot.versionId).toBe(privateDraft.id);
    const args=[captured.id,pub.publication_revision,decision,JSON.stringify(conflict.google_observations),conflict.google_fingerprint,conflict.founderops_fingerprint,"b".repeat(64)];
    const prepare=()=>client.query("select public.prepare_team_workweek_google_conflict_resolution($1,'conflict-owner',$2,$3,$4,$5,$6,$7,clock_timestamp()) as result",args);
    const prepared=(await prepare()).rows[0].result;expect((await prepare()).rows[0].result).toEqual({...prepared,replayed:true});await client.query("reset role");
    const publication=(await asAuthenticated(client,user,()=>client.query("select public.prepare_team_workweek_publication($1,1) as result",[prepared.versionId]))).rows[0].result;
    expect(publication.activationMode).toBe(mode);expect(publication.attemptGeneration).toBe(1);expect((await client.query("select windows from public.team_workweek_publications where id=$1",[publication.id])).rows[0].windows).toEqual([{weekday:1,startMinute:decision==="founderops"?600:660,endMinute:decision==="founderops"?1080:1140}]);
    for(const effect of publication.effects){await client.query("set local role service_role");await confirmObservedEffect(client, effect.id, 1, "confirmed", effect.payload);await client.query("reset role");}
    await asAuthenticated(client,user,()=>client.query("select public.finalize_team_workweek_publication($1)",[publication.id]));
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");await client.query("set local role service_role");await client.query("select public.complete_team_workweek_google_conflict_resolution($1,'conflict-owner',$2,clock_timestamp())",[captured.id,conflict.conflict_revision]);await client.query("reset role");
    expect((await client.query("select retired_at from public.team_workweek_versions where id=$1",[privateDraft.id])).rows[0].retired_at).toBeTruthy();
  });
},30_000);

it("rejects an unsupported Google decision and a changed captured future context",async()=>{
  await withIsolatedLocalDatabase(async client=>{
    const user="59400000-0000-4000-8000-000000000001";await client.query("insert into auth.users(id) values($1)",[user]);await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('ambiguous-owner',$1,'Owner','deputy')",[user]);
    const source=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('ambiguous-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date-7) returning id,effective_from")).rows[0];
    const pub=(await client.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at) values($1,'ambiguous-owner',$2,'[]','published','confirmed',clock_timestamp(),clock_timestamp()) returning id,publication_revision",[source.id,source.effective_from])).rows[0];
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");await client.query("set local role service_role");
    const capture=(await client.query("select public.capture_team_workweek_physical_conflict('ambiguous-owner',$1,$2,'[]','[]',$3,false,true,clock_timestamp()) as result",[pub.id,pub.publication_revision,"c".repeat(64)])).rows[0].result;
    const conflict=(await client.query("select * from public.team_workweek_google_conflicts where id=$1",[capture.id])).rows[0];
    const resolution=(choice:string)=>client.query("select public.prepare_team_workweek_google_conflict_resolution($1,'ambiguous-owner',$2,$3,'[]',$4,$5,$6,clock_timestamp())",[capture.id,conflict.conflict_revision,choice,conflict.google_fingerprint,conflict.founderops_fingerprint,"d".repeat(64)]);
    expect(await captureDatabaseError(client,()=>resolution("google"))).toMatchObject({code:"P0004"});await client.query("reset role");
    const future=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('ambiguous-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7) returning id,effective_from")).rows[0];
    await client.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision) values($1,'ambiguous-owner',$2,'[]','published','confirmed',clock_timestamp(),clock_timestamp(),2)",[future.id,future.effective_from]);await client.query("set local role service_role");
    expect(await captureDatabaseError(client,()=>resolution("founderops"))).toMatchObject({code:"P0004"});
  });
},30_000);


it("explicitly restarts an expired resolving conflict from its original private source",async()=>{
  const decision="google";
  await withIsolatedLocalDatabase(async client=>{
    const user="59300000-0000-4000-8000-000000000001";
    await client.query("insert into auth.users(id) values($1)",[user]);await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('conflict-owner',$1,'Owner','founder')",[user]);
    const source=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('conflict-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date-7) returning id,effective_from")).rows[0];
    const pub=(await client.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at) values($1,'conflict-owner',$2,'[{\"weekday\":1,\"startMinute\":540,\"endMinute\":1020}]','published','confirmed',clock_timestamp(),clock_timestamp()) returning id,publication_revision",[source.id,source.effective_from])).rows[0];
    const privateDraft=(await asAuthenticated(client,user,()=>client.query("select public.create_private_current_team_workweek_version('[{\"weekday\":1,\"startMinute\":600,\"endMinute\":1080}]',$1,$2) as result",[pub.id,pub.publication_revision]))).rows[0].result;
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");await client.query("set local role service_role");
    const captured=(await client.query("select public.capture_team_workweek_physical_conflict('conflict-owner',$1,$2,'[{\"weekday\":1,\"startMinute\":660,\"endMinute\":1140}]','[]',$3,true,true,clock_timestamp()) as result",[pub.id,pub.publication_revision,"a".repeat(64)])).rows[0].result;
    const conflict=(await client.query("select * from public.team_workweek_google_conflicts where id=$1",[captured.id])).rows[0];
    expect(conflict.founderops_binding_snapshot.versionId).toBe(privateDraft.id);
    const args=[captured.id,pub.publication_revision,decision,JSON.stringify(conflict.google_observations),conflict.google_fingerprint,conflict.founderops_fingerprint,"b".repeat(64)];
    const prepare=()=>client.query("select public.prepare_team_workweek_google_conflict_resolution($1,'conflict-owner',$2,$3,$4,$5,$6,$7,clock_timestamp()) as result",args);
    const prepared=(await prepare()).rows[0].result;expect((await prepare()).rows[0].result).toEqual({...prepared,replayed:true});await client.query("reset role");
    const publication=(await asAuthenticated(client,user,()=>client.query("select public.prepare_team_workweek_publication($1,1) as result",[prepared.versionId]))).rows[0].result;
    expect(publication.activationMode).toBe("immediate");expect(publication.attemptGeneration).toBe(1);expect((await client.query("select windows from public.team_workweek_publications where id=$1",[publication.id])).rows[0].windows).toEqual([{weekday:1,startMinute:660,endMinute:1140}]);

    await client.query("update public.team_workweek_publications set effective_at=clock_timestamp()-interval '1 minute' where id=$1",[publication.id]);
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");await client.query("set local role service_role");
    const plan=(await client.query("select public.prepare_team_workweek_effect_cleanup($1,1) as result",[publication.id])).rows[0].result;
    for(const effect of plan.effects)await confirmObservedCleanup(client, effect.id, 1, "absent", false);await client.query("reset role");
    const restarted=(await asAuthenticated(client,user,()=>client.query("select public.restart_private_team_workweek_version($1) as result",[privateDraft.id]))).rows[0].result;
    expect(restarted.versionId).not.toBe(privateDraft.id);
    expect((await client.query("select status,deactivation_reason from public.team_workweek_publications where id=$1",[publication.id])).rows[0]).toEqual({status:"inactive",deactivation_reason:"private_restart"});
    expect((await client.query("select state from public.team_workweek_google_conflicts where id=$1",[captured.id])).rows[0].state).toBe("cancelled");
    expect((await client.query("select weekday,start_minute,end_minute from public.team_workweek_windows where version_id=$1",[restarted.versionId])).rows).toEqual([{weekday:1,start_minute:600,end_minute:1080}]);
  });
},30_000);
