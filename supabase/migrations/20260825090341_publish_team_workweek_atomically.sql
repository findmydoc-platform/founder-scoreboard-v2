create table public.team_workweek_publications (
  id uuid primary key default gen_random_uuid(),
  source_version_id uuid not null unique references public.team_workweek_versions(id) on delete restrict,
  owner_profile_id text not null references public.profiles(id) on delete cascade,
  effective_from date not null,
  timezone text not null default 'Europe/Berlin',
  windows jsonb not null,
  status text not null default 'preparing',
  publication_revision integer not null default 1,
  publication_requested_at timestamptz not null default now(),
  published_at timestamptz,
  last_sync_at timestamptz,
  sync_state text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint team_workweek_publications_monday_start check (extract(isodow from effective_from) = 1),
  constraint team_workweek_publications_timezone_fixed check (timezone = 'Europe/Berlin'),
  constraint team_workweek_publications_windows check (jsonb_typeof(windows) = 'array' and jsonb_array_length(windows) <= 84),
  constraint team_workweek_publications_status check (status in ('preparing', 'published')),
  constraint team_workweek_publications_revision_positive check (publication_revision > 0),
  constraint team_workweek_publications_sync_state check (sync_state in ('pending', 'delayed', 'confirmed')),
  constraint team_workweek_publications_consistent check (
    (status = 'preparing' and published_at is null and sync_state in ('pending', 'delayed'))
    or (status = 'published' and published_at is not null and sync_state = 'confirmed')
  )
);

create table public.team_workweek_google_series (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references public.team_workweek_publications(id) on delete cascade,
  source_window_id bigint not null unique references public.team_workweek_windows(id) on delete restrict,
  owner_profile_id text not null references public.profiles(id) on delete cascade,
  calendar_id text not null default 'primary',
  google_event_id text not null,
  private_property_key text not null default 'founderopsWorkweekSeriesId',
  state text not null default 'pending',
  confirmed_etag text,
  confirmed_founderops_revision integer,
  last_observed_at timestamptz,
  last_confirmed_at timestamptz,
  last_error_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_workweek_google_series_calendar check (calendar_id = 'primary'),
  constraint team_workweek_google_series_event_id check (char_length(google_event_id) between 5 and 1024 and google_event_id ~ '^[a-v0-9]+$'),
  constraint team_workweek_google_series_property_key check (private_property_key = 'founderopsWorkweekSeriesId'),
  constraint team_workweek_google_series_state check (state in ('pending', 'confirmed')),
  constraint team_workweek_google_series_confirmation check (
    (state = 'pending' and confirmed_etag is null and confirmed_founderops_revision is null and last_confirmed_at is null)
    or (state = 'confirmed' and confirmed_etag is not null and confirmed_founderops_revision is not null and last_confirmed_at is not null)
  ),
  unique (calendar_id, google_event_id)
);

create index team_workweek_publications_owner_effective_idx
  on public.team_workweek_publications (owner_profile_id, effective_from desc, publication_revision desc, id desc);

create index team_workweek_google_series_publication_idx
  on public.team_workweek_google_series (publication_id, state, id);

comment on table public.team_workweek_publications is
  'Immutable team-visible projections of private workweek versions. Preparing rows remain owner-private; confirmed rows are readable by mapped team members.';

comment on table public.team_workweek_google_series is
  'Owner-private durable Google projection identities. Team read models never expose provider identifiers.';

alter table public.team_workweek_publications enable row level security;
alter table public.team_workweek_google_series enable row level security;

create policy team_workweek_publications_select_owner_or_published_team
  on public.team_workweek_publications
  for select
  to authenticated
  using (
    (owner_profile_id = public.current_profile_id() and public.current_platform_role() in ('ceo', 'founder', 'deputy'))
    or (status = 'published' and public.current_profile_id() is not null)
  );

create policy team_workweek_google_series_select_owner_private
  on public.team_workweek_google_series
  for select
  to authenticated
  using (
    owner_profile_id = public.current_profile_id()
    and public.current_platform_role() in ('ceo', 'founder', 'deputy')
  );

