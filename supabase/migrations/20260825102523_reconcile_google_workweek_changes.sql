alter table public.team_workweek_versions
  add column origin text not null default 'owner',
  add column google_reconciliation_source_publication_id uuid references public.team_workweek_publications(id) on delete restrict,
  add column google_reconciliation_fingerprint text,
  add constraint team_workweek_versions_origin
    check (origin in ('owner', 'google_reconciliation')),
  add constraint team_workweek_versions_google_reconciliation_consistent
    check (
      (origin = 'owner' and google_reconciliation_source_publication_id is null and google_reconciliation_fingerprint is null)
      or (
        origin = 'google_reconciliation'
        and google_reconciliation_source_publication_id is not null
        and google_reconciliation_fingerprint ~ '^[0-9a-f]{64}$'
      )
    );

create unique index team_workweek_versions_google_reconciliation_unique
  on public.team_workweek_versions (google_reconciliation_source_publication_id, google_reconciliation_fingerprint)
  where origin = 'google_reconciliation';

create table public.team_workweek_google_reconciliation_status (
  publication_id uuid primary key references public.team_workweek_publications(id) on delete cascade,
  owner_profile_id text not null references public.profiles(id) on delete cascade,
  state text not null default 'confirmed',
  last_observed_at timestamptz,
  last_error_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_workweek_google_reconciliation_status_state
    check (state in ('confirmed', 'pending', 'delayed', 'conflict')),
  constraint team_workweek_google_reconciliation_status_error
    check (
      (state in ('confirmed', 'pending') and last_error_class is null)
      or (state in ('delayed', 'conflict') and last_error_class is not null)
    )
);

comment on table public.team_workweek_google_reconciliation_status is
  'Owner-private operational state for reconciliation of a known FounderOps workweek publication.';

alter table public.team_workweek_google_reconciliation_status enable row level security;

create policy team_workweek_google_reconciliation_status_select_owner_private
  on public.team_workweek_google_reconciliation_status
  for select
  to authenticated
  using (
    owner_profile_id = public.current_profile_id()
    and public.current_platform_role() in ('ceo', 'founder', 'deputy')
  );

revoke all on table public.team_workweek_google_reconciliation_status from public, anon, authenticated, service_role;
grant select on table public.team_workweek_google_reconciliation_status to authenticated;
grant select, insert, update on table public.team_workweek_google_reconciliation_status to service_role;

alter table public.team_workweek_google_series
  add column provider_state text not null default 'active',
  add column provider_deleted_at timestamptz,
  add constraint team_workweek_google_series_provider_state
    check (provider_state in ('active', 'deleted')),
  add constraint team_workweek_google_series_provider_deletion
    check (
      (provider_state = 'active' and provider_deleted_at is null)
      or (provider_state = 'deleted' and provider_deleted_at is not null)
    );

comment on column public.team_workweek_versions.origin is
  'Owner input or a validated Google-only reconciliation. Reconciliation metadata remains owner-private.';

comment on column public.team_workweek_google_series.provider_state is
  'Whether the known recurring master still exists at Google. Deleted masters are never recreated automatically.';

create or replace function public.guard_owner_team_workweek_version_against_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if new.origin = 'owner' then
    perform pg_advisory_xact_lock(hashtextextended(new.owner_profile_id, 0));
    if exists (
      select 1
      from public.team_workweek_publications
      where owner_profile_id = new.owner_profile_id
        and status = 'preparing'
    ) then
      raise exception using errcode = 'P0003', message = 'Google reconciliation is still preparing';
    end if;
  end if;
  return new;
end;
$$;

alter function public.guard_owner_team_workweek_version_against_reconciliation() owner to postgres;
revoke all on function public.guard_owner_team_workweek_version_against_reconciliation() from public, anon, authenticated, service_role;

create trigger guard_owner_team_workweek_version_against_reconciliation
before insert on public.team_workweek_versions
for each row execute function public.guard_owner_team_workweek_version_against_reconciliation();

