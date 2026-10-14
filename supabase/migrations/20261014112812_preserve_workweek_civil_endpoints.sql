-- Physical series retain named day cohorts and every logical source, without changing civil templates.
alter table public.team_workweek_google_series add column if not exists projection_part text not null default 'legacy';
alter table public.team_workweek_google_series add column if not exists source_window_ids bigint[];
alter table public.team_workweek_google_series drop constraint team_workweek_google_series_source_window_id_key;
create unique index team_workweek_series_source_part on public.team_workweek_google_series(source_window_id,projection_part);
alter table public.team_workweek_publications add column if not exists planned_effect_count integer;
alter table public.team_workweek_publications add column if not exists projection_omissions jsonb not null default '[]';

-- Derive candidate offsets around the date; select first fold, or the pre-gap offset.
create or replace function public.team_workweek_berlin_civil_instant(p_local timestamp)
returns timestamptz language sql stable set search_path=public as $$
  with offsets as (
    select distinct (point at time zone 'Europe/Berlin')-(point at time zone 'UTC') as offset_value
    from generate_series((p_local at time zone 'UTC')-interval '2 days',(p_local at time zone 'UTC')+interval '2 days',interval '12 hours') point
  ), candidates as (
    select (p_local at time zone 'UTC')-offset_value as instant from offsets
  )
  select coalesce(
    (select min(instant) from candidates where instant at time zone 'Europe/Berlin'=p_local),
    (select instant from candidates where instant at time zone 'Europe/Berlin'>p_local order by instant at time zone 'Europe/Berlin' limit 1)
  );
$$;
revoke all on function public.team_workweek_berlin_civil_instant(timestamp) from public,anon,authenticated,service_role;

-- Union strictly overlapping actual intervals. Adjacent civil windows keep separate identities.
create or replace function public.team_workweek_day_intervals(p_version_id uuid,p_date date)
returns table(source_ids bigint[],starts_at timestamptz,ends_at timestamptz)
language sql stable security definer set search_path=public as $$
  with resolved as (
    select id,public.team_workweek_berlin_civil_instant(p_date::timestamp+make_interval(mins=>start_minute)) as s,
      public.team_workweek_berlin_civil_instant(p_date::timestamp+make_interval(mins=>end_minute)) as e
    from public.team_workweek_windows where version_id=p_version_id and weekday=extract(isodow from p_date)
  ), positive as (select * from resolved where e>s), prior as (
    select *,max(e) over(order by s,e,id rows between unbounded preceding and 1 preceding) as prior_end from positive
  ), grouped as (
    select *,sum(case when prior_end is null or s>=prior_end then 1 else 0 end) over(order by s,e,id) as group_id from prior
  ) select array_agg(id order by id),min(s),max(e) from grouped group by group_id order by min(s);
$$;
revoke all on function public.team_workweek_day_intervals(uuid,date) from public,anon,authenticated,service_role;

-- Current Europe/Berlin rules partition Sundays into four disjoint date classes.
create or replace function public.team_workweek_projection_part(p_date date)
returns text language sql immutable set search_path=public as $$
  select case when extract(month from p_date) not in(3,10) then 'ordinary-months'
    when extract(month from p_date+7)=extract(month from p_date) then 'transition-month-ordinary'
    when extract(month from p_date)=3 then 'spring' else 'autumn' end;
$$;
revoke all on function public.team_workweek_projection_part(date) from public,anon,authenticated,service_role;