revoke all on table public.team_workweek_publications from public, anon, authenticated, service_role;
revoke all on table public.team_workweek_google_series from public, anon, authenticated, service_role;
grant select on table public.team_workweek_publications to authenticated;
grant select on table public.team_workweek_google_series to authenticated;
grant select on table public.team_workweek_publications to service_role;
grant select, update on table public.team_workweek_google_series to service_role;

create or replace function public.prepare_team_workweek_publication(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_owner_profile_id text;
  v_owner_role text;
  v_version public.team_workweek_versions%rowtype;
  v_publication public.team_workweek_publications%rowtype;
  v_window record;
  v_series_id uuid;
  v_windows jsonb;
  v_series jsonb;
begin
  select profile.id, profile.platform_role
  into v_owner_profile_id, v_owner_role
  from public.profiles as profile
  where profile.auth_user_id = auth.uid();

  if not found or v_owner_profile_id is null or v_owner_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = '42501', message = 'planning contributor profile required';
  end if;

  select * into v_version
  from public.team_workweek_versions
  where id = p_version_id and owner_profile_id = v_owner_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'private team workweek version not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'weekday', work_window.weekday,
    'startMinute', work_window.start_minute,
    'endMinute', work_window.end_minute
  ) order by work_window.weekday, work_window.start_minute, work_window.end_minute, work_window.id), '[]'::jsonb)
  into v_windows
  from public.team_workweek_windows as work_window
  where work_window.version_id = v_version.id;

  insert into public.team_workweek_publications (
    source_version_id,
    owner_profile_id,
    effective_from,
    timezone,
    windows
  ) values (
    v_version.id,
    v_owner_profile_id,
    v_version.effective_from,
    v_version.timezone,
    v_windows
  )
  on conflict (source_version_id) do nothing;

  select * into v_publication
  from public.team_workweek_publications
  where source_version_id = v_version.id and owner_profile_id = v_owner_profile_id
  for update;

  for v_window in
    select work_window.id
    from public.team_workweek_windows as work_window
    where work_window.version_id = v_version.id
    order by work_window.weekday, work_window.start_minute, work_window.end_minute, work_window.id
  loop
    v_series_id := gen_random_uuid();
    insert into public.team_workweek_google_series (
      id,
      publication_id,
      source_window_id,
      owner_profile_id,
      google_event_id
    ) values (
      v_series_id,
      v_publication.id,
      v_window.id,
      v_owner_profile_id,
      'fops' || replace(v_series_id::text, '-', '')
    )
    on conflict (source_window_id) do nothing;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', series.id,
    'calendarId', series.calendar_id,
    'googleEventId', series.google_event_id,
    'state', series.state,
    'confirmedEtag', series.confirmed_etag,
    'weekday', work_window.weekday,
    'startMinute', work_window.start_minute,
    'endMinute', work_window.end_minute
  ) order by work_window.weekday, work_window.start_minute, work_window.end_minute, series.id), '[]'::jsonb)
  into v_series
  from public.team_workweek_google_series as series
  join public.team_workweek_windows as work_window on work_window.id = series.source_window_id
  where series.publication_id = v_publication.id;

  return jsonb_build_object(
    'id', v_publication.id,
    'sourceVersionId', v_publication.source_version_id,
    'ownerProfileId', v_owner_profile_id,
    'effectiveFrom', v_publication.effective_from,
    'timezone', v_publication.timezone,
    'status', v_publication.status,
    'syncState', v_publication.sync_state,
    'publicationRevision', v_publication.publication_revision,
    'publishedAt', v_publication.published_at,
    'lastSyncAt', v_publication.last_sync_at,
    'series', v_series
  );
end;
$$;

alter function public.prepare_team_workweek_publication(uuid) owner to postgres;
revoke all on function public.prepare_team_workweek_publication(uuid) from public, anon, service_role;
grant execute on function public.prepare_team_workweek_publication(uuid) to authenticated;

create or replace function public.confirm_team_workweek_google_series(
  p_series_id uuid,
  p_etag text,
  p_founderops_revision integer,
  p_observed_at timestamptz default clock_timestamp()
) returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if nullif(btrim(p_etag), '') is null or p_founderops_revision < 1 or p_observed_at is null then
    raise exception using errcode = '22023', message = 'confirmed Google series metadata is invalid';
  end if;

  update public.team_workweek_google_series as series
  set state = 'confirmed',
    confirmed_etag = btrim(p_etag),
    confirmed_founderops_revision = p_founderops_revision,
    last_observed_at = p_observed_at,
    last_confirmed_at = p_observed_at,
    last_error_class = null,
    updated_at = p_observed_at
  from public.team_workweek_publications as publication
  where series.id = p_series_id
    and publication.id = series.publication_id
    and publication.publication_revision = p_founderops_revision;

  if not found then
    raise exception using errcode = '22023', message = 'Google series projection revision is invalid';
  end if;
