import {expect,it} from "vitest";
import {asAuthenticated,captureDatabaseError,withIsolatedLocalDatabase} from "./helpers/local-database";

it("pins an active owner's revision and prepares a same-week replacement without altering confirmed history",async()=>{
  await withIsolatedLocalDatabase(async client=>{
    const user="52000000-0000-4000-8000-000000000001";
    await client.query("insert into auth.users(id) values($1)",[user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('replacement-viewer',$1,'Replacement','viewer')",[user]);
    const source=await client.query(`insert into public.team_workweek_versions(owner_profile_id,effective_from)
      values('replacement-viewer',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date-14) returning id,effective_from`);
    const version=source.rows[0];
    const window=await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,extract(isodow from clock_timestamp() at time zone 'Europe/Berlin'),0,1439) returning id",[version.id]);
    const old=await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values($1,'replacement-viewer',$2,jsonb_build_array(jsonb_build_object('weekday',extract(isodow from clock_timestamp() at time zone 'Europe/Berlin')::integer,'startMinute',0,'endMinute',1439)),'published','confirmed',clock_timestamp()-interval '14 days',clock_timestamp()-interval '14 days',1) returning id`,[version.id,version.effective_from]);
    const oldId=old.rows[0].id;
    await client.query(`insert into public.team_workweek_google_series(publication_id,source_window_id,owner_profile_id,google_event_id,state,confirmed_etag,confirmed_founderops_revision,last_confirmed_at)
      values($1,$2,'replacement-viewer','fopsabc123','confirmed','old-etag',1,clock_timestamp())`,[oldId,window.rows[0].id]);
    const created=await asAuthenticated(client,user,()=>client.query("select public.create_private_current_team_workweek_version('[]',$1,1) as version",[oldId]));
    const prepared=await asAuthenticated(client,user,()=>client.query("select public.prepare_team_workweek_publication($1) as publication",[created.rows[0].version.id]));
    const publication=prepared.rows[0].publication;
    expect(publication.predecessorPublicationId).toBe(oldId);
    expect(publication.effects.map((effect:{kind:string})=>effect.kind)).toEqual(expect.arrayContaining(["predecessor_cutoff","crossing_instance"]));
    const unchanged=await client.query("select effective_to,effective_until,status from public.team_workweek_publications where id=$1",[oldId]);
    expect(unchanged.rows).toEqual([{effective_to:null,effective_until:null,status:"published"}]);
    const foreign=await captureDatabaseError(client,()=>asAuthenticated(client,user,()=>client.query("select public.create_private_current_team_workweek_version('[]',null,1)")));
    expect(foreign).toMatchObject({code:"P0003"});
    const crossing=publication.effects.find((effect:{kind:string})=>effect.kind==="crossing_instance");
    const original={...crossing.expectedPayload,id:"fopsabc123_20261014T000000Z"};
    await client.query("set local role service_role");
    const bound=await client.query("select public.bind_team_workweek_crossing_instance($1,$2,$3,'instance-etag',$4) as effect",[crossing.id,crossing.generation,original.id,original]);
    expect(new Date(bound.rows[0].effect.payload.start.dateTime).toISOString()).toBe(new Date(original.start.dateTime).toISOString());
    expect(new Date(bound.rows[0].effect.payload.end.dateTime).toISOString()).toBe(new Date(publication.effectiveAt).toISOString());
    for(const effect of publication.effects){
      const observed=effect.id===crossing.id?bound.rows[0].effect:effect;
      await client.query("select public.confirm_team_workweek_effect($1,$2,'confirmed-etag',$3)",[observed.id,observed.generation,observed.payload]);
    }
    await client.query("reset role");
    await asAuthenticated(client,user,()=>client.query("select public.finalize_team_workweek_publication($1)",[publication.id]));
    const installed=await client.query("select effective_until,superseded_by_publication_id from public.team_workweek_publications where id=$1",[oldId]);
    expect(installed.rows[0].effective_until.toISOString()).toBe(new Date(publication.effectiveAt).toISOString());
    expect(installed.rows[0].superseded_by_publication_id).toBe(publication.id);
  });
},30_000);

it("keeps mapped roles owner-only and installs half-open bounds after all effects are confirmed",async()=>{
  await withIsolatedLocalDatabase(async client=>{
    const roles=["ceo","founder","deputy","viewer"];
    for(const [index,role]of roles.entries()){
      const user=`53000000-0000-4000-8000-00000000000${index+1}`;const owner=`replacement-${role}`;
      await client.query("insert into auth.users(id) values($1)",[user]);
      await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,$3,$3)",[owner,user,role]);
      const source=await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values($1,date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date-7) returning id,effective_from",[owner]);
      const old=await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision)
        values($1,$2,$3,'[]','published','confirmed',clock_timestamp()-interval '7 days',clock_timestamp()-interval '7 days',1) returning id`,[source.rows[0].id,owner,source.rows[0].effective_from]);
      const stale=await captureDatabaseError(client,()=>asAuthenticated(client,user,()=>client.query("select public.create_private_current_team_workweek_version('[]',$1,2)",[old.rows[0].id])));
      expect(stale).toMatchObject({code:"P0004"});
      const draft=await asAuthenticated(client,user,()=>client.query("select public.create_private_current_team_workweek_version('[{\"weekday\":3,\"startMinute\":0,\"endMinute\":1439}]',$1,1) as version",[old.rows[0].id]));
      const prepared=await asAuthenticated(client,user,()=>client.query("select public.prepare_team_workweek_publication($1) as publication",[draft.rows[0].version.id]));
      const publication=prepared.rows[0].publication;
      for(const effect of publication.effects){
        await client.query("set local role service_role");await client.query("select public.confirm_team_workweek_effect($1,$2,'etag',$3)",[effect.id,effect.generation,effect.payload]);await client.query("reset role");
      }
      const confirmed=await asAuthenticated(client,user,()=>client.query("select public.finalize_team_workweek_publication($1) as publication",[publication.id]));
      expect(confirmed.rows[0].publication.status).toBe("published");
      const bounds=await client.query("select effective_until from public.team_workweek_publications where id=$1",[old.rows[0].id]);
      expect(bounds.rows[0].effective_until.toISOString()).toBe(new Date(publication.effectiveAt).toISOString());
      const preparingSuccessor=await captureDatabaseError(client,()=>asAuthenticated(client,user,()=>client.query("select public.create_private_current_team_workweek_version('[]',$1,2)",[publication.id])));
      expect(preparingSuccessor).toMatchObject({code:"22023"});
      const forged=await captureDatabaseError(client,()=>asAuthenticated(client,user,()=>client.query("select public.bind_team_workweek_crossing_instance(null,1,'foreign','etag','{}')")));
      expect(forged).toMatchObject({code:"42501"});
    }
  });
},30_000);