create or replace function public.plan_team_workweek_civil_effects(p_publication_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_publication public.team_workweek_publications%rowtype; v_day integer; v_date date; v_interval record;
  v_part text; v_parts text[]; v_rule text; v_seen text[]:=array[]::text[]; v_key text;
  v_series_id uuid; v_effect_id uuid; v_event_id text; v_payload jsonb; v_seasonal boolean; v_omissions jsonb;
begin
  select * into v_publication from public.team_workweek_publications where id=p_publication_id;
  -- The activation-day remainder is an actual union, not a fixed-duration recurring master.
  v_date:=(v_publication.effective_at at time zone 'Europe/Berlin')::date;
  for v_interval in select * from public.team_workweek_day_intervals(v_publication.source_version_id,v_date)
    where starts_at<v_publication.effective_at and ends_at>v_publication.effective_at loop
    v_effect_id:=gen_random_uuid(); v_event_id:='fops'||replace(v_effect_id::text,'-','');
    v_payload:=jsonb_build_object('id',v_event_id,'summary','Arbeitszeit','description','Mit FounderOps synchronisiert',
      'start',jsonb_build_object('dateTime',v_publication.effective_at,'timeZone','Europe/Berlin'),
      'end',jsonb_build_object('dateTime',v_interval.ends_at,'timeZone','Europe/Berlin'),
      'transparency','transparent','visibility','private','reminders',jsonb_build_object('useDefault',false),
      'extendedProperties',jsonb_build_object('private',jsonb_build_object('founderopsWorkweekEffectId',v_effect_id,'founderopsWorkweekGeneration',v_publication.attempt_generation::text,'founderopsWorkweekRevision',v_publication.publication_revision::text,'founderopsWorkweekSources',array_to_string(v_interval.source_ids,','))));
    insert into public.team_workweek_publication_effects(id,publication_id,owner_profile_id,generation,kind,google_event_id,payload)
      values(v_effect_id,v_publication.id,v_publication.owner_profile_id,v_publication.attempt_generation,'activation_remainder',v_event_id,v_payload);
  end loop;
  for v_day in select distinct weekday from public.team_workweek_windows where version_id=v_publication.source_version_id loop
    v_seasonal:=v_day=7 and exists(select 1 from public.team_workweek_windows where version_id=v_publication.source_version_id and weekday=7 and start_minute<180 and end_minute>120);
    v_parts:=case when v_seasonal then array['ordinary-months','transition-month-ordinary','spring','autumn'] else array['weekly'] end;
    foreach v_part in array v_parts loop
      -- More than two calendar years covers each current annual cohort after a clipped first occurrence.
      for v_date in select day::date from generate_series((v_publication.effective_at at time zone 'Europe/Berlin')::date::timestamp,
        (v_publication.effective_at at time zone 'Europe/Berlin')::date::timestamp+interval '740 days',interval '1 day') day
        where extract(isodow from day)=v_day and (not v_seasonal or public.team_workweek_projection_part(day::date)=v_part) loop
        for v_interval in select * from public.team_workweek_day_intervals(v_publication.source_version_id,v_date) where starts_at>=v_publication.effective_at loop
          v_key:=v_part||':'||array_to_string(v_interval.source_ids,',');
          if v_key=any(v_seen) then continue; end if;
          v_seen:=array_append(v_seen,v_key);
          v_rule:=case v_part when 'ordinary-months' then 'RRULE:FREQ=WEEKLY;BYDAY=SU;BYMONTH=1,2,4,5,6,7,8,9,11,12'
            when 'transition-month-ordinary' then 'RRULE:FREQ=MONTHLY;BYMONTH=3,10;BYDAY=SU;BYSETPOS=1,2,3,-2'
            when 'spring' then 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU'
            when 'autumn' then 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU' else 'RRULE:FREQ=WEEKLY' end;
          v_series_id:=gen_random_uuid();
          insert into public.team_workweek_google_series(id,publication_id,source_window_id,source_window_ids,projection_part,owner_profile_id,google_event_id)
            values(v_series_id,v_publication.id,v_interval.source_ids[1],v_interval.source_ids,v_part,v_publication.owner_profile_id,'fops'||replace(v_series_id::text,'-',''))
            on conflict(source_window_id,projection_part) do update set state='pending',confirmed_etag=null,confirmed_founderops_revision=null,last_confirmed_at=null
            returning id into v_series_id;
          v_effect_id:=gen_random_uuid(); v_event_id:='fops'||replace(v_effect_id::text,'-','');
          update public.team_workweek_google_series set google_event_id=v_event_id where id=v_series_id;
          v_payload:=jsonb_build_object('id',v_event_id,'summary','Arbeitszeit','description','Mit FounderOps synchronisiert',
            'start',jsonb_build_object('dateTime',v_interval.starts_at,'timeZone','Europe/Berlin'),
            'end',jsonb_build_object('dateTime',v_interval.ends_at,'timeZone','Europe/Berlin'),'recurrence',jsonb_build_array(v_rule),
            'transparency','transparent','visibility','private','reminders',jsonb_build_object('useDefault',false),
            'extendedProperties',jsonb_build_object('private',jsonb_build_object('founderopsWorkweekSeriesId',v_series_id,'founderopsWorkweekEffectId',v_effect_id,'founderopsWorkweekGeneration',v_publication.attempt_generation::text,'founderopsWorkweekRevision',v_publication.publication_revision::text,'founderopsWorkweekProjectionPart',v_part,'founderopsWorkweekSources',array_to_string(v_interval.source_ids,','))));
          insert into public.team_workweek_publication_effects(id,publication_id,owner_profile_id,generation,series_id,kind,google_event_id,payload)
            values(v_effect_id,v_publication.id,v_publication.owner_profile_id,v_publication.attempt_generation,v_series_id,'weekly',v_event_id,v_payload);
        end loop;
      end loop;
    end loop;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('part','spring','sourceWindowId',work_window.id,'reason','nonpositive_actual_interval')),'[]') into v_omissions
    from public.team_workweek_windows work_window where work_window.version_id=v_publication.source_version_id and work_window.weekday=7
      and not exists(select 1 from public.team_workweek_google_series series where series.publication_id=v_publication.id
        and series.projection_part='spring' and work_window.id=any(series.source_window_ids))
      and exists(select 1 from public.team_workweek_windows where version_id=v_publication.source_version_id and weekday=7 and start_minute<180 and end_minute>120);
  update public.team_workweek_publications set projection_omissions=v_omissions where id=v_publication.id;