end;
$$;

alter function public.confirm_team_workweek_google_series(uuid, text, integer, timestamptz) owner to postgres;
revoke all on function public.confirm_team_workweek_google_series(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_team_workweek_google_series(uuid, text, integer, timestamptz) to service_role;

create or replace function public.delay_team_workweek_publication(
  p_publication_id uuid,
  p_error_class text,
  p_observed_at timestamptz default clock_timestamp()
) returns jsonb
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
  if p_error_class not in ('provider_unavailable', 'provider_identity_mismatch', 'oauth_reconnect_required', 'storage_failed') then
    raise exception using errcode = '22023', message = 'publication error class is invalid';
  end if;

  select * into v_publication
  from public.team_workweek_publications
  where id = p_publication_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'team workweek publication not found';
  end if;

  if v_publication.status = 'preparing' then
    update public.team_workweek_publications
    set sync_state = 'delayed'
    where id = p_publication_id
    returning * into v_publication;

    update public.team_workweek_google_series
    set last_observed_at = p_observed_at,
      last_error_class = p_error_class,
      updated_at = p_observed_at
    where publication_id = p_publication_id and state = 'pending';
  end if;

  return jsonb_build_object(
    'id', v_publication.id,
    'status', v_publication.status,
    'syncState', v_publication.sync_state,
    'publishedAt', v_publication.published_at,
    'lastSyncAt', v_publication.last_sync_at,
    'publicationRevision', v_publication.publication_revision
  );
end;
$$;

alter function public.delay_team_workweek_publication(uuid, text, timestamptz) owner to postgres;
revoke all on function public.delay_team_workweek_publication(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.delay_team_workweek_publication(uuid, text, timestamptz) to service_role;

create or replace function public.finalize_team_workweek_publication(p_publication_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_owner_profile_id text;
  v_owner_role text;
  v_publication public.team_workweek_publications%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select profile.id, profile.platform_role
  into v_owner_profile_id, v_owner_role
  from public.profiles as profile
  where profile.auth_user_id = auth.uid();

  if not found or v_owner_profile_id is null or v_owner_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = '42501', message = 'planning contributor profile required';
  end if;

  select * into v_publication
  from public.team_workweek_publications
  where id = p_publication_id and owner_profile_id = v_owner_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'team workweek publication not found';
  end if;
  if v_publication.status = 'published' then
    return jsonb_build_object(
      'id', v_publication.id,
      'status', v_publication.status,
      'syncState', v_publication.sync_state,
      'publishedAt', v_publication.published_at,
      'lastSyncAt', v_publication.last_sync_at,
      'publicationRevision', v_publication.publication_revision
    );
  end if;
  if exists (
    select 1 from public.team_workweek_google_series
    where publication_id = v_publication.id and state <> 'confirmed'
  ) or (
    select count(*) from public.team_workweek_google_series where publication_id = v_publication.id
  ) <> jsonb_array_length(v_publication.windows) then
    raise exception using errcode = 'P0003', message = 'all Google series must be confirmed before team publication';
  end if;

  update public.team_workweek_publications
  set status = 'published', sync_state = 'confirmed', published_at = v_now, last_sync_at = v_now
  where id = v_publication.id
  returning * into v_publication;

  return jsonb_build_object(
    'id', v_publication.id,
    'status', v_publication.status,
    'syncState', v_publication.sync_state,
    'publishedAt', v_publication.published_at,
    'lastSyncAt', v_publication.last_sync_at,
    'publicationRevision', v_publication.publication_revision
  );
end;
$$;

alter function public.finalize_team_workweek_publication(uuid) owner to postgres;
revoke all on function public.finalize_team_workweek_publication(uuid) from public, anon, service_role;
grant execute on function public.finalize_team_workweek_publication(uuid) to authenticated;
