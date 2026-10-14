-- Owner drafts pin all prepared successors; only mapped owner RPCs may use the internal snapshot.
alter table public.team_workweek_versions add column if not exists successor_snapshot jsonb;
alter table public.team_workweek_publications add column if not exists successor_snapshot jsonb;
alter table public.team_workweek_publications add column if not exists successor_publication_id uuid references public.team_workweek_publications(id);
create or replace function public.team_workweek_successor_snapshot(p_owner text)
returns jsonb language sql stable security definer set search_path=public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'revision',p.publication_revision,'start',coalesce(p.effective_at,p.effective_from::timestamp at time zone 'Europe/Berlin'),
    'until',p.effective_until,'effectiveTo',p.effective_to,'windows',p.windows,'sourceVersionId',p.source_version_id,'supersededBy',p.superseded_by_publication_id,
    'series',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'googleEventId',s.google_event_id,'etag',s.confirmed_etag,'state',s.state,'providerState',s.provider_state,'part',s.projection_part,'sources',s.source_window_ids) order by s.id),'[]') from public.team_workweek_google_series s where s.publication_id=p.id))
    order by coalesce(p.effective_at,p.effective_from::timestamp at time zone 'Europe/Berlin'),p.id),'[]')
  from public.team_workweek_publications p where p.owner_profile_id=p_owner and p.status='published'
    and coalesce(p.effective_at,p.effective_from::timestamp at time zone 'Europe/Berlin')>clock_timestamp();
$$;
revoke all on function public.team_workweek_successor_snapshot(text) from public,anon,authenticated,service_role;

create or replace function public.enforce_team_workweek_version_boundary()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_latest date; v_base uuid; v_revision integer;
begin
  if new.activation_mode='immediate' then
    if new.base_publication_id is not null and not exists(select 1 from public.team_workweek_publications
      where id=new.base_publication_id and owner_profile_id=new.owner_profile_id and status='published' and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()
        and publication_revision=new.base_publication_revision) then
      raise exception using errcode='P0004',message='published workweek revision is stale';
    end if;
    new.successor_snapshot:=public.team_workweek_successor_snapshot(new.owner_profile_id);
    return new;
  end if;
  select effective_from,id,publication_revision into v_latest,v_base,v_revision from public.team_workweek_publications
    where owner_profile_id=new.owner_profile_id and status='published' order by effective_from desc,publication_revision desc limit 1;
  if new.base_publication_id is null then new.base_publication_id:=v_base; new.base_publication_revision:=v_revision; end if;
  if v_latest is not null and new.effective_from<=v_latest then
    raise exception using errcode='22023',message='new workweek version must start after the latest published boundary';
  end if;
  return new;
end; $$;

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
  if not exists(select 1 from public.team_workweek_publications where id=p_base_publication_id and owner_profile_id=v_owner_profile_id
    and status='published' and publication_revision=p_base_publication_revision and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()) then
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

create or replace function public.create_private_immediate_team_workweek_version(
  p_windows jsonb
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
  if exists (select 1 from public.team_workweek_publications where owner_profile_id = v_owner_profile_id and status = 'published' and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()) then
    raise exception using errcode = '22023', message = 'immediate first publication requires no published workweek';
  end if;
  if exists(select 1 from public.team_workweek_publications where owner_profile_id=v_owner_profile_id and status='published'
    and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')>clock_timestamp()
    and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=date_trunc('minute',clock_timestamp())+interval '3 minutes') then
    raise exception using errcode='22023',message='prepared successor starts before activation candidate';
  end if;
  if exists (select 1 from public.team_workweek_publications where owner_profile_id = v_owner_profile_id and status = 'preparing') then
    raise exception using errcode = 'P0003', message = 'finish the pending publication before editing';
  end if;
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) > 84 then
    raise exception using errcode = '22023', message = 'workweek windows must be a bounded array';
  end if;

  insert into public.team_workweek_versions (owner_profile_id, effective_from, activation_mode)
  values (v_owner_profile_id, p_effective_from, 'immediate')
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
    'timezone', 'Europe/Berlin',
    'status', 'preparing',
    'createdAt', clock_timestamp()
  );
end;
$$;