create or replace function public.apply_google_team_workweek_observations(
  p_publication_id uuid,
  p_publication_revision integer,
  p_observations jsonb,
  p_observed_at timestamptz
) returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_observation jsonb;
  v_series_id uuid;
  v_prior_etag text;
  v_observed_etag text;
  v_founderops_revision integer;
  v_provider_state text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_observations is null or jsonb_typeof(p_observations) <> 'array' or p_observed_at is null then
    raise exception using errcode = '22023', message = 'Google workweek observations are invalid';
  end if;
  if jsonb_array_length(p_observations) <> (
    select count(*)
    from public.team_workweek_google_series as series
    where series.publication_id = p_publication_id
      and series.state = 'confirmed'
      and series.provider_state = 'active'
  ) then
    raise exception using errcode = 'P0004', message = 'Google workweek observation set is stale';
  end if;
  if (
    select count(distinct value->>'seriesId')
    from jsonb_array_elements(p_observations)
  ) <> jsonb_array_length(p_observations) then
    raise exception using errcode = '22023', message = 'Google workweek observations contain duplicate series';
  end if;

  for v_observation in select value from jsonb_array_elements(p_observations)
  loop
    if jsonb_typeof(v_observation) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(v_observation) as key
        where key not in ('seriesId', 'priorEtag', 'observedEtag', 'founderopsRevision', 'providerState')
      )
      or v_observation->>'seriesId' is null
      or nullif(btrim(v_observation->>'priorEtag'), '') is null
      or nullif(btrim(v_observation->>'observedEtag'), '') is null
      or v_observation->>'founderopsRevision' is null
      or v_observation->>'providerState' not in ('active', 'deleted') then
      raise exception using errcode = '22023', message = 'Google workweek observation contains unsupported fields';
    end if;

    begin
      v_series_id := (v_observation->>'seriesId')::uuid;
      v_prior_etag := btrim(v_observation->>'priorEtag');
      v_observed_etag := btrim(v_observation->>'observedEtag');
      v_founderops_revision := (v_observation->>'founderopsRevision')::integer;
      v_provider_state := v_observation->>'providerState';
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Google workweek observation contains invalid values';
    end;

    update public.team_workweek_google_series
    set confirmed_etag = v_observed_etag,
      provider_state = v_provider_state,
      provider_deleted_at = case when v_provider_state = 'deleted' then p_observed_at else null end,
      last_observed_at = p_observed_at,
      last_confirmed_at = p_observed_at,
      last_error_class = null,
      updated_at = p_observed_at
    where id = v_series_id
      and publication_id = p_publication_id
      and state = 'confirmed'
      and provider_state = 'active'
      and confirmed_etag = v_prior_etag
      and confirmed_founderops_revision = v_founderops_revision;

    if not found then
      raise exception using errcode = 'P0004', message = 'Google workweek series changed during reconciliation';
    end if;
  end loop;

  if not exists (
    select 1
    from public.team_workweek_publications as publication
    where publication.id = p_publication_id
      and publication.publication_revision = p_publication_revision
  ) then
    raise exception using errcode = 'P0004', message = 'FounderOps workweek changed during reconciliation';
  end if;
end;
$$;

alter function public.apply_google_team_workweek_observations(uuid, integer, jsonb, timestamptz) owner to postgres;
revoke all on function public.apply_google_team_workweek_observations(uuid, integer, jsonb, timestamptz) from public, anon, authenticated, service_role;

create or replace function public.confirm_google_team_workweek_observation(
  p_publication_id uuid,
  p_publication_revision integer,
  p_observations jsonb,
  p_observed_at timestamptz default clock_timestamp()
) returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_publication public.team_workweek_publications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  select * into v_publication
  from public.team_workweek_publications
  where id = p_publication_id
    and publication_revision = p_publication_revision
    and status = 'published'
    and effective_to is null
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'FounderOps workweek changed during reconciliation';
  end if;

  perform public.apply_google_team_workweek_observations(
    p_publication_id,
    p_publication_revision,
    p_observations,
    p_observed_at
  );

  insert into public.team_workweek_google_reconciliation_status (
    publication_id,
    owner_profile_id,
    state,
    last_observed_at,
    last_error_class,
    updated_at
  ) values (
    v_publication.id,
    v_publication.owner_profile_id,
    'confirmed',
    p_observed_at,
    null,
    p_observed_at
  )
  on conflict (publication_id) do update
  set owner_profile_id = excluded.owner_profile_id,
    state = excluded.state,
    last_observed_at = excluded.last_observed_at,
    last_error_class = excluded.last_error_class,
    updated_at = excluded.updated_at;

  update public.team_workweek_publications
  set last_sync_at = p_observed_at
  where id = p_publication_id;
end;
$$;

