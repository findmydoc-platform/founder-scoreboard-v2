import { expect,it } from "vitest";
import { withIsolatedLocalDatabase } from "./helpers/local-database";

it("disconnect pins cohort selectors and actual UNTIL, includes remainders, and retains the current private template",async()=>{
  await withIsolatedLocalDatabase(async client=>{
    const user="59500000-0000-4000-8000-000000000001";await client.query("insert into auth.users(id) values($1)",[user]);await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('disconnect-owner',$1,'Owner','viewer')",[user]);
    const source=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('disconnect-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date-14) returning id,effective_from")).rows[0];
    const pub=(await client.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at) values($1,'disconnect-owner',$2,'[{\"weekday\":7,\"startMinute\":60,\"endMinute\":240}]','published','confirmed',clock_timestamp(),clock_timestamp()) returning id",[source.id,source.effective_from])).rows[0];
    const window=(await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,7,60,240) returning id",[source.id])).rows[0];
    const parts=[{part:"ordinary-months",date:"2025-11-02",rule:"RRULE:FREQ=WEEKLY;BYDAY=SU;BYMONTH=1,2,4,5,6,7,8,9,11,12"},{part:"transition-month-ordinary",date:"2025-10-19",rule:"RRULE:FREQ=MONTHLY;BYMONTH=3,10;BYDAY=SU;BYSETPOS=1,2,3,-2"},{part:"spring",date:"2025-03-30",rule:"RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU"},{part:"autumn",date:"2025-10-26",rule:"RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU"}];
    for(const [index,part] of parts.entries()){
      const series=(await client.query("insert into public.team_workweek_google_series(publication_id,source_window_id,source_window_ids,owner_profile_id,google_event_id,projection_part,state,confirmed_etag,confirmed_founderops_revision,last_confirmed_at) values($1,$2,array[$2]::bigint[],'disconnect-owner',$3,$4,'confirmed','prior',1,clock_timestamp()) returning id",[pub.id,window.id,`fopsdisconnect0${index}`,part.part])).rows[0];
      const payload={id:`fopsdisconnect0${index}`,start:{dateTime:`${part.date}T01:00:00+01:00`,timeZone:"Europe/Berlin"},end:{dateTime:`${part.date}T04:00:00+01:00`,timeZone:"Europe/Berlin"},recurrence:[part.rule],extendedProperties:{private:{founderopsWorkweekSeriesId:series.id,founderopsWorkweekRevision:"1",founderopsWorkweekProjectionPart:part.part}}};
      await client.query("update public.team_workweek_google_series set observed_payload=$2 where id=$1",[series.id,payload]);
    }
    const remainder={id:"fopsdisconnectremainder",start:{dateTime:"2025-09-01T10:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2025-09-01T11:00:00Z",timeZone:"Europe/Berlin"},extendedProperties:{private:{founderopsWorkweekEffectId:"remainder"}}};
    await client.query("insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,kind,google_event_id,payload,state,confirmed_etag,observed_at) values($1,'disconnect-owner',1,'activation_remainder',$2,$3,'confirmed','prior',clock_timestamp())",[pub.id,remainder.id,remainder]);
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");await client.query("set local role service_role");
    const operation=(await client.query("select public.prepare_google_workspace_disconnect('disconnect-owner') as result")).rows[0].result;
    const targets=(await client.query("select * from public.google_workspace_disconnect_series where operation_id=$1 order by google_event_id",[operation.id])).rows;
    expect(targets).toHaveLength(5);
    for(const target of targets.filter(row=>row.effect_plan.cleanupPayload.recurrence)){
      expect(target.effect_plan.cleanupPayload.recurrence[0]).toContain(";UNTIL=");expect(target.effect_plan.cleanupPayload.recurrence[0]).not.toContain(";COUNT=");
      expect(target.effect_plan.cleanupPayload.recurrence[0].split(";UNTIL=")[0]).toBe(target.effect_plan.payload.recurrence[0]);
    }
    expect((await client.query("select public.prepare_google_workspace_disconnect('disconnect-owner') as result")).rows[0].result.id).toBe(operation.id);
    for(const target of targets){await client.query("select public.record_google_workspace_disconnect_write($1,'observed')",[target.id]);await client.query("select public.confirm_google_workspace_disconnect_series($1,$2,'clean',clock_timestamp())",[target.id,target.expected_etag]);}
    const result=(await client.query("select public.finalize_google_workspace_disconnect($1,'disconnect-owner',clock_timestamp()) as result",[operation.id])).rows[0].result;
    expect(result.state).toBe("revoke_pending");expect(result.retainedVersionId).not.toBe(source.id);
    expect((await client.query("select weekday,start_minute,end_minute from public.team_workweek_windows where version_id=$1",[result.retainedVersionId])).rows).toEqual([{weekday:7,start_minute:60,end_minute:240}]);
  });
},30_000);


it("disconnect preserves an elapsed legacy COUNT=1 second-fold master instead of deleting its history", async () => {
  await withIsolatedLocalDatabase(async client => {
    await client.query("insert into public.profiles(id,name,platform_role) values('fold-disconnect','Owner','founder')");
    const version=(await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('fold-disconnect','2025-10-20') returning id")).rows[0];
    const window=(await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,7,120,180) returning id",[version.id])).rows[0];
    const publication=(await client.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at) values($1,'fold-disconnect','2025-10-20','[{\"weekday\":7,\"startMinute\":120,\"endMinute\":180}]','published','confirmed',clock_timestamp(),clock_timestamp()) returning id",[version.id])).rows[0];
    const series=(await client.query("insert into public.team_workweek_google_series(publication_id,source_window_id,owner_profile_id,google_event_id,state,confirmed_etag,confirmed_founderops_revision,last_confirmed_at) values($1,$2,'fold-disconnect','fopsfoldcount','confirmed','prior',1,clock_timestamp()) returning id",[publication.id,window.id])).rows[0];
    const physical={id:"fopsfoldcount",start:{dateTime:"2025-10-26T01:00:00Z",timeZone:"Europe/Berlin"},end:{dateTime:"2025-10-26T02:00:00Z",timeZone:"Europe/Berlin"},recurrence:["RRULE:FREQ=WEEKLY;COUNT=1"],extendedProperties:{private:{founderopsWorkweekSeriesId:series.id,founderopsWorkweekRevision:"1"}}};
    await client.query("update public.team_workweek_google_series set observed_payload=$2 where id=$1",[series.id,physical]);
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");await client.query("set local role service_role");
    const operation=(await client.query("select public.prepare_google_workspace_disconnect('fold-disconnect') as result")).rows[0].result;
    const target=(await client.query("select cleanup_action,effect_plan from public.google_workspace_disconnect_series where operation_id=$1",[operation.id])).rows[0];
    expect(target.cleanup_action).toBe("truncate");
    expect(target.effect_plan.cleanupDisposition).toBe("preserve");
    expect(target.effect_plan.cleanupPayload.start).toEqual(physical.start);
    expect(target.effect_plan.cleanupPayload.end).toEqual(physical.end);
    expect(target.effect_plan.cleanupPayload.recurrence).toEqual(["RRULE:FREQ=WEEKLY;UNTIL=20251026T010000Z"]);
  });
},30_000);