create or replace function public.prepare_team_workweek_publication(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner text;
  v_version public.team_workweek_versions%rowtype;
  v_publication public.team_workweek_publications%rowtype;
  v_generation integer;
  v_effects jsonb;
  v_predecessor public.team_workweek_publications%rowtype;
  v_successor public.team_workweek_publications%rowtype;
  v_snapshot jsonb;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id = auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_version from public.team_workweek_versions where id=p_version_id and owner_profile_id=v_owner for update;
  if not found then raise exception using errcode='P0002',message='private team workweek version not found'; end if;
  if v_version.base_publication_id is not null and not exists(select 1 from public.team_workweek_publications
    where id=v_version.base_publication_id and owner_profile_id=v_owner and status='published' and ((v_version.activation_mode='future_monday' and effective_to is null) or (v_version.activation_mode='immediate' and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()))
      and publication_revision=v_version.base_publication_revision) and not exists(select 1 from public.team_workweek_publications where source_version_id=v_version.id) then
    raise exception using errcode='P0004',message='published workweek revision is stale';
  end if;
  if exists(select 1 from public.team_workweek_publications where source_version_id=p_version_id and owner_profile_id=v_owner and attempt_generation=0) then
    return public.prepare_monday_team_workweek_publication(p_version_id);
  end if;
  select * into v_predecessor from public.team_workweek_publications where owner_profile_id=v_owner and status='published' and ((v_version.activation_mode='immediate' and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()) or (v_version.activation_mode='future_monday' and effective_to is null))
    order by publication_revision desc limit 1 for update;
  select * into v_publication from public.team_workweek_publications where source_version_id=p_version_id and owner_profile_id=v_owner for update;
  if found and v_publication.status='published' then
    -- Lost finalize response: replay the committed generation even after its deadline.
    null;
  elsif v_publication.id is not null and v_publication.effective_at<=clock_timestamp() and exists(
    select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and state<>'cleaned'
  ) then
    -- Expired immutable effects remain available for guarded compensation, even if the future plan changed.
    null;
  else
    if v_version.activation_mode='immediate' then
      if v_predecessor.id is distinct from v_version.base_publication_id
        or v_predecessor.publication_revision is distinct from v_version.base_publication_revision then
        raise exception using errcode='P0004',message='published workweek revision is stale';
      end if;
      v_snapshot:=public.team_workweek_successor_snapshot(v_owner);
      if v_version.successor_snapshot is not null and v_version.successor_snapshot<>v_snapshot then
        raise exception using errcode='P0004',message='prepared successor revision is stale';
      end if;
      select * into v_successor from public.team_workweek_publications where id=(v_snapshot->0->>'id')::uuid;

    end if;
    if v_publication.id is null then
      if v_version.activation_mode='future_monday' and v_version.effective_from::timestamp at time zone 'Europe/Berlin'<=clock_timestamp() then
        raise exception using errcode='22023',message='future Monday is no longer eligible';
      end if;
      if exists (select 1 from public.team_workweek_publications where owner_profile_id=v_owner and status='preparing') then
        raise exception using errcode='P0003',message='another team workweek publication is still preparing';
      end if;
      if v_successor.id is not null and date_trunc('minute',clock_timestamp())+interval '3 minutes'>=coalesce(v_successor.effective_at,v_successor.effective_from::timestamp at time zone 'Europe/Berlin') then
        raise exception using errcode='P0004',message='prepared successor starts before activation candidate';
      end if;
      insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,publication_revision,activation_mode,effective_at,attempt_generation,predecessor_publication_id,expected_predecessor_revision,successor_snapshot,successor_publication_id,effective_until,effective_to,superseded_by_publication_id)
      select v_version.id,v_owner,v_version.effective_from,
        coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'startMinute',start_minute,'endMinute',end_minute) order by weekday,start_minute),'[]'),
        (select coalesce(max(publication_revision),0)+1 from public.team_workweek_publications where owner_profile_id=v_owner),
        v_version.activation_mode,case when v_version.activation_mode='immediate' then date_trunc('minute',clock_timestamp())+interval '3 minutes' else v_version.effective_from::timestamp at time zone 'Europe/Berlin' end,1,v_predecessor.id,v_predecessor.publication_revision,v_snapshot,v_successor.id,
        coalesce(v_successor.effective_at,v_successor.effective_from::timestamp at time zone 'Europe/Berlin'),
        case when v_successor.id is not null then (coalesce(v_successor.effective_at,v_successor.effective_from::timestamp at time zone 'Europe/Berlin') at time zone 'Europe/Berlin')::date-1 end,v_successor.id
      from public.team_workweek_windows where version_id=v_version.id returning * into v_publication;
    elsif v_publication.effective_at <= clock_timestamp() and not exists (
      select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and state <> 'cleaned'
    ) then
      if v_publication.effective_until is not null and date_trunc('minute',clock_timestamp())+interval '3 minutes'>=v_publication.effective_until then
        raise exception using errcode='P0004',message='prepared successor starts before activation candidate';
      end if;
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
    'effectiveUntil',v_publication.effective_until,'successorPublicationId',v_publication.successor_publication_id,'activationMode',v_publication.activation_mode,'predecessorPublicationId',v_publication.predecessor_publication_id,'effectiveAt',v_publication.effective_at,'attemptGeneration',v_publication.attempt_generation,
    'timezone','Europe/Berlin','status',v_publication.status,'syncState',v_publication.sync_state,'publicationRevision',v_publication.publication_revision,
    'publishedAt',v_publication.published_at,'lastSyncAt',v_publication.last_sync_at,'series','[]'::jsonb,'transitions','[]'::jsonb,'effects',v_effects);