end; $$;
revoke all on function public.plan_team_workweek_civil_effects(uuid) from public,anon,authenticated,service_role;
create or replace function public.prepare_team_workweek_publication(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner text;
  v_version public.team_workweek_versions%rowtype;
  v_publication public.team_workweek_publications%rowtype;
  v_generation integer;
  v_effects jsonb;
  v_predecessor public.team_workweek_publications%rowtype;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id = auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_version from public.team_workweek_versions where id=p_version_id and owner_profile_id=v_owner for update;
  if not found then raise exception using errcode='P0002',message='private team workweek version not found'; end if;
  if v_version.base_publication_id is not null and not exists(select 1 from public.team_workweek_publications
    where id=v_version.base_publication_id and owner_profile_id=v_owner and status='published' and effective_to is null
      and publication_revision=v_version.base_publication_revision) and not exists(select 1 from public.team_workweek_publications where source_version_id=v_version.id) then
    raise exception using errcode='P0004',message='published workweek revision is stale';
  end if;
  if exists(select 1 from public.team_workweek_publications where source_version_id=p_version_id and owner_profile_id=v_owner and attempt_generation=0) then
    return public.prepare_monday_team_workweek_publication(p_version_id);
  end if;
  select * into v_predecessor from public.team_workweek_publications where owner_profile_id=v_owner and status='published' and effective_to is null
    order by publication_revision desc limit 1 for update;
  select * into v_publication from public.team_workweek_publications where source_version_id=p_version_id and owner_profile_id=v_owner for update;
  if found and v_publication.status='published' then
    -- Lost finalize response: replay the committed generation even after its deadline.
    null;
  else
    if v_version.activation_mode='immediate' then
      if v_predecessor.id is distinct from v_version.base_publication_id
        or v_predecessor.publication_revision is distinct from v_version.base_publication_revision then
        raise exception using errcode='P0004',message='published workweek revision is stale';
      end if;
      if v_predecessor.id is not null and coalesce(v_predecessor.effective_at,v_predecessor.effective_from::timestamp at time zone 'Europe/Berlin')>clock_timestamp() then
        raise exception using errcode='22023',message='prepared successor must remain untouched';
      end if;
    end if;
    if v_publication.id is null then
      if v_version.activation_mode='future_monday' and v_version.effective_from::timestamp at time zone 'Europe/Berlin'<=clock_timestamp() then
        raise exception using errcode='22023',message='future Monday is no longer eligible';
      end if;
      if exists (select 1 from public.team_workweek_publications where owner_profile_id=v_owner and status='preparing') then
        raise exception using errcode='P0003',message='another team workweek publication is still preparing';
      end if;
      insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,publication_revision,activation_mode,effective_at,attempt_generation,predecessor_publication_id,expected_predecessor_revision)
      select v_version.id,v_owner,v_version.effective_from,
        coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'startMinute',start_minute,'endMinute',end_minute) order by weekday,start_minute),'[]'),
        (select coalesce(max(publication_revision),0)+1 from public.team_workweek_publications where owner_profile_id=v_owner),
        v_version.activation_mode,case when v_version.activation_mode='immediate' then date_trunc('minute',clock_timestamp())+interval '3 minutes' else v_version.effective_from::timestamp at time zone 'Europe/Berlin' end,1,v_predecessor.id,v_predecessor.publication_revision
      from public.team_workweek_windows where version_id=v_version.id returning * into v_publication;
    elsif v_publication.effective_at <= clock_timestamp() and not exists (
      select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and state <> 'cleaned'
    ) then
      update public.team_workweek_publications set effective_at=case when activation_mode='immediate' then date_trunc('minute',clock_timestamp())+interval '3 minutes' else (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7)::timestamp at time zone 'Europe/Berlin' end,
        effective_from=case when activation_mode='future_monday' then date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7 else effective_from end,
        attempt_generation=attempt_generation+1,sync_state='pending',planned_effect_count=null,projection_omissions='[]'
      where id=v_publication.id returning * into v_publication;
    end if;
    v_generation:=v_publication.attempt_generation;
    if not exists (select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_generation)
      and v_publication.effective_at > clock_timestamp() then
      perform public.plan_team_workweek_civil_effects(v_publication.id);
    end if;
  end if;
  if v_publication.status='preparing' and v_publication.predecessor_publication_id is not null and v_publication.effective_at>clock_timestamp() then
    perform public.plan_team_workweek_predecessor_effects(v_publication.id);
  end if;
  if v_publication.status='preparing' then
    update public.team_workweek_publications set planned_effect_count=(select count(*) from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation) where id=v_publication.id and planned_effect_count is null;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'calendarId','primary','googleEventId',google_event_id,'generation',generation,'payload',payload,'state',state,'confirmedEtag',confirmed_etag,'kind',kind,'operation',operation,'expectedPayload',expected_payload,'expectedEtag',expected_etag,'instanceOf',instance_of,'originalStart',original_start) order by case when operation='create' then 0 when kind='crossing_instance' then 1 else 2 end,id),'[]')
    into v_effects from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation;
  return jsonb_build_object('id',v_publication.id,'sourceVersionId',v_version.id,'ownerProfileId',v_owner,'effectiveFrom',v_publication.effective_from,
    'activationMode',v_publication.activation_mode,'predecessorPublicationId',v_publication.predecessor_publication_id,'effectiveAt',v_publication.effective_at,'attemptGeneration',v_publication.attempt_generation,
    'timezone','Europe/Berlin','status',v_publication.status,'syncState',v_publication.sync_state,'publicationRevision',v_publication.publication_revision,
    'publishedAt',v_publication.published_at,'lastSyncAt',v_publication.last_sync_at,'series','[]'::jsonb,'transitions','[]'::jsonb,'effects',v_effects);
