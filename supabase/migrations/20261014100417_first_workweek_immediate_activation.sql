-- Legacy Monday dates retain their original meaning. Immediate dates remain recurrence anchors;
-- effective_at alone controls timestamped activation, with half-open bounds for future revisions.
alter table public.team_workweek_versions add column if not exists activation_mode text not null default 'future_monday'
  check (activation_mode in ('future_monday', 'immediate'));
alter table public.team_workweek_publications add column if not exists activation_mode text not null default 'future_monday'
  check (activation_mode in ('future_monday', 'immediate'));
alter table public.team_workweek_publications add column if not exists effective_at timestamptz;
alter table public.team_workweek_publications add column if not exists effective_until timestamptz;
alter table public.team_workweek_publications add column if not exists attempt_generation integer not null default 0;
alter table public.team_workweek_publications add constraint team_workweek_temporal_bounds
  check ((activation_mode = 'future_monday' or effective_at is not null)
    and (effective_until is null or effective_at is null or effective_until > effective_at));

-- Payloads and identities are immutable within a generation, including abandoned effects.
create table public.team_workweek_publication_effects (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.team_workweek_publications(id) on delete cascade,
  owner_profile_id text not null references public.profiles(id) on delete cascade,
  generation integer not null check (generation > 0),
  series_id uuid references public.team_workweek_google_series(id),
  kind text not null check (kind in ('weekly', 'activation_remainder')),
  google_event_id text not null unique check (char_length(google_event_id) between 5 and 1024 and google_event_id ~ '^[a-v0-9]+$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  state text not null default 'pending' check (state in ('pending', 'confirmed', 'cleaned')),
  confirmed_etag text,
  observed_at timestamptz,
  check (state <> 'confirmed' or (confirmed_etag is not null and observed_at is not null))
);
alter table public.team_workweek_publication_effects enable row level security;
create policy team_workweek_effects_owner_read on public.team_workweek_publication_effects
  for select to authenticated using (owner_profile_id = public.current_profile_id());
create policy workspace_request_boundary on public.team_workweek_publication_effects as restrictive
  for all to authenticated using ((select public.workspace_request_admitted())) with check ((select public.workspace_request_admitted()));
revoke all on public.team_workweek_publication_effects from public, anon, authenticated;
grant select on public.team_workweek_publication_effects to authenticated;
grant select, insert, update on public.team_workweek_publication_effects to service_role;
create index team_workweek_effects_publication_generation on public.team_workweek_publication_effects(publication_id,generation);

create or replace function public.create_private_immediate_team_workweek_version(
  p_windows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_owner_profile_id text;
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
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
  if exists (select 1 from public.team_workweek_publications where owner_profile_id = v_owner_profile_id and status = 'published') then
    raise exception using errcode = '22023', message = 'immediate first publication requires no published workweek';
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


alter function public.create_private_immediate_team_workweek_version(jsonb) owner to postgres;
revoke all on function public.create_private_immediate_team_workweek_version(jsonb) from public, anon, service_role;
grant execute on function public.create_private_immediate_team_workweek_version(jsonb) to authenticated;

-- The legacy path stays callable only behind the owner-checked dispatcher.
alter function public.prepare_team_workweek_publication(uuid) rename to prepare_monday_team_workweek_publication;
revoke all on function public.prepare_monday_team_workweek_publication(uuid) from public, anon, authenticated, service_role;
alter function public.finalize_team_workweek_publication(uuid) rename to finalize_monday_team_workweek_publication;
revoke all on function public.finalize_monday_team_workweek_publication(uuid) from public, anon, authenticated, service_role;

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
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id = auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_version from public.team_workweek_versions where id=p_version_id and owner_profile_id=v_owner for update;
  if not found then raise exception using errcode='P0002',message='private team workweek version not found'; end if;
  if v_version.activation_mode='future_monday' then return public.prepare_monday_team_workweek_publication(p_version_id); end if;
  select * into v_publication from public.team_workweek_publications where source_version_id=p_version_id and owner_profile_id=v_owner for update;
  if found and v_publication.status='published' then
    -- Lost finalize response: replay the committed generation even after its deadline.
    null;
  else
    if exists (select 1 from public.team_workweek_publications where owner_profile_id=v_owner and status='published') then
      raise exception using errcode='22023',message='immediate first publication requires no published workweek';
    end if;
    if v_publication.id is null then
      if exists (select 1 from public.team_workweek_publications where owner_profile_id=v_owner and status='preparing') then
        raise exception using errcode='P0003',message='another team workweek publication is still preparing';
      end if;
      insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,publication_revision,activation_mode,effective_at,attempt_generation)
      select v_version.id,v_owner,v_version.effective_from,
        coalesce(jsonb_agg(jsonb_build_object('weekday',weekday,'startMinute',start_minute,'endMinute',end_minute) order by weekday,start_minute),'[]'),
        (select coalesce(max(publication_revision),0)+1 from public.team_workweek_publications where owner_profile_id=v_owner),
        'immediate',date_trunc('minute',clock_timestamp())+interval '3 minutes',1
      from public.team_workweek_windows where version_id=v_version.id returning * into v_publication;
    elsif v_publication.effective_at <= clock_timestamp() and not exists (
      select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and state <> 'cleaned'
    ) then
      update public.team_workweek_publications set effective_at=date_trunc('minute',clock_timestamp())+interval '3 minutes',
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
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'calendarId','primary','googleEventId',google_event_id,'generation',generation,'payload',payload,'state',state,'confirmedEtag',confirmed_etag) order by kind,id),'[]')
    into v_effects from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation;
  return jsonb_build_object('id',v_publication.id,'sourceVersionId',v_version.id,'ownerProfileId',v_owner,'effectiveFrom',v_publication.effective_from,
    'activationMode','immediate','effectiveAt',v_publication.effective_at,'attemptGeneration',v_publication.attempt_generation,
    'timezone','Europe/Berlin','status',v_publication.status,'syncState',v_publication.sync_state,'publicationRevision',v_publication.publication_revision,
    'publishedAt',v_publication.published_at,'lastSyncAt',v_publication.last_sync_at,'series','[]'::jsonb,'transitions','[]'::jsonb,'effects',v_effects);
