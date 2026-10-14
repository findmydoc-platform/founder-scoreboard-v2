import { expect, it } from "vitest";
import { asAuthenticated, captureDatabaseError, withIsolatedLocalDatabase } from "./helpers/local-database";

const payload={id:"fopshistory01",start:{dateTime:"2020-08-31T08:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2020-08-31T16:00:00Z",timeZone:"Europe/Berlin"},recurrence:["RRULE:FREQ=WEEKLY"],extendedProperties:{private:{founderopsWorkweekEffectId:"effect"}}};
it("pins one cleanup cutoff, retains actual elapsed history, and restarts without rewriting the old generation",async()=>{
  await withIsolatedLocalDatabase(async client=>{
    const user="59100000-0000-4000-8000-000000000001";
    await client.query("insert into auth.users(id) values($1)",[user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('history-owner',$1,'Owner','viewer')",[user]);
    const version=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from,activation_mode) values('history-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date,'immediate') returning *")).rows[0];
    await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,1,540,1020)",[version.id]);
    const pub=(await client.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,activation_mode,effective_at,attempt_generation,windows) values($1,'history-owner',$2,'immediate',clock_timestamp()-interval '1 minute',1,'[]') returning id",[version.id,version.effective_from])).rows[0];
    await client.query("insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,kind,google_event_id,payload) values($1,'history-owner',1,'weekly',$2,$3)",[pub.id,payload.id,payload]);
    const cutoff={...payload,id:"fopsprevious01",recurrence:["RRULE:FREQ=WEEKLY;UNTIL=20261012T075959Z"]};
    await client.query("insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,kind,google_event_id,payload,operation,expected_payload,expected_etag) values($1,'history-owner',1,'predecessor_cutoff',$2,$3,'update',$4,'old')",[pub.id,cutoff.id,cutoff,{...payload,id:cutoff.id}]);
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");await client.query("set local role service_role");
    const plan=(await client.query("select public.prepare_team_workweek_effect_cleanup($1,1) as result",[pub.id])).rows[0].result;
    expect(plan.effects.map((effect:{cleanupDisposition:string})=>effect.cleanupDisposition)).toEqual(["preserve"]);
    const planned=plan.effects[0];
    expect(planned.cleanupPayload.recurrence[0]).toContain(";UNTIL=");
    expect((await client.query("select public.prepare_team_workweek_effect_cleanup($1,1) as result",[pub.id])).rows[0].result).toEqual(plan);
    await client.query("select public.confirm_team_workweek_planned_cleanup($1,1,'history',true)",[planned.id]);
    const final=(await client.query("select public.prepare_team_workweek_effect_cleanup($1,1) as result",[pub.id])).rows[0].result;
    const previous=final.effects.find((effect:{kind:string})=>effect.kind==="predecessor_cutoff");
    expect(previous.cleanupDisposition).toBe("retain");expect(previous.cleanupPayload).toEqual(cutoff);
    await client.query("select public.confirm_team_workweek_planned_cleanup($1,1,'retained',true)",[previous.id]);await client.query("reset role");
    const oldEffects=(await client.query("select * from public.team_workweek_publication_effects where publication_id=$1 order by id",[pub.id])).rows;
    const restarted=(await asAuthenticated(client,user,()=>client.query("select public.restart_private_team_workweek_version($1) as result",[version.id]))).rows[0].result;
    expect(restarted.versionId).not.toBe(version.id);
    expect((await asAuthenticated(client,user,()=>client.query("select public.restart_private_team_workweek_version($1) as result",[version.id]))).rows[0].result).toEqual({...restarted,replayed:true});
    expect((await client.query("select * from public.team_workweek_publication_effects where publication_id=$1 order by id",[pub.id])).rows).toEqual(oldEffects);
    expect((await client.query("select weekday,start_minute,end_minute from public.team_workweek_windows where version_id=$1",[restarted.versionId])).rows).toEqual([{weekday:1,start_minute:540,end_minute:1020}]);
    const error=await captureDatabaseError(client,()=>asAuthenticated(client,user,()=>client.query("select public.prepare_team_workweek_publication($1)",[version.id])));
    expect(error).toMatchObject({code:"P0004"});
  });
},30_000);

it("keeps existing UTC UNTIL and seasonal selectors when cutting later, and clips a crossing occurrence",async()=>{
  await withIsolatedLocalDatabase(async client=>{
    const bounded={...payload,recurrence:["RRULE:FREQ=WEEKLY;UNTIL=20261012T075959Z"]};
    const result=(await client.query("select public.team_workweek_payload_before($1,'2026-10-14T12:00:00Z') as result",[bounded])).rows[0].result;
    expect(result.payload.recurrence).toEqual(bounded.recurrence);
    const seasonal={...payload,start:{dateTime:"2026-10-25T00:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2026-10-25T03:00:00Z",timeZone:"Europe/Berlin"},recurrence:["RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU"],extendedProperties:{private:{founderopsWorkweekProjectionPart:"autumn"}}};
    expect((await client.query("select public.team_workweek_payload_before($1,'2027-01-01T00:00:00Z') as result",[seasonal])).rows[0].result.payload.recurrence[0]).toMatch(/^RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU;UNTIL=/);
    const crossing=(await client.query("select public.team_workweek_payload_before($1,'2026-10-12T12:00:00Z') as result",[payload])).rows[0].result;
    expect(new Date(crossing.crossing.start.dateTime).toISOString()).toBe("2026-10-12T08:00:00.000Z");
    expect(new Date(crossing.crossing.end.dateTime).toISOString()).toBe("2026-10-12T16:00:00.000Z");
    const legacyFold={...payload,start:{dateTime:"2026-10-25T01:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2026-10-25T02:00:00Z",timeZone:"Europe/Berlin"}};
    const fold=(await client.query("select public.team_workweek_payload_before($1,'2026-10-25T01:30:00Z') as result",[legacyFold])).rows[0].result;
    expect(new Date(fold.crossing.start.dateTime).toISOString()).toBe("2026-10-25T01:00:00.000Z");

  });
},30_000);

it.each(["ceo","deputy","founder","viewer"])("allows only the mapped %s owner to explicitly restart a private draft",async role=>{
  await withIsolatedLocalDatabase(async client=>{
    const owner="59200000-0000-4000-8000-000000000001",foreign="59200000-0000-4000-8000-000000000002",unmapped="59200000-0000-4000-8000-000000000003";
    await client.query("insert into auth.users(id) values($1),($2),($3)",[owner,foreign,unmapped]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('restart-owner',$1,'Owner',$3),('restart-foreign',$2,'Foreign','ceo')",[owner,foreign,role]);
    const source=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from,activation_mode) values('restart-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date,'immediate') returning id")).rows[0];
    for(const user of [foreign,unmapped])expect(await captureDatabaseError(client,()=>asAuthenticated(client,user,()=>client.query("select public.restart_private_team_workweek_version($1)",[source.id])))).toMatchObject({code:"42501"});
    expect(await captureDatabaseError(client,()=>asAuthenticated(client,owner,()=>client.query("select public.prepare_team_workweek_effect_cleanup($1,1)",[source.id])))).toMatchObject({code:"42501"});
    expect((await asAuthenticated(client,owner,()=>client.query("select public.restart_private_team_workweek_version($1) as result",[source.id]))).rows[0].result.versionId).toBeTypeOf("string");
  });
},30_000);

it.each(["immediate","future_monday"])("never extends the retained actual predecessor cutoff for a later %s plan",async mode=>{
  await withIsolatedLocalDatabase(async client=>{
    const user="59700000-0000-4000-8000-000000000001";await client.query("insert into auth.users(id) values($1)",[user]);await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('retained-owner',$1,'Owner','viewer')",[user]);
    const source=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('retained-owner','2020-08-31') returning id")).rows[0];
    const window=(await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,1,600,1080) returning id",[source.id])).rows[0];
    const current=(await client.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at) values($1,'retained-owner','2020-08-31','[{\"weekday\":1,\"startMinute\":600,\"endMinute\":1080}]','published','confirmed',clock_timestamp(),clock_timestamp()) returning id,publication_revision",[source.id])).rows[0];
    const series=(await client.query("insert into public.team_workweek_google_series(publication_id,source_window_id,owner_profile_id,google_event_id,state,confirmed_etag,confirmed_founderops_revision,last_confirmed_at) values($1,$2,'retained-owner','fopsretained01','confirmed','actual-cutoff',1,clock_timestamp()) returning id",[current.id,window.id])).rows[0];
    const actual={...payload,id:"fopsretained01",recurrence:["RRULE:FREQ=WEEKLY;UNTIL=20200907T080000Z"],extendedProperties:{private:{founderopsWorkweekSeriesId:series.id,founderopsWorkweekRevision:"1"}}};
    await client.query("update public.team_workweek_google_series set observed_payload=$2 where id=$1",[series.id,actual]);
    const draft=(await asAuthenticated(client,user,()=>mode==="immediate"?client.query("select public.create_private_current_team_workweek_version('[{\"weekday\":1,\"startMinute\":540,\"endMinute\":1020}]',$1,1) as result",[current.id]):client.query("select public.create_private_team_workweek_version(date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7,'[{\"weekday\":1,\"startMinute\":540,\"endMinute\":1020}]') as result"))).rows[0].result;
    const plan=(await asAuthenticated(client,user,()=>client.query("select public.prepare_team_workweek_publication($1) as result",[draft.id]))).rows[0].result;
    expect(plan.effects.some((effect:{googleEventId:string})=>effect.googleEventId===actual.id)).toBe(false);
    expect((await client.query("select observed_payload,confirmed_etag from public.team_workweek_google_series where id=$1",[series.id])).rows[0]).toEqual({observed_payload:actual,confirmed_etag:"actual-cutoff"});
  });
},30_000);