it.each(["immediate","future_monday"])("uses actual future DTSTART for zero-occurrence masters in %s mode",async(mode)=>{
  await withIsolatedLocalDatabase(async client=>{
    const user="54000000-0000-4000-8000-000000000001";const owner="replacement-zero";
    await client.query("insert into auth.users(id) values($1)",[user]);await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,'Zero','founder')",[owner,user]);
    const source=await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from,activation_mode) values($1,date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date,'immediate') returning id,effective_from",[owner]);
    const window=await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,extract(isodow from clock_timestamp() at time zone 'Europe/Berlin'),0,1439) returning id",[source.rows[0].id]);
    const old=await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision,activation_mode,effective_at,attempt_generation)
      values($1,$2,$3,jsonb_build_array(jsonb_build_object('weekday',extract(isodow from clock_timestamp() at time zone 'Europe/Berlin')::integer,'startMinute',0,'endMinute',1439)),'published','confirmed',clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '2 minutes',1,'immediate',date_trunc('minute',clock_timestamp())-interval '1 minute',1) returning id,effective_at`,[source.rows[0].id,owner,source.rows[0].effective_from]);
    const series=await client.query("insert into public.team_workweek_google_series(publication_id,source_window_id,owner_profile_id,google_event_id,state,confirmed_etag,confirmed_founderops_revision,last_confirmed_at) values($1,$2,$3,'fopsmaster01','confirmed','master-etag',1,clock_timestamp()) returning id",[old.rows[0].id,window.rows[0].id,owner]);
    await client.query(`insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,series_id,kind,google_event_id,payload,state,confirmed_etag,observed_at)
      select $1,$2,1,$3::uuid,'weekly','fopsmaster01',jsonb_build_object('id','fopsmaster01','start',jsonb_build_object('dateTime',((clock_timestamp() at time zone 'Europe/Berlin')::date+7)::timestamp at time zone 'Europe/Berlin','timeZone','Europe/Berlin'),'end',jsonb_build_object('dateTime',(((clock_timestamp() at time zone 'Europe/Berlin')::date+7)::timestamp+interval '1439 minutes') at time zone 'Europe/Berlin','timeZone','Europe/Berlin'),'recurrence',jsonb_build_array('RRULE:FREQ=WEEKLY'),'extendedProperties',jsonb_build_object('private',jsonb_build_object('founderopsWorkweekSeriesId',($3::uuid)::text,'founderopsWorkweekRevision','1'))),'confirmed','master-etag',clock_timestamp()`,[old.rows[0].id,owner,series.rows[0].id]);
    await client.query(`insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,kind,google_event_id,payload,state,confirmed_etag,observed_at)
      values($1,$2,1,'activation_remainder','fopsremain01',jsonb_build_object('id','fopsremain01','start',jsonb_build_object('dateTime',$3::timestamptz,'timeZone','Europe/Berlin'),'end',jsonb_build_object('dateTime',((clock_timestamp() at time zone 'Europe/Berlin')::date::timestamp+interval '1439 minutes') at time zone 'Europe/Berlin','timeZone','Europe/Berlin'),'extendedProperties',jsonb_build_object('private',jsonb_build_object('founderopsWorkweekEffectId','prior','founderopsWorkweekRevision','1'))),'confirmed','remain-etag',clock_timestamp())`,[old.rows[0].id,owner,old.rows[0].effective_at]);
    const draft=await asAuthenticated(client,user,()=>mode==="immediate"
      ?client.query("select public.create_private_current_team_workweek_version('[]',$1,1) as version",[old.rows[0].id])
      :client.query("select public.create_private_monday_team_workweek_version(date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7,'[]',$1,1) as version",[old.rows[0].id]));
    const prepared=await asAuthenticated(client,user,()=>client.query("select public.prepare_team_workweek_publication($1) as publication",[draft.rows[0].version.id]));
    const publication=prepared.rows[0].publication;
    const cutoff=publication.effects.find((effect:{kind:string})=>effect.kind==="predecessor_cutoff");expect(cutoff.operation).toBe("cancel");expect(cutoff.payload.status).toBe("cancelled");
    const remainder=publication.effects.find((effect:{kind:string})=>effect.kind==="predecessor_remainder");
    if(mode==="immediate"){
      expect(new Date(remainder.payload.start.dateTime).toISOString()).toBe(old.rows[0].effective_at.toISOString());
      expect(new Date(remainder.payload.end.dateTime).toISOString()).toBe(new Date(publication.effectiveAt).toISOString());
    }else{
      expect(remainder).toBeUndefined();
      expect(publication.activationMode).toBe("future_monday");
      const nextMonday=await client.query("select (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7)::timestamp at time zone 'Europe/Berlin' as instant");
      expect(new Date(publication.effectiveAt).toISOString()).toBe(nextMonday.rows[0].instant.toISOString());
    }
  });
},30_000);