end; $$;

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
      where id=v_publication.predecessor_publication_id and owner_profile_id=v_owner and status='published' and ((v_publication.activation_mode='future_monday' and effective_to is null) or (v_publication.activation_mode='immediate' and coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp()))
        and publication_revision=v_publication.expected_predecessor_revision) then
      raise exception using errcode='P0004',message='published workweek revision is stale';
    end if;
    if v_publication.activation_mode='immediate' then
      if coalesce(v_publication.successor_snapshot,'[]'::jsonb) is distinct from public.team_workweek_successor_snapshot(v_owner) then
        raise exception using errcode='P0004',message='prepared successor revision is stale';
      end if;
    elsif exists(select 1 from public.team_workweek_publications where owner_profile_id=v_owner and status='published'
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
    'effectiveUntil',v_publication.effective_until,'successorPublicationId',v_publication.successor_publication_id,'activationMode',v_publication.activation_mode,'effectiveAt',v_publication.effective_at);
end; $$;

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
      'end',jsonb_build_object('dateTime',least(v_interval.ends_at,coalesce(v_publication.effective_until,'infinity'::timestamptz)),'timeZone','Europe/Berlin'),
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
        for v_interval in select * from public.team_workweek_day_intervals(v_publication.source_version_id,v_date) where starts_at>=v_publication.effective_at and starts_at<coalesce(v_publication.effective_until,'infinity'::timestamptz) loop
          v_key:=v_part||':'||array_to_string(v_interval.source_ids,',');
          if v_key=any(v_seen) then continue; end if;
          v_seen:=array_append(v_seen,v_key);
          v_rule:=case v_part when 'ordinary-months' then 'RRULE:FREQ=WEEKLY;BYDAY=SU;BYMONTH=1,2,4,5,6,7,8,9,11,12'
            when 'transition-month-ordinary' then 'RRULE:FREQ=MONTHLY;BYMONTH=3,10;BYDAY=SU;BYSETPOS=1,2,3,-2'
            when 'spring' then 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU'
            when 'autumn' then 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU' else 'RRULE:FREQ=WEEKLY' end;
          if v_publication.effective_until is not null then
            v_rule:=v_rule||';UNTIL='||to_char((v_publication.effective_until-interval '1 second') at time zone 'UTC','YYYYMMDD"T"HH24MISS"Z"');
          end if;
          v_series_id:=gen_random_uuid();
          insert into public.team_workweek_google_series(id,publication_id,source_window_id,source_window_ids,projection_part,owner_profile_id,google_event_id)
            values(v_series_id,v_publication.id,v_interval.source_ids[1],v_interval.source_ids,v_part,v_publication.owner_profile_id,'fops'||replace(v_series_id::text,'-',''))
            on conflict(source_window_id,projection_part) do update set state='pending',confirmed_etag=null,confirmed_founderops_revision=null,last_confirmed_at=null
            returning id into v_series_id;
          v_effect_id:=gen_random_uuid(); v_event_id:='fops'||replace(v_effect_id::text,'-','');
          update public.team_workweek_google_series set google_event_id=v_event_id where id=v_series_id;
          v_payload:=jsonb_build_object('id',v_event_id,'summary','Arbeitszeit','description','Mit FounderOps synchronisiert',
            'start',jsonb_build_object('dateTime',v_interval.starts_at,'timeZone','Europe/Berlin'),
            'end',jsonb_build_object('dateTime',least(v_interval.ends_at,coalesce(v_publication.effective_until,'infinity'::timestamptz)),'timeZone','Europe/Berlin'),'recurrence',jsonb_build_array(v_rule),
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
      and exists(select 1 from generate_series((v_publication.effective_at at time zone 'Europe/Berlin')::date::timestamp,(v_publication.effective_at at time zone 'Europe/Berlin')::date::timestamp+interval '740 days',interval '1 day') d where extract(isodow from d)=7 and public.team_workweek_projection_part(d::date)='spring' and public.team_workweek_berlin_civil_instant(d::timestamp+make_interval(mins=>work_window.start_minute))>=v_publication.effective_at and public.team_workweek_berlin_civil_instant(d::timestamp+make_interval(mins=>work_window.start_minute))<coalesce(v_publication.effective_until,'infinity'::timestamptz))
      and not exists(select 1 from public.team_workweek_google_series series where series.publication_id=v_publication.id
        and series.projection_part='spring' and work_window.id=any(series.source_window_ids))
      and exists(select 1 from public.team_workweek_windows where version_id=v_publication.source_version_id and weekday=7 and start_minute<180 and end_minute>120);
  if v_publication.effective_until is not null then
    select v_omissions||coalesce(jsonb_agg(jsonb_build_object('part',part,'sourceWindowId',w.id,'reason','no_full_occurrence_before_successor')),'[]') into v_omissions
      from public.team_workweek_windows w cross join lateral unnest(case when w.weekday=7 and exists(select 1 from public.team_workweek_windows x where x.version_id=w.version_id and x.weekday=7 and x.start_minute<180 and x.end_minute>120) then array['ordinary-months','transition-month-ordinary','spring','autumn'] else array['weekly'] end) part
      where w.version_id=v_publication.source_version_id
        and not exists(select 1 from public.team_workweek_google_series s where s.publication_id=v_publication.id and s.projection_part=part and w.id=any(s.source_window_ids))
        and not exists(select 1 from jsonb_array_elements(v_omissions) omission where omission->>'part'=part and (omission->>'sourceWindowId')::bigint=w.id);
  end if;
  update public.team_workweek_publications set projection_omissions=v_omissions where id=v_publication.id;
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
      where series_id=v_series.id and kind in('weekly','predecessor_cutoff') and state='confirmed' order by observed_at desc nulls last,id desc limit 1;
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
    select payload into v_before from public.team_workweek_publication_effects where google_event_id=v_prior.google_event_id and kind in('activation_remainder','predecessor_remainder') and state='confirmed' order by observed_at desc nulls last,id desc limit 1;
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

create or replace function public.create_private_monday_team_workweek_version(p_effective_from date,p_windows jsonb,p_base_publication_id uuid,p_base_publication_revision integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text; v_result jsonb;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  if not exists(select 1 from public.team_workweek_publications where id=p_base_publication_id and owner_profile_id=v_owner and status='published' and (effective_to is null or (coalesce(effective_at,effective_from::timestamp at time zone 'Europe/Berlin')<=clock_timestamp() and coalesce(effective_until,(effective_to+1)::timestamp at time zone 'Europe/Berlin','infinity'::timestamptz)>clock_timestamp())) and publication_revision=p_base_publication_revision) then
    raise exception using errcode='P0004',message='published workweek revision is stale';
  end if;
  v_result:=public.create_private_team_workweek_version(p_effective_from,p_windows);
  return v_result||(select jsonb_build_object('basePublicationId',base_publication_id,'basePublicationRevision',base_publication_revision) from public.team_workweek_versions where id=(v_result->>'id')::uuid and owner_profile_id=v_owner);
end; $$;