alter function public.confirm_google_team_workweek_observation(uuid, integer, jsonb, timestamptz) owner to postgres;
revoke all on function public.confirm_google_team_workweek_observation(uuid, integer, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_google_team_workweek_observation(uuid, integer, jsonb, timestamptz) to service_role;

create or replace function public.prepare_google_team_workweek_reconciliation(
  p_owner_profile_id text,
  p_source_publication_id uuid,
  p_source_publication_revision integer,
  p_effective_from date,
  p_observations jsonb,
  p_windows jsonb,
  p_fingerprint text,
  p_observed_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_source public.team_workweek_publications%rowtype;
  v_existing public.team_workweek_versions%rowtype;
  v_target_version_id uuid;
  v_target_publication_id uuid;
  v_revision integer;
  v_recurrence_count integer;
  v_window jsonb;
  v_weekday smallint;
  v_start_minute smallint;
  v_end_minute smallint;
  v_today date;
  v_next_monday date;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if nullif(btrim(p_owner_profile_id), '') is null
    or p_source_publication_revision < 1
    or p_observed_at is null
    or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Google workweek reconciliation identity is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));

  select * into v_existing
  from public.team_workweek_versions
  where google_reconciliation_source_publication_id = p_source_publication_id
    and google_reconciliation_fingerprint = p_fingerprint
  for update;

  if found then
    return jsonb_build_object(
      'versionId', v_existing.id,
      'effectiveFrom', v_existing.effective_from,
      'replayed', true
    );
  end if;

  select * into v_source
  from public.team_workweek_publications
  where id = p_source_publication_id
    and owner_profile_id = p_owner_profile_id
    and publication_revision = p_source_publication_revision
    and status = 'published'
    and effective_to is null
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'FounderOps workweek changed during reconciliation';
  end if;
  if exists (
    select 1
    from public.team_workweek_publications
    where owner_profile_id = p_owner_profile_id and status = 'preparing'
  ) then
    raise exception using errcode = 'P0003', message = 'another team workweek publication is still preparing';
  end if;
  if exists (
    select 1
    from public.team_workweek_versions as version
    where version.owner_profile_id = p_owner_profile_id
      and version.status = 'preparing'
      and version.origin = 'owner'
      and version.effective_from > v_source.effective_from
      and not exists (
        select 1
        from public.team_workweek_publications as publication
        where publication.source_version_id = version.id
      )
  ) then
    raise exception using errcode = 'P0003', message = 'an owner workweek draft is already preparing';
  end if;

  v_today := (p_observed_at at time zone 'Europe/Berlin')::date;
  v_next_monday := v_today + case
    when extract(isodow from v_today)::integer = 1 then 7
    else 8 - extract(isodow from v_today)::integer
  end;
  if p_effective_from is null
    or extract(isodow from p_effective_from)::integer <> 1
    or p_effective_from < v_next_monday
    or p_effective_from <= v_source.effective_from then
    raise exception using errcode = '22023', message = 'Google reconciliation must start at a future Monday';
  end if;
  if p_windows is null
    or jsonb_typeof(p_windows) <> 'array'
    or jsonb_array_length(p_windows) > 84
    or p_windows = v_source.windows then
    raise exception using errcode = '22023', message = 'Google reconciliation windows are invalid or unchanged';
  end if;

  perform public.apply_google_team_workweek_observations(
    p_source_publication_id,
    p_source_publication_revision,
    p_observations,
    p_observed_at
  );

  insert into public.team_workweek_versions (
    owner_profile_id,
    effective_from,
    origin,
    google_reconciliation_source_publication_id,
    google_reconciliation_fingerprint
  ) values (
    p_owner_profile_id,
    p_effective_from,
    'google_reconciliation',
    p_source_publication_id,
    p_fingerprint
  ) returning id into v_target_version_id;

  for v_window in select value from jsonb_array_elements(p_windows)
  loop
    if jsonb_typeof(v_window) <> 'object'
      or exists (
        select 1 from jsonb_object_keys(v_window) as key
        where key not in ('weekday', 'startMinute', 'endMinute')
      )
      or v_window->>'weekday' is null
      or v_window->>'startMinute' is null
      or v_window->>'endMinute' is null then
      raise exception using errcode = '22023', message = 'Google reconciliation window contains unsupported fields';
    end if;
    begin
      v_weekday := (v_window->>'weekday')::smallint;
      v_start_minute := (v_window->>'startMinute')::smallint;
      v_end_minute := (v_window->>'endMinute')::smallint;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'Google reconciliation window contains invalid values';
    end;
    if v_weekday not between 1 and 7
      or v_start_minute not between 0 and 1438
      or v_end_minute not between 1 and 1439
      or v_start_minute >= v_end_minute
      or (
        select count(*) from public.team_workweek_windows
        where version_id = v_target_version_id and weekday = v_weekday
      ) >= 12
      or exists (
        select 1 from public.team_workweek_windows
        where version_id = v_target_version_id
          and weekday = v_weekday
          and v_start_minute < end_minute
          and v_end_minute > start_minute
      ) then
      raise exception using errcode = '22023', message = 'Google reconciliation windows overlap or are invalid';
    end if;
    insert into public.team_workweek_windows (version_id, weekday, start_minute, end_minute)
    values (v_target_version_id, v_weekday, v_start_minute, v_end_minute);
  end loop;

  select coalesce(max(publication_revision), 0) + 1
  into v_revision
  from public.team_workweek_publications
  where owner_profile_id = p_owner_profile_id;

  insert into public.team_workweek_publications (
    source_version_id,
    owner_profile_id,
    effective_from,
    timezone,
    windows,
    publication_revision,
    predecessor_publication_id
  ) values (
    v_target_version_id,
    p_owner_profile_id,
    p_effective_from,
    'Europe/Berlin',
    p_windows,
    v_revision,
    p_source_publication_id
  ) returning id into v_target_publication_id;

  v_recurrence_count := (p_effective_from - v_source.effective_from) / 7;
  insert into public.team_workweek_google_series_transitions (
    activation_publication_id,
    predecessor_series_id,
    owner_profile_id,
    expected_etag,
    expected_founderops_revision,
    recurrence_count,
    state,
    confirmed_etag,
    last_observed_at,
    last_confirmed_at,
    created_at,
    updated_at
  )
  select
    v_target_publication_id,
    series.id,
    p_owner_profile_id,
    series.confirmed_etag,
    series.confirmed_founderops_revision,
    v_recurrence_count,
    'confirmed',
    series.confirmed_etag,
    p_observed_at,
    p_observed_at,
    p_observed_at,
    p_observed_at
  from public.team_workweek_google_series as series
  where series.publication_id = p_source_publication_id
    and series.state = 'confirmed'
    and series.provider_state = 'deleted';

  insert into public.team_workweek_google_reconciliation_status (
    publication_id,
    owner_profile_id,
    state,
    last_observed_at,
    last_error_class,
    updated_at
  ) values (
    p_source_publication_id,
    p_owner_profile_id,
    'pending',
    p_observed_at,
    null,
    p_observed_at
  )
  on conflict (publication_id) do update
  set owner_profile_id = excluded.owner_profile_id,
    state = excluded.state,
    last_observed_at = excluded.last_observed_at,
    last_error_class = excluded.last_error_class,
    updated_at = excluded.updated_at;

  return jsonb_build_object(
    'versionId', v_target_version_id,
    'effectiveFrom', p_effective_from,
    'replayed', false
  );
