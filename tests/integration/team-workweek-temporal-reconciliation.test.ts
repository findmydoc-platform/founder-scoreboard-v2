import { expect, it } from "vitest";
import { asAuthenticated, withIsolatedLocalDatabase } from "./helpers/local-database";

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
    const publication=(await asAuthenticated(client,user,()=>client.query("select public.prepare_team_workweek_publication($1) as publication",[prepared.versionId]))).rows[0].publication;
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