end; $$;
revoke all on function public.prepare_team_workweek_publication(uuid) from public,anon,service_role;
grant execute on function public.prepare_team_workweek_publication(uuid) to authenticated;

create or replace function public.finalize_team_workweek_publication(p_publication_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text; v_publication public.team_workweek_publications%rowtype;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_publication from public.team_workweek_publications where id=p_publication_id and owner_profile_id=v_owner for update;
  if not found then raise exception using errcode='P0002',message='team workweek publication not found'; end if;
  if v_publication.attempt_generation=0 then return public.finalize_monday_team_workweek_publication(p_publication_id); end if;
  if v_publication.status='preparing' then
    if clock_timestamp()>=v_publication.effective_at then raise exception using errcode='P0005',message='activation candidate expired'; end if;
    if v_publication.predecessor_publication_id is not null and not exists(select 1 from public.team_workweek_publications
      where id=v_publication.predecessor_publication_id and owner_profile_id=v_owner and status='published' and effective_to is null
        and publication_revision=v_publication.expected_predecessor_revision) then
      raise exception using errcode='P0004',message='published workweek revision is stale';
    end if;
    if exists(select 1 from public.team_workweek_publications where owner_profile_id=v_owner and status='published'
      and id is distinct from v_publication.predecessor_publication_id and effective_to is null) then
      raise exception using errcode='P0004',message='published workweek revision is stale';
    end if;
    if v_publication.planned_effect_count is null or exists(select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and state<>'confirmed')
      or (select count(*) from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation ) <> v_publication.planned_effect_count then
      raise exception using errcode='P0003',message='all projection effects must be confirmed';
    end if;
    if v_publication.predecessor_publication_id is not null then
      update public.team_workweek_publications set effective_until=v_publication.effective_at,
        effective_to=(v_publication.effective_at at time zone 'Europe/Berlin')::date,superseded_by_publication_id=v_publication.id
      where id=v_publication.predecessor_publication_id;
    end if;
    update public.team_workweek_google_series as series set provider_state='deleted',provider_deleted_at=clock_timestamp()
      where id in(select series_id from public.team_workweek_publication_effects where publication_id=v_publication.id
        and generation=v_publication.attempt_generation and operation='cancel');
    update public.team_workweek_publications set status='published' ,sync_state='confirmed',published_at=clock_timestamp(),last_sync_at=clock_timestamp()
      where id=v_publication.id and effective_at>clock_timestamp() returning * into v_publication;
    if not found or clock_timestamp()>=v_publication.effective_at then
      raise exception using errcode='P0005',message='activation candidate expired';
    end if;
  elsif v_publication.status<>'published' then
    raise exception using errcode='P0004',message='publication is inactive';
  end if;
  return jsonb_build_object('id',v_publication.id,'status',v_publication.status,'syncState',v_publication.sync_state,
    'publishedAt',v_publication.published_at,'lastSyncAt',v_publication.last_sync_at,'publicationRevision',v_publication.publication_revision,
    'activationMode',v_publication.activation_mode,'effectiveAt',v_publication.effective_at);
end; $$;
revoke all on function public.finalize_team_workweek_publication(uuid) from public,anon,service_role;
grant execute on function public.finalize_team_workweek_publication(uuid) to authenticated;


do $$ declare v_definition text; begin
  select pg_get_functiondef('public.prepare_monday_team_workweek_publication(uuid)'::regprocedure) into v_definition;
  execute replace(v_definition,'on conflict (source_window_id) do nothing','on conflict (source_window_id,projection_part) do nothing');
end; $$;
create or replace function public.plan_team_workweek_predecessor_effects(p_publication_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
  v_publication public.team_workweek_publications%rowtype;
  v_predecessor public.team_workweek_publications%rowtype;
  v_series record;
  v_prior record;
  v_before jsonb;
  v_payload jsonb;
  v_effect_id uuid;
  v_first_date date;
  v_last_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_count integer;
begin
  select * into v_publication from public.team_workweek_publications where id=p_publication_id;
  if v_publication.predecessor_publication_id is null or exists(select 1 from public.team_workweek_publication_effects
    where publication_id=p_publication_id and generation=v_publication.attempt_generation and operation<>'create') then return; end if;
  select * into v_predecessor from public.team_workweek_publications where id=v_publication.predecessor_publication_id;
  for v_series in select series.*,work_window.weekday,work_window.start_minute,work_window.end_minute
    from public.team_workweek_google_series series join public.team_workweek_windows work_window on work_window.id=series.source_window_id
    where series.publication_id=v_predecessor.id and series.provider_state='active' order by series.id loop
    if v_series.state<>'confirmed' then raise exception using errcode='P0003',message='predecessor series must be confirmed'; end if;
    select payload into v_before from public.team_workweek_publication_effects
      where series_id=v_series.id and kind='weekly' and operation='create' and state='confirmed' order by generation desc limit 1;
    if v_before is null then
      v_first_date:=v_predecessor.effective_from+v_series.weekday-1;
      v_before:=jsonb_build_object('id',v_series.google_event_id,'summary','Arbeitszeit','description','Mit FounderOps synchronisiert',
        'start',jsonb_build_object('dateTime',public.team_workweek_berlin_civil_instant(v_first_date::timestamp+make_interval(mins=>v_series.start_minute)),'timeZone','Europe/Berlin'),
        'end',jsonb_build_object('dateTime',public.team_workweek_berlin_civil_instant(v_first_date::timestamp+make_interval(mins=>v_series.end_minute)),'timeZone','Europe/Berlin'),
        'recurrence',jsonb_build_array('RRULE:FREQ=WEEKLY'),'transparency','transparent','visibility','private','reminders',jsonb_build_object('useDefault',false),
        'extendedProperties',jsonb_build_object('private',jsonb_build_object('founderopsWorkweekSeriesId',v_series.id,'founderopsWorkweekRevision',v_predecessor.publication_revision::text)));
    end if;
    v_first_date:=((v_before#>>'{start,dateTime}')::timestamptz at time zone 'Europe/Berlin')::date;
    select max(day::date) into v_last_date from generate_series(
      greatest(v_first_date,((v_publication.effective_at at time zone 'Europe/Berlin')::date-370))::timestamp,
      (v_publication.effective_at at time zone 'Europe/Berlin')::date::timestamp,interval '1 day') day
      where extract(isodow from day)=v_series.weekday
        and (v_series.projection_part in('legacy','weekly') or public.team_workweek_projection_part(day::date)=v_series.projection_part);
    v_start:=case when v_last_date=v_first_date then (v_before#>>'{start,dateTime}')::timestamptz
      else public.team_workweek_berlin_civil_instant(v_last_date+(((v_before#>>'{start,dateTime}')::timestamptz at time zone 'Europe/Berlin')::time)) end;
    v_end:=v_start+((v_before#>>'{end,dateTime}')::timestamptz-(v_before#>>'{start,dateTime}')::timestamptz);
    v_count:=case when (v_before#>>'{start,dateTime}')::timestamptz>=v_publication.effective_at then 0 else 1 end;
    v_effect_id:=gen_random_uuid();
    v_payload:=v_before||jsonb_build_object('status',case when v_count=0 then 'cancelled' else 'confirmed' end);
    if v_count>0 then v_payload:=jsonb_set(v_payload,'{recurrence}',jsonb_build_array(regexp_replace(v_before#>>'{recurrence,0}',';(COUNT|UNTIL)=[^;]+','','g')||';UNTIL='||to_char((v_publication.effective_at-interval '1 second') at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"'))); end if;
    v_payload:=jsonb_set(v_payload,'{extendedProperties,private}',(v_before#>'{extendedProperties,private}')||jsonb_build_object('founderopsWorkweekTransitionId',v_effect_id::text));
    insert into public.team_workweek_publication_effects(id,publication_id,owner_profile_id,generation,series_id,kind,google_event_id,payload,operation,expected_payload,expected_etag)
      values(v_effect_id,v_publication.id,v_publication.owner_profile_id,v_publication.attempt_generation,v_series.id,'predecessor_cutoff',v_series.google_event_id,v_payload,
        case when v_count=0 then 'cancel' else 'update' end,v_before,v_series.confirmed_etag);
    if v_count>0 and v_start<v_publication.effective_at and v_end>v_publication.effective_at then
      v_effect_id:=gen_random_uuid();
      v_before:=(v_before-'recurrence')||jsonb_build_object('start',jsonb_build_object('dateTime',v_start,'timeZone','Europe/Berlin'),
        'end',jsonb_build_object('dateTime',v_end,'timeZone','Europe/Berlin'));
      v_payload:=jsonb_set(v_before,'{end,dateTime}',to_jsonb(v_publication.effective_at));
      v_payload:=jsonb_set(v_payload,'{extendedProperties,private}',(v_before#>'{extendedProperties,private}')||jsonb_build_object('founderopsWorkweekTransitionId',v_effect_id::text));
      insert into public.team_workweek_publication_effects(id,publication_id,owner_profile_id,generation,kind,google_event_id,payload,operation,expected_payload,instance_of,original_start)
        values(v_effect_id,v_publication.id,v_publication.owner_profile_id,v_publication.attempt_generation,'crossing_instance',v_series.google_event_id,v_payload,'update',v_before,v_series.google_event_id,v_start);
    end if;
  end loop;
  for v_prior in select * from public.team_workweek_publication_effects
    where publication_id=v_predecessor.id and kind='activation_remainder' and operation='create' and state='confirmed' loop
    v_before:=v_prior.payload;
    if (v_before#>>'{end,dateTime}')::timestamptz<=v_publication.effective_at then continue; end if;
    v_effect_id:=gen_random_uuid();
    if (v_before#>>'{start,dateTime}')::timestamptz<v_publication.effective_at then
      v_payload:=jsonb_set(v_before,'{end,dateTime}',to_jsonb(v_publication.effective_at));
    else v_payload:=v_before||jsonb_build_object('status','cancelled'); end if;
    v_payload:=jsonb_set(v_payload,'{extendedProperties,private}',(v_before#>'{extendedProperties,private}')||jsonb_build_object('founderopsWorkweekTransitionId',v_effect_id::text));
    insert into public.team_workweek_publication_effects(id,publication_id,owner_profile_id,generation,kind,google_event_id,payload,operation,expected_payload,expected_etag)
      values(v_effect_id,v_publication.id,v_publication.owner_profile_id,v_publication.attempt_generation,'predecessor_remainder',v_prior.google_event_id,v_payload,
        case when v_payload->>'status'='cancelled' then 'cancel' else 'update' end,v_before,v_prior.confirmed_etag);
  end loop;
end; $$;
revoke all on function public.plan_team_workweek_predecessor_effects(uuid) from public,anon,authenticated,service_role;