end;
$$;

alter function public.prepare_google_team_workweek_reconciliation(text, uuid, integer, date, jsonb, jsonb, text, timestamptz) owner to postgres;
revoke all on function public.prepare_google_team_workweek_reconciliation(text, uuid, integer, date, jsonb, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.prepare_google_team_workweek_reconciliation(text, uuid, integer, date, jsonb, jsonb, text, timestamptz) to service_role;

create or replace function public.record_google_team_workweek_reconciliation_state(
  p_publication_id uuid,
  p_publication_revision integer,
  p_state text,
  p_error_class text,
  p_observed_at timestamptz default clock_timestamp()
) returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_publication public.team_workweek_publications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_state not in ('confirmed', 'delayed', 'conflict')
    or (p_state = 'confirmed' and p_error_class is not null)
    or (
      p_state in ('delayed', 'conflict')
      and p_error_class not in (
        'provider_unavailable',
        'quota_exceeded',
        'oauth_reconnect_required',
        'provider_identity_mismatch',
        'invalid_series',
        'invalid_windows',
        'founderops_changed',
        'storage_failed'
      )
    )
    or p_observed_at is null then
    raise exception using errcode = '22023', message = 'Google reconciliation state is invalid';
  end if;

  select * into v_publication
  from public.team_workweek_publications
  where id = p_publication_id
    and publication_revision = p_publication_revision
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'FounderOps workweek changed during reconciliation';
  end if;

  insert into public.team_workweek_google_reconciliation_status (
    publication_id,
    owner_profile_id,
    state,
    last_observed_at,
    last_error_class,
    updated_at
  ) values (
    v_publication.id,
    v_publication.owner_profile_id,
    p_state,
    p_observed_at,
    p_error_class,
    p_observed_at
  )
  on conflict (publication_id) do update
  set owner_profile_id = excluded.owner_profile_id,
    state = excluded.state,
    last_observed_at = excluded.last_observed_at,
    last_error_class = excluded.last_error_class,
    updated_at = excluded.updated_at;
end;
$$;

alter function public.record_google_team_workweek_reconciliation_state(uuid, integer, text, text, timestamptz) owner to postgres;
revoke all on function public.record_google_team_workweek_reconciliation_state(uuid, integer, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_google_team_workweek_reconciliation_state(uuid, integer, text, text, timestamptz) to service_role;
