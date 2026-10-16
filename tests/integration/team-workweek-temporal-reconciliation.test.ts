import { expect, it } from "vitest";
import { asAuthenticated, captureDatabaseError, withIsolatedLocalDatabase } from "./helpers/local-database";

it("publishes a managed Google correction through current activation while retaining the prepared successor", async () => {
  await withIsolatedLocalDatabase(async client => {
    const user="59000000-0000-4000-8000-000000000001";
    await client.query("insert into auth.users(id) values($1)",[user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('reconcile-owner',$1,'Owner','viewer')",[user]);
    const source=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('reconcile-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date-7) returning id,effective_from")).rows[0];
    const futureSource=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('reconcile-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7) returning id,effective_from")).rows[0];
    const future=(await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values($1,'reconcile-owner',$2,'[]','published','confirmed',clock_timestamp(),clock_timestamp(),2) returning *`,[futureSource.id,futureSource.effective_from])).rows[0];
    const current=(await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,effective_to,superseded_by_publication_id,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values($1,'reconcile-owner',$2,$3::date-1,$4,'[{"weekday":1,"startMinute":540,"endMinute":1020}]','published','confirmed',clock_timestamp(),clock_timestamp(),1) returning id`,[source.id,source.effective_from,futureSource.effective_from,future.id])).rows[0];
    const window=(await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,1,540,1020) returning id",[source.id])).rows[0];
    const series=(await client.query(`insert into public.team_workweek_google_series(publication_id,source_window_id,owner_profile_id,google_event_id,state,confirmed_etag,confirmed_founderops_revision,last_confirmed_at)
      values($1,$2,'reconcile-owner','fopsreconcile01','confirmed','old-etag',1,clock_timestamp()) returning id`,[current.id,window.id])).rows[0];
    const observed={id:"fopsreconcile01",start:{dateTime:"2020-08-31T08:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2020-08-31T16:00:00Z",timeZone:"Europe/Berlin"},recurrence:["RRULE:FREQ=WEEKLY"],extendedProperties:{private:{founderopsWorkweekSeriesId:series.id,founderopsWorkweekRevision:"1"}}};
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");
    await client.query("set local role service_role");
    const prepared=(await client.query("select public.prepare_google_team_workweek_reconciliation('reconcile-owner',$1,1,$2,$3,'[{\"weekday\":1,\"startMinute\":600,\"endMinute\":1080}]',$4,clock_timestamp()) as result",[current.id,futureSource.effective_from,JSON.stringify([{seriesId:series.id,priorEtag:"old-etag",observedEtag:"new-etag",founderopsRevision:1,providerState:"active",observedPayload:observed}]),"a".repeat(64)])).rows[0].result;
    await client.query("reset role");
    const publication=(await asAuthenticated(client,user,()=>client.query("select public.prepare_team_workweek_publication($1,1) as publication",[prepared.versionId]))).rows[0].publication;
    expect(publication.activationMode).toBe("immediate");
    expect(publication.successorPublicationId).toBe(future.id);
    expect(publication.effects.find((effect:{kind:string})=>effect.kind==="predecessor_cutoff").expectedPayload.start).toEqual(observed.start);
    for(const effect of publication.effects){
      await client.query("set local role service_role");
      await client.query("select public.confirm_team_workweek_effect($1,$2,'etag',$3)",[effect.id,effect.generation,effect.payload]);
      await client.query("reset role");
    }
    expect((await asAuthenticated(client,user,()=>client.query("select public.finalize_team_workweek_publication($1) as publication",[publication.id]))).rows[0].publication.status).toBe("published");
    expect((await client.query("select * from public.team_workweek_publications where id=$1",[future.id])).rows[0]).toEqual(future);
  });
},30_000);


it.each(["ceo", "founder", "deputy", "viewer"])("lets the mapped %s owner restart a stale automatic correction while keeping private inputs", async role => {
  await withIsolatedLocalDatabase(async client => {
    const owner="59800000-0000-4000-8000-000000000001",foreign="59800000-0000-4000-8000-000000000002",unmapped="59800000-0000-4000-8000-000000000003";
    await client.query("insert into auth.users(id) values($1),($2),($3)",[owner,foreign,unmapped]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('automatic-owner',$1,'Owner',$3),('automatic-foreign',$2,'Foreign','ceo')",[owner,foreign,role]);
    const oldSource=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('automatic-owner','2020-08-31') returning id")).rows[0];
    const old=(await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,effective_until,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values($1,'automatic-owner','2020-08-31',clock_timestamp()+interval '1 hour','[]','published','confirmed',clock_timestamp(),clock_timestamp(),1) returning id`,[oldSource.id])).rows[0];
    const successorSource=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('automatic-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date) returning id,effective_from")).rows[0];
    const current=(await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,activation_mode,effective_at,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values($1,'automatic-owner',$2,'immediate',clock_timestamp()+interval '1 hour','[]','published','confirmed',clock_timestamp(),clock_timestamp(),2) returning id`,[successorSource.id,successorSource.effective_from])).rows[0];
    const privateDraft=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from,activation_mode,base_publication_id,base_publication_revision) values('automatic-owner',$1,'immediate',$2,1) returning id",[successorSource.effective_from,old.id])).rows[0];
    await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,1,480,720)",[privateDraft.id]);
    const automatic=(await client.query(`insert into public.team_workweek_versions(owner_profile_id,effective_from,activation_mode,origin,base_publication_id,base_publication_revision,google_reconciliation_source_publication_id,google_reconciliation_fingerprint)
      values('automatic-owner',$1,'immediate','google_reconciliation',$2,1,$2,$3) returning id`,[successorSource.effective_from,old.id,'b'.repeat(64)])).rows[0];
    const pending=(await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,activation_mode,effective_at,predecessor_publication_id,windows,status,sync_state,attempt_generation,write_journal_version,publication_revision)
      values($1,'automatic-owner',$2,'immediate',clock_timestamp()-interval '2 hours',$3,'[]','preparing','delayed',1,1,3) returning id`,[automatic.id,successorSource.effective_from,old.id])).rows[0];
    await client.query("update public.team_workweek_publications set effective_until=clock_timestamp()-interval '1 hour' where id=$1",[old.id]);
    await client.query("update public.team_workweek_publications set effective_at=clock_timestamp()-interval '1 hour' where id=$1",[current.id]);
    for(const user of [foreign,unmapped]) expect(await captureDatabaseError(client,()=>asAuthenticated(client,user,()=>client.query("select public.restart_private_team_workweek_version($1)",[privateDraft.id])))).toMatchObject({code:"42501"});
    const provisional={id:"fopsautomaticfuture",start:{dateTime:"2030-04-01T08:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2030-04-01T09:00:00Z",timeZone:"Europe/Berlin"}};
    await client.query("insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,kind,google_event_id,payload,operation) values($1,'automatic-owner',1,'weekly',$2,$3,'create')",[pending.id,provisional.id,provisional]);
    expect(await captureDatabaseError(client,()=>asAuthenticated(client,owner,()=>client.query("select public.restart_private_team_workweek_version($1)",[privateDraft.id])))).toMatchObject({code:"P0003"});
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");await client.query("set local role service_role");
    const cleanup=(await client.query("select public.prepare_team_workweek_effect_cleanup($1,1) as result",[pending.id])).rows[0].result;
    expect(cleanup.effects[0].cleanupDisposition).toBe("delete");
    await client.query("select public.confirm_team_workweek_planned_cleanup($1,1,'absent',false)",[cleanup.effects[0].id]);
    await client.query("reset role");
    const restart=(await asAuthenticated(client,owner,()=>client.query("select public.restart_private_team_workweek_version($1) as result",[privateDraft.id]))).rows[0].result;
    expect((await client.query("select status,deactivation_reason from public.team_workweek_publications where id=$1",[pending.id])).rows[0]).toEqual({status:"inactive",deactivation_reason:"private_restart"});
    expect((await client.query("select weekday,start_minute,end_minute from public.team_workweek_windows where version_id=$1",[restart.versionId])).rows).toEqual([{weekday:1,start_minute:480,end_minute:720}]);
    expect((await asAuthenticated(client,owner,()=>client.query("select public.restart_private_team_workweek_version($1) as result",[privateDraft.id]))).rows[0].result).toEqual({...restart,replayed:true});
    const publication=(await asAuthenticated(client,owner,()=>client.query("select public.prepare_team_workweek_publication($1,1) as result",[restart.versionId]))).rows[0].result;
    expect(publication.predecessorPublicationId).toBe(current.id);
    expect(new Date(publication.effectiveAt).getTime()).toBeGreaterThan(Date.now());
    expect(publication.status).toBe("preparing");
  });
},30_000);
