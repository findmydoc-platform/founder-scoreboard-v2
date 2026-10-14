-- Current corrections keep legacy anchors and snapshots; ownership switches on half-open instants.
alter table public.team_workweek_versions add column if not exists base_publication_id uuid references public.team_workweek_publications(id);
alter table public.team_workweek_versions add column if not exists base_publication_revision integer;
alter table public.team_workweek_publications add column if not exists expected_predecessor_revision integer;
alter table public.team_workweek_publication_effects drop constraint team_workweek_publication_effects_kind_check;
alter table public.team_workweek_publication_effects add constraint team_workweek_effect_kind check(kind in('weekly','activation_remainder','predecessor_cutoff','crossing_instance','predecessor_remainder'));
alter table public.team_workweek_publication_effects drop constraint team_workweek_publication_effects_google_event_id_key;
alter table public.team_workweek_publication_effects add column if not exists operation text not null default 'create' check(operation in('create','update','cancel'));
alter table public.team_workweek_publication_effects add column if not exists expected_payload jsonb;
alter table public.team_workweek_publication_effects add column if not exists expected_etag text;
alter table public.team_workweek_publication_effects add column if not exists instance_of text;
alter table public.team_workweek_publication_effects add column if not exists original_start timestamptz;
create unique index team_workweek_effect_target_generation on public.team_workweek_publication_effects(publication_id,generation,google_event_id,kind);

create or replace function public.enforce_team_workweek_version_boundary()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_latest date; v_base uuid; v_revision integer;
begin
  if new.activation_mode='immediate' then
    if new.base_publication_id is not null and not exists(select 1 from public.team_workweek_publications
      where id=new.base_publication_id and owner_profile_id=new.owner_profile_id and status='published' and effective_to is null
        and publication_revision=new.base_publication_revision) then
      raise exception using errcode='P0004',message='published workweek revision is stale';
    end if;
    return new;
  end if;
  select effective_from,id,publication_revision into v_latest,v_base,v_revision from public.team_workweek_publications
    where owner_profile_id=new.owner_profile_id and status='published' order by publication_revision desc limit 1;
  if new.base_publication_id is null then new.base_publication_id:=v_base; new.base_publication_revision:=v_revision; end if;
  if v_latest is not null and new.effective_from<=v_latest then
    raise exception using errcode='22023',message='new workweek version must start after the latest published boundary';
  end if;
  return new;
end; $$;
revoke all on function public.enforce_team_workweek_version_boundary() from public,anon,authenticated,service_role;

