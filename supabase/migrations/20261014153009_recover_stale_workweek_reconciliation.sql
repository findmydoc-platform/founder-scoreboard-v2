-- Preserve already elapsed legacy COUNT instances without changing historical payloads.
create or replace function public.team_workweek_payload_before(p_payload jsonb,p_cutoff timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_first timestamptz;v_end timestamptz;v_rule text;v_part text;v_until timestamptz;v_count integer;v_last_date date;v_start timestamptz;v_payload jsonb;v_crossing jsonb;
begin
  v_first:=(p_payload#>>'{start,dateTime}')::timestamptz;v_end:=(p_payload#>>'{end,dateTime}')::timestamptz;
  if v_first is null or v_end<=v_first or p_cutoff is null then raise exception using errcode='22023',message='invalid cleanup boundary';end if;
  if p_payload->>'status'='cancelled' or v_first>=p_cutoff then return jsonb_build_object('elapsed',false);end if;
  if p_payload->'recurrence' is null then
    return jsonb_build_object('elapsed',true,'payload',jsonb_set(p_payload,'{end,dateTime}',to_jsonb(least(v_end,p_cutoff))));
  end if;
  if jsonb_array_length(p_payload->'recurrence')<>1 then raise exception using errcode='P0004',message='ambiguous recurrence boundary';end if;
  v_rule:=p_payload#>>'{recurrence,0}';v_part:=coalesce(p_payload#>>'{extendedProperties,private,founderopsWorkweekProjectionPart}','legacy');
  if v_part not in('legacy','weekly','ordinary-months','transition-month-ordinary','spring','autumn')
    or regexp_replace(v_rule,';(COUNT|UNTIL)=[^;]+','','g')<>(case v_part
      when 'ordinary-months' then 'RRULE:FREQ=WEEKLY;BYDAY=SU;BYMONTH=1,2,4,5,6,7,8,9,11,12'
      when 'transition-month-ordinary' then 'RRULE:FREQ=MONTHLY;BYMONTH=3,10;BYDAY=SU;BYSETPOS=1,2,3,-2'
      when 'spring' then 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU'
      when 'autumn' then 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU' else 'RRULE:FREQ=WEEKLY' end) then
    raise exception using errcode='P0004',message='unsupported managed recurrence boundary';end if;
  v_until:=p_cutoff-interval '1 second';
  if v_rule ~ ';UNTIL=' then v_until:=least(v_until,(to_timestamp(substring(v_rule from ';UNTIL=([0-9]{8}T[0-9]{6}Z)'),'YYYYMMDD"T"HH24MISS"Z"') at time zone current_setting('TimeZone')) at time zone 'UTC');end if;
  if v_rule ~ ';COUNT=' then
    v_count:=substring(v_rule from ';COUNT=([0-9]+)')::integer;
    if v_part not in('legacy','weekly') or v_count<1 then raise exception using errcode='P0004',message='unsupported counted cohort';end if;
    -- COUNT includes the exact physical DTSTART, including the second autumn fold.
    v_until:=least(v_until,case when v_count=1 then v_first else public.team_workweek_berlin_civil_instant((v_first at time zone 'Europe/Berlin')+(v_count-1)*interval '7 days') end);
  end if;
  select max(day::date) into v_last_date from generate_series((v_first at time zone 'Europe/Berlin')::date::timestamp,(v_until at time zone 'Europe/Berlin')::date::timestamp,interval '1 day') day
    where extract(isodow from day)=extract(isodow from v_first at time zone 'Europe/Berlin')
      and (v_part in('legacy','weekly') or public.team_workweek_projection_part(day::date)=v_part)
      and (case when day::date=(v_first at time zone 'Europe/Berlin')::date then v_first else public.team_workweek_berlin_civil_instant(day::date+(v_first at time zone 'Europe/Berlin')::time) end)<=v_until;
  if v_last_date is null then return jsonb_build_object('elapsed',false);end if;
  v_start:=case when v_last_date=(v_first at time zone 'Europe/Berlin')::date then v_first else public.team_workweek_berlin_civil_instant(v_last_date+(v_first at time zone 'Europe/Berlin')::time) end;
  v_payload:=jsonb_set(p_payload,'{recurrence}',jsonb_build_array(regexp_replace(v_rule,';(COUNT|UNTIL)=[^;]+','','g')||';UNTIL='||to_char(v_until at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"')));
  if v_start<p_cutoff and v_start+(v_end-v_first)>p_cutoff then
    v_crossing:=(p_payload-'recurrence')||jsonb_build_object('start',jsonb_build_object('dateTime',v_start,'timeZone','Europe/Berlin'),'end',jsonb_build_object('dateTime',v_start+(v_end-v_first),'timeZone','Europe/Berlin'));
  end if;
  return jsonb_build_object('elapsed',true,'payload',v_payload,'crossing',v_crossing);
end;$$;
revoke all on function public.team_workweek_payload_before(jsonb,timestamptz) from public,anon,authenticated,service_role;

-- Keep the same mapped-owner authorization and explicit, compensated restart.
create or replace function public.restart_private_team_workweek_version(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text;v_version public.team_workweek_versions%rowtype;v_pub public.team_workweek_publications%rowtype;v_base public.team_workweek_publications%rowtype;v_windows jsonb;v_id uuid;v_date date;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id = auth.uid();
  if not found then raise exception using errcode='42501',message='mapped team profile required';end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_version from public.team_workweek_versions where id=p_version_id and owner_profile_id=v_owner for update;
  if not found then raise exception using errcode='42501',message='private workweek is not owned by caller';end if;
  if v_version.restarted_version_id is not null then return jsonb_build_object('versionId',v_version.restarted_version_id,'replayed',true);end if;
  if v_version.retired_at is not null then raise exception using errcode='P0004',message='private version has retired';end if;
  select * into v_pub from public.team_workweek_publications where source_version_id=p_version_id
    or source_version_id=(select resolution_version_id from public.team_workweek_google_conflicts where founderops_version_id=p_version_id and owner_profile_id=v_owner and state='resolving' order by updated_at desc limit 1);
  if not found then
    -- A saved Owner draft must retain its inputs while the stale automatic
    -- operation blocking all publication is safely retired by the same action.
    select publication.* into v_pub from public.team_workweek_publications as publication
      join public.team_workweek_versions as source on source.id=publication.source_version_id
      where publication.owner_profile_id=v_owner and publication.status='preparing'
        and source.origin='google_reconciliation' and source.retired_at is null;
  end if;
  if found then
    if v_pub.status<>'preparing' or v_pub.attempt_generation=0 or v_pub.effective_at>clock_timestamp()
      or exists(select 1 from public.team_workweek_publication_effects where publication_id=v_pub.id and generation=v_pub.attempt_generation and state<>'cleaned') then
      raise exception using errcode='P0003',message='publication must be safely compensated before restart';end if;
    update public.team_workweek_publications set status='inactive',deactivated_at=clock_timestamp(),deactivation_reason='private_restart' where id=v_pub.id;
  end if;
  select * into v_base from public.team_workweek_publications where owner_profile_id=v_owner and status='published'
    and (v_version.activation_mode='future_monday' or (coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()))
    order by effective_from desc,publication_revision desc limit 1;
  v_date:=case when v_version.activation_mode='future_monday' then greatest(v_version.effective_from,date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7,coalesce(v_base.effective_from+7,v_version.effective_from)) else date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date end;
  select coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'startMinute',start_minute,'endMinute',end_minute) order by weekday,start_minute,end_minute,id),'[]') into v_windows from public.team_workweek_windows where version_id=p_version_id;
  v_id:=public.insert_temporal_google_workweek_version(v_owner,v_base.id,v_base.publication_revision,v_windows,'owner',null,v_version.activation_mode,v_date);
  update public.team_workweek_versions set retired_at=clock_timestamp(),restarted_version_id=v_id where id=p_version_id or (id=v_pub.source_version_id and v_pub.source_version_id is distinct from p_version_id);
  update public.team_workweek_versions set retired_at=clock_timestamp() where id in(select founderops_version_id from public.team_workweek_google_conflicts where resolution_version_id=p_version_id and owner_profile_id=v_owner);
  update public.team_workweek_google_conflicts set state='cancelled',decision=null,resolution_version_id=null,resolved_at=clock_timestamp(),updated_at=clock_timestamp()
    where owner_profile_id=v_owner and state in('open','resolving') and (resolution_version_id=p_version_id or founderops_version_id=p_version_id);
  return jsonb_build_object('versionId',v_id,'replayed',false);
end;$$;
revoke all on function public.restart_private_team_workweek_version(uuid) from public,anon,service_role;
grant execute on function public.restart_private_team_workweek_version(uuid) to authenticated;