end; $$;
revoke all on function public.prepare_team_workweek_publication(uuid) from public,anon,service_role;
grant execute on function public.prepare_team_workweek_publication(uuid) to authenticated;

create or replace function public.confirm_team_workweek_effect(p_effect_id uuid,p_generation integer,p_etag text,p_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_effect public.team_workweek_publication_effects%rowtype; v_publication public.team_workweek_publications%rowtype;
begin
  select * into v_effect from public.team_workweek_publication_effects where id=p_effect_id;
  if not found then raise exception using errcode='P0002',message='effect not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_effect.owner_profile_id,0));
  select * into v_publication from public.team_workweek_publications where id=v_effect.publication_id for update;
  if v_publication.status<>'preparing' or v_publication.attempt_generation<>p_generation or v_effect.generation<>p_generation
    or v_effect.state='cleaned' or v_effect.payload<>p_payload or nullif(trim(p_etag),'') is null or clock_timestamp()>=v_publication.effective_at then
    raise exception using errcode='P0003',message='stale or expired projection confirmation';
  end if;
  update public.team_workweek_publication_effects set state='confirmed',confirmed_etag=p_etag,observed_at=clock_timestamp() where id=p_effect_id;
  if v_effect.series_id is not null then
    update public.team_workweek_google_series set state='confirmed',confirmed_etag=p_etag,confirmed_founderops_revision=v_publication.publication_revision,
      last_confirmed_at=clock_timestamp(),last_observed_at=clock_timestamp() where id=v_effect.series_id;
  end if;
end; $$;
revoke all on function public.confirm_team_workweek_effect(uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_team_workweek_effect(uuid,integer,text,jsonb) to service_role;

create or replace function public.confirm_team_workweek_effect_cleanup(p_effect_id uuid,p_generation integer)
returns void language plpgsql security definer set search_path=public as $$
declare v_effect public.team_workweek_publication_effects%rowtype; v_publication public.team_workweek_publications%rowtype;
begin
  select * into v_effect from public.team_workweek_publication_effects where id=p_effect_id;
  if not found then raise exception using errcode='P0002',message='effect not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_effect.owner_profile_id,0));
  select * into v_publication from public.team_workweek_publications where id=v_effect.publication_id for update;
  if v_publication.status<>'preparing' or v_publication.effective_at>clock_timestamp() or v_publication.attempt_generation<>p_generation or v_effect.generation<>p_generation then
    raise exception using errcode='P0003',message='active or committed projection cannot be cleaned';
  end if;
  update public.team_workweek_publication_effects set state='cleaned',observed_at=clock_timestamp() where id=p_effect_id;
end; $$;
revoke all on function public.confirm_team_workweek_effect_cleanup(uuid,integer) from public,anon,authenticated;
grant execute on function public.confirm_team_workweek_effect_cleanup(uuid,integer) to service_role;

create or replace function public.finalize_team_workweek_publication(p_publication_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_owner text; v_publication public.team_workweek_publications%rowtype;
begin
  select profile.id into v_owner from public.profiles as profile where profile.auth_user_id=auth.uid();
  if v_owner is null then raise exception using errcode='42501',message='mapped team profile required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner,0));
  select * into v_publication from public.team_workweek_publications where id=p_publication_id and owner_profile_id=v_owner for update;
  if not found then raise exception using errcode='P0002',message='team workweek publication not found'; end if;
  if v_publication.activation_mode='future_monday' then return public.finalize_monday_team_workweek_publication(p_publication_id); end if;
  if v_publication.status='preparing' then
    if clock_timestamp()>=v_publication.effective_at then raise exception using errcode='P0005',message='activation candidate expired'; end if;
    if exists(select 1 from public.team_workweek_publications where owner_profile_id=v_owner and status='published' and id<>v_publication.id) then
      raise exception using errcode='P0004',message='published workweek revision is stale';
    end if;
    if exists(select 1 from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and state<>'confirmed')
      or (select count(*) from public.team_workweek_publication_effects where publication_id=v_publication.id and generation=v_publication.attempt_generation and kind='weekly') <> jsonb_array_length(v_publication.windows) then
      raise exception using errcode='P0003',message='all projection effects must be confirmed';
    end if;
    update public.team_workweek_publications set status='published',sync_state='confirmed',published_at=clock_timestamp(),last_sync_at=clock_timestamp()
      where id=v_publication.id and effective_at>clock_timestamp() returning * into v_publication;
    if not found or clock_timestamp()>=v_publication.effective_at then
      raise exception using errcode='P0005',message='activation candidate expired';
    end if;
  elsif v_publication.status<>'published' then
    raise exception using errcode='P0004',message='publication is inactive';
  end if;
  return jsonb_build_object('id',v_publication.id,'status',v_publication.status,'syncState',v_publication.sync_state,
    'publishedAt',v_publication.published_at,'lastSyncAt',v_publication.last_sync_at,'publicationRevision',v_publication.publication_revision,
    'activationMode','immediate','effectiveAt',v_publication.effective_at);
end; $$;
revoke all on function public.finalize_team_workweek_publication(uuid) from public,anon,service_role;
grant execute on function public.finalize_team_workweek_publication(uuid) to authenticated;