create or replace function public.create_private_current_team_workweek_version(
  p_windows jsonb, p_base_publication_id uuid, p_base_publication_revision integer
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_owner_profile_id text;
  p_effective_from date := date_trunc('week', clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_version_id uuid;
  v_window jsonb;
  v_weekday smallint;
  v_start_minute smallint;
  v_end_minute smallint;
begin
  select profile.id
  into v_owner_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid();

  if not found or v_owner_profile_id is null then
    raise exception using errcode = '42501', message = 'mapped team profile required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner_profile_id, 0));
  if exists (select 1 from public.team_workweek_publications where owner_profile_id = v_owner_profile_id and status = 'preparing') then
    raise exception using errcode = 'P0003', message = 'finish the pending publication before editing';
  end if;
  if exists (select 1 from public.team_workweek_publications where owner_profile_id=v_owner_profile_id and status='published'
    and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')>clock_timestamp()) then
    raise exception using errcode='22023',message='prepared successor must remain untouched';
  end if;
  if not exists(select 1 from public.team_workweek_publications where id=p_base_publication_id and owner_profile_id=v_owner_profile_id
    and status='published' and publication_revision=p_base_publication_revision and effective_to is null
    and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp()) then
    raise exception using errcode='P0004',message='published workweek revision is stale';
  end if;
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) > 84 then
    raise exception using errcode = '22023', message = 'workweek windows must be a bounded array';
  end if;

  insert into public.team_workweek_versions (owner_profile_id, effective_from, activation_mode,base_publication_id,base_publication_revision)
  values (v_owner_profile_id, p_effective_from, 'immediate',p_base_publication_id,p_base_publication_revision)
  returning id into v_version_id;

  for v_window in select value from jsonb_array_elements(p_windows)
  loop
    if jsonb_typeof(v_window) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_window) as key
        where key not in ('weekday', 'startMinute', 'endMinute')
      )
      or v_window->>'weekday' is null
      or v_window->>'startMinute' is null
      or v_window->>'endMinute' is null then
      raise exception using errcode = '22023', message = 'workweek window contains unsupported fields';
    end if;

    begin
      v_weekday := (v_window->>'weekday')::smallint;
      v_start_minute := (v_window->>'startMinute')::smallint;
      v_end_minute := (v_window->>'endMinute')::smallint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'workweek window contains invalid values';
    end;

    if v_weekday not between 1 and 7
      or v_start_minute not between 0 and 1438
      or v_end_minute not between 1 and 1439
      or v_start_minute >= v_end_minute then
      raise exception using errcode = '22023', message = 'workweek window must stay inside one day and begin before it ends';
    end if;
    if (
      select count(*)
      from public.team_workweek_windows as existing
      where existing.version_id = v_version_id
        and existing.weekday = v_weekday
    ) >= 12 then
      raise exception using errcode = '22023', message = 'workweek day contains too many windows';
    end if;
    if exists (
      select 1
      from public.team_workweek_windows as existing
      where existing.version_id = v_version_id
        and existing.weekday = v_weekday
        and v_start_minute < existing.end_minute
        and v_end_minute > existing.start_minute
    ) then
      raise exception using errcode = '22023', message = 'workweek windows must not overlap';
    end if;

    insert into public.team_workweek_windows (version_id, weekday, start_minute, end_minute)
    values (v_version_id, v_weekday, v_start_minute, v_end_minute);
  end loop;

  return jsonb_build_object(
    'id', v_version_id,
    'effectiveFrom', p_effective_from,
    'activationMode', 'immediate',
    'basePublicationId',p_base_publication_id,'basePublicationRevision',p_base_publication_revision,
    'timezone', 'Europe/Berlin',
    'status', 'preparing',
    'createdAt', clock_timestamp()
  );
end;
$$;



revoke all on function public.create_private_current_team_workweek_version(jsonb,uuid,integer) from public,anon,service_role;
grant execute on function public.create_private_current_team_workweek_version(jsonb,uuid,integer) to authenticated;

-- RFC5545 civil repetitions select the earlier occurrence. Explicit stored DTSTART stays authoritative.
create or replace function public.team_workweek_berlin_civil_instant(p_local timestamp)
returns timestamptz language sql immutable set search_path=public as $$
  select case when ((p_local at time zone 'Europe/Berlin')-interval '1 hour') at time zone 'Europe/Berlin'=p_local
    then (p_local at time zone 'Europe/Berlin')-interval '1 hour' else p_local at time zone 'Europe/Berlin' end;
$$;
revoke all on function public.team_workweek_berlin_civil_instant(timestamp) from public,anon,authenticated,service_role;

-- Durable predecessor plans use each actual first occurrence, never the Monday anchor-wide COUNT.
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
    v_last_date:=(v_publication.effective_at at time zone 'Europe/Berlin')::date;
    v_last_date:=v_last_date-((extract(isodow from v_last_date)::integer-v_series.weekday+7)%7);
    v_start:=case when v_last_date=v_first_date then (v_before#>>'{start,dateTime}')::timestamptz
      else public.team_workweek_berlin_civil_instant(v_last_date::timestamp+make_interval(mins=>v_series.start_minute)) end;
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
create or replace function public.prepare_team_workweek_publication(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner text;
  v_version public.team_workweek_versions%rowtype;
  v_publication public.team_workweek_publications%rowtype;
  v_window record;
  v_series_id uuid;
  v_effect_id uuid;
  v_event_id text;
  v_payload jsonb;
  v_start timestamptz;
  v_end timestamptz;
  v_first_date date;
  v_activation_date date;
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
  if v_version.activation_mode='future_monday' and not exists(
    select 1 from public.team_workweek_publications where owner_profile_id=v_owner and status='published' and effective_to is null and effective_at is not null
  ) then return public.prepare_monday_team_workweek_publication(p_version_id); end if;
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
        attempt_generation=attempt_generation+1,sync_state='pending'
      where id=v_publication.id returning * into v_publication;
    end if;
    v_generation:=v_publication.attempt_generation;
    if not exists (select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_generation)
      and v_publication.effective_at > clock_timestamp() then
      v_activation_date := (v_publication.effective_at at time zone 'Europe/Berlin')::date;
      for v_window in select * from public.team_workweek_windows where version_id=v_version.id order by weekday,start_minute,id loop
        v_series_id:=gen_random_uuid();
        insert into public.team_workweek_google_series(id,publication_id,source_window_id,owner_profile_id,google_event_id)
          values(v_series_id,v_publication.id,v_window.id,v_owner,'fops'||replace(v_series_id::text,'-',''))
          on conflict(source_window_id) do update set state='pending',confirmed_etag=null,confirmed_founderops_revision=null,last_confirmed_at=null
          returning id into v_series_id;
        v_first_date:=v_activation_date + ((v_window.weekday-extract(isodow from v_activation_date)::integer+7)%7);
        v_start := (v_first_date::timestamp+make_interval(mins=>v_window.start_minute)) at time zone 'Europe/Berlin';
        v_end := (v_first_date::timestamp+make_interval(mins=>v_window.end_minute)) at time zone 'Europe/Berlin';
        -- A clipped first occurrence is a single event; weekly masters retain full wall-clock windows.
        if v_start<v_publication.effective_at and v_end>v_publication.effective_at then
          v_effect_id:=gen_random_uuid(); v_event_id:='fops'||replace(v_effect_id::text,'-','');
          v_payload:=jsonb_build_object('id',v_event_id,'summary','Arbeitszeit','description','Mit FounderOps synchronisiert',
            'start',jsonb_build_object('dateTime',v_publication.effective_at,'timeZone','Europe/Berlin'),
            'end',jsonb_build_object('dateTime',v_end,'timeZone','Europe/Berlin'),
            'transparency','transparent','visibility','private','reminders',jsonb_build_object('useDefault',false),
            'extendedProperties',jsonb_build_object('private',jsonb_build_object('founderopsWorkweekEffectId',v_effect_id,'founderopsWorkweekGeneration',v_generation::text,'founderopsWorkweekRevision',v_publication.publication_revision::text)));
          insert into public.team_workweek_publication_effects(id,publication_id,owner_profile_id,generation,kind,google_event_id,payload)
            values(v_effect_id,v_publication.id,v_owner,v_generation,'activation_remainder',v_event_id,v_payload);
        end if;
        if v_start<v_publication.effective_at then
          v_first_date:=v_first_date+7;
          v_start := (v_first_date::timestamp+make_interval(mins=>v_window.start_minute)) at time zone 'Europe/Berlin';
          v_end := (v_first_date::timestamp+make_interval(mins=>v_window.end_minute)) at time zone 'Europe/Berlin';
        end if;
        -- DST civil gaps can collapse or invert a short window. Skip that civil occurrence;
        -- the regular template remains intact for the following week.
        if v_end<=v_start then
          v_first_date:=v_first_date+7;
          v_start := (v_first_date::timestamp+make_interval(mins=>v_window.start_minute)) at time zone 'Europe/Berlin';
          v_end := (v_first_date::timestamp+make_interval(mins=>v_window.end_minute)) at time zone 'Europe/Berlin';
        end if;
        v_effect_id:=gen_random_uuid(); v_event_id:='fops'||replace(v_effect_id::text,'-','');
        update public.team_workweek_google_series set google_event_id=v_event_id where id=v_series_id;
        v_payload:=jsonb_build_object('id',v_event_id,'summary','Arbeitszeit','description','Mit FounderOps synchronisiert',
          'start',jsonb_build_object('dateTime',v_start,'timeZone','Europe/Berlin'),
          'end',jsonb_build_object('dateTime',v_end,'timeZone','Europe/Berlin'),
          'recurrence',jsonb_build_array('RRULE:FREQ=WEEKLY'),
          'transparency','transparent','visibility','private','reminders',jsonb_build_object('useDefault',false),
          'extendedProperties',jsonb_build_object('private',jsonb_build_object('founderopsWorkweekSeriesId',v_series_id,'founderopsWorkweekEffectId',v_effect_id,'founderopsWorkweekGeneration',v_generation::text,'founderopsWorkweekRevision',v_publication.publication_revision::text)));
        insert into public.team_workweek_publication_effects(id,publication_id,owner_profile_id,generation,series_id,kind,google_event_id,payload)
          values(v_effect_id,v_publication.id,v_owner,v_generation,v_series_id,'weekly',v_event_id,v_payload);
      end loop;
    end if;
  end if;
  if v_publication.status='preparing' and v_publication.predecessor_publication_id is not null and v_publication.effective_at>clock_timestamp() then
    perform public.plan_team_workweek_predecessor_effects(v_publication.id);
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
    if exists(select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and state<>'confirmed')
      or (select count(*) from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and kind='weekly') <> jsonb_array_length(v_publication.windows) then
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

alter table public.team_workweek_publication_effects drop constraint team_workweek_publication_effects_google_event_id_check;
alter table public.team_workweek_publication_effects add constraint team_workweek_effect_event_identity
  check(char_length(google_event_id) between 5 and 1024 and google_event_id ~ '^[A-Za-z0-9_]+$');

create or replace function public.bind_team_workweek_crossing_instance(p_effect_id uuid,p_generation integer,p_event_id text,p_etag text,p_original_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_effect public.team_workweek_publication_effects%rowtype; v_publication public.team_workweek_publications%rowtype; v_payload jsonb;
begin
  select * into v_effect from public.team_workweek_publication_effects where id=p_effect_id;
  if not found then raise exception using errcode='P0002',message='effect not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_effect.owner_profile_id,0));
  select * into v_publication from public.team_workweek_publications where id=v_effect.publication_id for update;
  if v_publication.status<>'preparing' or v_publication.attempt_generation<>p_generation or v_effect.generation<>p_generation
    or v_effect.kind<>'crossing_instance' or v_effect.state<>'pending' or clock_timestamp()>=v_publication.effective_at then
    raise exception using errcode='P0003',message='stale or expired instance binding';
  end if;
  if nullif(trim(p_etag),'') is null or p_event_id !~ '^[A-Za-z0-9_]{5,255}$'
    or p_original_payload->>'id' is distinct from p_event_id
    or ((p_original_payload#>>'{start,dateTime}')::timestamptz at time zone 'Europe/Berlin') is distinct from (v_effect.original_start at time zone 'Europe/Berlin')
    or (p_original_payload#>>'{end,dateTime}')::timestamptz<=(p_original_payload#>>'{start,dateTime}')::timestamptz
    or p_original_payload#>'{extendedProperties,private}' is null then
    raise exception using errcode='22023',message='invalid instance observation';
  end if;
  if v_effect.expected_etag is not null then
    if v_effect.google_event_id<>p_event_id or v_effect.expected_payload<>p_original_payload then
      raise exception using errcode='P0004',message='instance binding changed';
    end if;
  else
    v_payload:=jsonb_set(p_original_payload,'{end,dateTime}',to_jsonb(v_publication.effective_at));
    v_payload:=jsonb_set(v_payload,'{extendedProperties,private}',(p_original_payload#>'{extendedProperties,private}')||jsonb_build_object('founderopsWorkweekTransitionId',v_effect.id::text));
    update public.team_workweek_publication_effects set google_event_id=p_event_id,expected_etag=p_etag,expected_payload=p_original_payload,payload=v_payload where id=p_effect_id returning * into v_effect;
  end if;
  return jsonb_build_object('id',v_effect.id,'calendarId','primary','googleEventId',v_effect.google_event_id,'generation',v_effect.generation,
    'payload',v_effect.payload,'state',v_effect.state,'confirmedEtag',v_effect.confirmed_etag,'kind',v_effect.kind,'operation',v_effect.operation,
    'expectedPayload',v_effect.expected_payload,'expectedEtag',v_effect.expected_etag,'instanceOf',v_effect.instance_of,'originalStart',v_effect.original_start);
end; $$;
revoke all on function public.bind_team_workweek_crossing_instance(uuid,integer,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.bind_team_workweek_crossing_instance(uuid,integer,text,text,jsonb) to service_role;

create or replace function public.confirm_team_workweek_effect(p_effect_id uuid,p_generation integer,p_etag text,p_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_effect public.team_workweek_publication_effects%rowtype; v_publication public.team_workweek_publications%rowtype;
begin
  select * into v_effect from public.team_workweek_publication_effects where id=p_effect_id;
  if not found then raise exception using errcode='P0002',message='effect not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_effect.owner_profile_id,0));
  select * into v_publication from public.team_workweek_publications where id=v_effect.publication_id for update;
  if v_publication.status<>'preparing' or v_publication.attempt_generation<>p_generation or v_effect.generation<>p_generation
    or v_effect.state='cleaned' or v_effect.payload<>p_payload or nullif(trim(p_etag),'') is null or clock_timestamp()>=v_publication.effective_at
    or (v_effect.kind='crossing_instance' and v_effect.expected_etag is null) then
    raise exception using errcode='P0003',message='stale or expired projection confirmation';
  end if;
  update public.team_workweek_publication_effects set state='confirmed',confirmed_etag=p_etag,observed_at=clock_timestamp() where id=p_effect_id;
  if v_effect.series_id is not null then
    update public.team_workweek_google_series set state='confirmed',confirmed_etag=p_etag,
      confirmed_founderops_revision=case when v_effect.operation='create' then v_publication.publication_revision else confirmed_founderops_revision end,
      last_confirmed_at=clock_timestamp(),last_observed_at=clock_timestamp() where id=v_effect.series_id;
  end if;
end; $$;
revoke all on function public.confirm_team_workweek_effect(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_team_workweek_effect(uuid,integer,text,jsonb) to service_role;

create or replace function public.confirm_team_workweek_effect_restoration(p_effect_id uuid,p_generation integer,p_etag text)
returns void language plpgsql security definer set search_path=public as $$
declare v_effect public.team_workweek_publication_effects%rowtype;
begin
  select * into v_effect from public.team_workweek_publication_effects where id=p_effect_id;
  if not found or v_effect.operation='create' or nullif(trim(p_etag),'') is null then
    raise exception using errcode='22023',message='restored predecessor observation required';
  end if;
  perform public.confirm_team_workweek_effect_cleanup(p_effect_id,p_generation);
  if v_effect.series_id is not null then
    update public.team_workweek_google_series set confirmed_etag=p_etag,last_observed_at=clock_timestamp() where id=v_effect.series_id;
  end if;
  update public.team_workweek_publication_effects set confirmed_etag=p_etag
    where publication_id<>v_effect.publication_id and google_event_id=v_effect.google_event_id and operation='create' and state='confirmed';
end; $$;
revoke all on function public.confirm_team_workweek_effect_restoration(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.confirm_team_workweek_effect_restoration(uuid,integer,text) to service_role;

create or replace function public.create_private_monday_team_workweek_version(p_effective_from date,p_windows jsonb,p_base_publication_id uuid,p_base_publication_revision integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  if not exists(select 1 from public.team_workweek_publications where id=p_base_publication_id and owner_profile_id=v_owner and status='published' and effective_to is null and publication_revision=p_base_publication_revision) then
    raise exception using errcode='P0004',message='published workweek revision is stale';
  end if;
  return public.create_private_team_workweek_version(p_effective_from,p_windows)
    ||jsonb_build_object('basePublicationId',p_base_publication_id,'basePublicationRevision',p_base_publication_revision);
end; $$;
revoke all on function public.create_private_monday_team_workweek_version(date,jsonb,uuid,integer) from public,anon,service_role;
grant execute on function public.create_private_monday_team_workweek_version(date,jsonb,uuid,integer) to authenticated;
