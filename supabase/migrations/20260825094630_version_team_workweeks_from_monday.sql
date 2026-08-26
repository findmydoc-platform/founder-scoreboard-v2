alter table public.team_workweek_publications
  add column effective_to date,
  add column predecessor_publication_id uuid references public.team_workweek_publications(id) on delete restrict,
  add column superseded_by_publication_id uuid references public.team_workweek_publications(id) on delete restrict,
  add constraint team_workweek_publications_effective_range
    check (effective_to is null or effective_to >= effective_from - 1),
  add constraint team_workweek_publications_predecessor_distinct
    check (predecessor_publication_id is null or predecessor_publication_id <> id),
  add constraint team_workweek_publications_supersession_consistent
    check ((effective_to is null) = (superseded_by_publication_id is null));

with ranked as (
  select publication.id,
    row_number() over (
      partition by publication.owner_profile_id
      order by publication.effective_from, publication.publication_requested_at, publication.id
    ) as revision
  from public.team_workweek_publications as publication
)
update public.team_workweek_publications as publication
set publication_revision = ranked.revision
from ranked
where ranked.id = publication.id;

with ordered_published as (
  select publication.id,
    lag(publication.id) over (
      partition by publication.owner_profile_id
      order by publication.effective_from, publication.publication_requested_at, publication.id
    ) as predecessor_id,
    lead(publication.id) over (
      partition by publication.owner_profile_id
      order by publication.effective_from, publication.publication_requested_at, publication.id
    ) as successor_id,
    lead(publication.effective_from) over (
      partition by publication.owner_profile_id
      order by publication.effective_from, publication.publication_requested_at, publication.id
    ) as successor_effective_from
  from public.team_workweek_publications as publication
  where publication.status = 'published'
)
update public.team_workweek_publications as publication
set predecessor_publication_id = ordered_published.predecessor_id,
  effective_to = case when ordered_published.successor_id is null then null else ordered_published.successor_effective_from - 1 end,
  superseded_by_publication_id = ordered_published.successor_id
from ordered_published
where ordered_published.id = publication.id;

update public.team_workweek_publications as publication
set predecessor_publication_id = (
  select candidate.id
  from public.team_workweek_publications as candidate
  where candidate.owner_profile_id = publication.owner_profile_id
    and candidate.status = 'published'
    and (candidate.effective_from, candidate.publication_requested_at, candidate.id)
      < (publication.effective_from, publication.publication_requested_at, publication.id)
  order by candidate.effective_from desc, candidate.publication_requested_at desc, candidate.id desc
  limit 1
)
where publication.status = 'preparing';

create unique index team_workweek_publications_owner_revision_unique
  on public.team_workweek_publications (owner_profile_id, publication_revision);

create table public.team_workweek_google_series_transitions (
  id uuid primary key default gen_random_uuid(),
  activation_publication_id uuid not null references public.team_workweek_publications(id) on delete cascade,
  predecessor_series_id uuid not null references public.team_workweek_google_series(id) on delete restrict,
  owner_profile_id text not null references public.profiles(id) on delete cascade,
  expected_etag text not null,
  expected_founderops_revision integer not null,
  recurrence_count integer not null,
  state text not null default 'pending',
  confirmed_etag text,
  last_observed_at timestamptz,
  last_confirmed_at timestamptz,
  last_error_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_workweek_google_series_transitions_revision_positive
    check (expected_founderops_revision > 0),
  constraint team_workweek_google_series_transitions_recurrence_positive
    check (recurrence_count > 0),
  constraint team_workweek_google_series_transitions_state
    check (state in ('pending', 'confirmed')),
  constraint team_workweek_google_series_transitions_confirmation
    check (
      (state = 'pending' and confirmed_etag is null and last_confirmed_at is null)
      or (state = 'confirmed' and confirmed_etag is not null and last_confirmed_at is not null)
    ),
  unique (activation_publication_id, predecessor_series_id)
);

create index team_workweek_google_series_transitions_activation_idx
  on public.team_workweek_google_series_transitions (activation_publication_id, state, id);

comment on table public.team_workweek_google_series_transitions is
  'Owner-private, replay-safe updates that end predecessor Google series at a later Monday boundary without changing past occurrences.';

alter table public.team_workweek_google_series_transitions enable row level security;

create policy team_workweek_google_series_transitions_select_owner_private
  on public.team_workweek_google_series_transitions
  for select
  to authenticated
  using (
    owner_profile_id = public.current_profile_id()
    and public.current_platform_role() in ('ceo', 'founder', 'deputy')
  );

revoke all on table public.team_workweek_google_series_transitions from public, anon, authenticated, service_role;
grant select on table public.team_workweek_google_series_transitions to authenticated;
grant select, update on table public.team_workweek_google_series_transitions to service_role;

create or replace function public.enforce_team_workweek_version_boundary()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_latest_effective_from date;
begin
  select max(publication.effective_from)
  into v_latest_effective_from
  from public.team_workweek_publications as publication
  where publication.owner_profile_id = new.owner_profile_id
    and publication.status = 'published';

  if v_latest_effective_from is not null and new.effective_from <= v_latest_effective_from then
    raise exception using errcode = '22023', message = 'new workweek version must start after the latest published boundary';
  end if;

  return new;
end;
$$;

alter function public.enforce_team_workweek_version_boundary() owner to postgres;
revoke all on function public.enforce_team_workweek_version_boundary() from public, anon, authenticated, service_role;

create trigger enforce_team_workweek_version_boundary
before insert on public.team_workweek_versions
for each row execute function public.enforce_team_workweek_version_boundary();

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
  v_predecessor public.team_workweek_publications%rowtype;
  v_window record;
  v_series_id uuid;
  v_windows jsonb;
  v_series jsonb;
  v_transitions jsonb;
  v_revision integer;
  v_recurrence_count integer;
begin
  select profile.id, profile.platform_role
  into v_owner_profile_id, v_owner_role
  from public.profiles as profile
  where profile.auth_user_id = auth.uid();

  if not found or v_owner_profile_id is null or v_owner_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = '42501', message = 'planning contributor profile required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner_profile_id, 0));

  select * into v_version
  from public.team_workweek_versions
  where id = p_version_id and owner_profile_id = v_owner_profile_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'private team workweek version not found';
  end if;

  select * into v_publication
  from public.team_workweek_publications
  where source_version_id = v_version.id and owner_profile_id = v_owner_profile_id
  for update;

  if not found then
    if exists (
      select 1
      from public.team_workweek_publications
      where owner_profile_id = v_owner_profile_id and status = 'preparing'
    ) then
      raise exception using errcode = 'P0003', message = 'another team workweek publication is still preparing';
    end if;

    select * into v_predecessor
    from public.team_workweek_publications
    where owner_profile_id = v_owner_profile_id and status = 'published'
    order by effective_from desc, publication_revision desc, id desc
    limit 1
    for update;

    if found and v_version.effective_from <= v_predecessor.effective_from then
      raise exception using errcode = '22023', message = 'effective boundary must follow latest published workweek';
    end if;

    select coalesce(max(publication.publication_revision), 0) + 1
    into v_revision
    from public.team_workweek_publications as publication
    where publication.owner_profile_id = v_owner_profile_id;

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
      windows,
      publication_revision,
      predecessor_publication_id
    ) values (
      v_version.id,
      v_owner_profile_id,
      v_version.effective_from,
      v_version.timezone,
      v_windows,
      v_revision,
      v_predecessor.id
    )
    returning * into v_publication;

  end if;

  if v_publication.predecessor_publication_id is not null then
    select * into v_predecessor
    from public.team_workweek_publications
    where id = v_publication.predecessor_publication_id
      and owner_profile_id = v_owner_profile_id
      and status = 'published'
    for update;

    if not found then
      raise exception using errcode = 'P0004', message = 'published workweek revision is stale';
    end if;
    if v_publication.effective_from <= v_predecessor.effective_from then
      raise exception using errcode = '22023', message = 'effective boundary must follow latest published workweek';
    end if;

    v_recurrence_count := (v_publication.effective_from - v_predecessor.effective_from) / 7;

    insert into public.team_workweek_google_series_transitions (
      activation_publication_id,
      predecessor_series_id,
      owner_profile_id,
      expected_etag,
      expected_founderops_revision,
      recurrence_count
    )
    select
      v_publication.id,
      series.id,
      v_owner_profile_id,
      series.confirmed_etag,
      series.confirmed_founderops_revision,
      v_recurrence_count
    from public.team_workweek_google_series as series
    where series.publication_id = v_predecessor.id
      and series.state = 'confirmed'
    on conflict (activation_publication_id, predecessor_series_id) do nothing;

    if (select count(*) from public.team_workweek_google_series_transitions where activation_publication_id = v_publication.id)
      <> jsonb_array_length(v_predecessor.windows) then
      raise exception using errcode = 'P0003', message = 'predecessor Google series are not fully confirmed';
    end if;
  end if;

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

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', transition.id,
    'calendarId', predecessor_series.calendar_id,
    'googleEventId', predecessor_series.google_event_id,
    'predecessorSeriesId', predecessor_series.id,
    'state', transition.state,
    'expectedEtag', transition.expected_etag,
    'expectedFounderopsRevision', transition.expected_founderops_revision,
    'recurrenceCount', transition.recurrence_count,
    'confirmedEtag', transition.confirmed_etag
  ) order by predecessor_series.google_event_id, transition.id), '[]'::jsonb)
  into v_transitions
  from public.team_workweek_google_series_transitions as transition
  join public.team_workweek_google_series as predecessor_series on predecessor_series.id = transition.predecessor_series_id
  where transition.activation_publication_id = v_publication.id;

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
    'series', v_series,
    'transitions', v_transitions
  );
end;
$$;

alter function public.prepare_team_workweek_publication(uuid) owner to postgres;
revoke all on function public.prepare_team_workweek_publication(uuid) from public, anon, service_role;
grant execute on function public.prepare_team_workweek_publication(uuid) to authenticated;

create or replace function public.confirm_team_workweek_google_series_transition(
  p_transition_id uuid,
  p_etag text,
  p_expected_founderops_revision integer,
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
  if nullif(btrim(p_etag), '') is null or p_expected_founderops_revision < 1 or p_observed_at is null then
    raise exception using errcode = '22023', message = 'confirmed Google series transition metadata is invalid';
  end if;

  update public.team_workweek_google_series_transitions
  set state = 'confirmed',
    confirmed_etag = btrim(p_etag),
    last_observed_at = p_observed_at,
    last_confirmed_at = p_observed_at,
    last_error_class = null,
    updated_at = p_observed_at
  where id = p_transition_id
    and expected_founderops_revision = p_expected_founderops_revision;

  if not found then
    raise exception using errcode = '22023', message = 'Google series transition revision is invalid';
  end if;
end;
$$;

alter function public.confirm_team_workweek_google_series_transition(uuid, text, integer, timestamptz) owner to postgres;
revoke all on function public.confirm_team_workweek_google_series_transition(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_team_workweek_google_series_transition(uuid, text, integer, timestamptz) to service_role;

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

    update public.team_workweek_google_series_transitions
    set last_observed_at = p_observed_at,
      last_error_class = p_error_class,
      updated_at = p_observed_at
    where activation_publication_id = p_publication_id and state = 'pending';
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
  v_predecessor public.team_workweek_publications%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select profile.id, profile.platform_role
  into v_owner_profile_id, v_owner_role
  from public.profiles as profile
  where profile.auth_user_id = auth.uid();

  if not found or v_owner_profile_id is null or v_owner_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = '42501', message = 'planning contributor profile required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_owner_profile_id, 0));

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
  if exists (
    select 1 from public.team_workweek_google_series_transitions
    where activation_publication_id = v_publication.id and state <> 'confirmed'
  ) then
    raise exception using errcode = 'P0003', message = 'all predecessor Google series transitions must be confirmed before team publication';
  end if;

  if v_publication.predecessor_publication_id is not null then
    select * into v_predecessor
    from public.team_workweek_publications
    where id = v_publication.predecessor_publication_id
    for update;

    if not found
      or v_predecessor.owner_profile_id <> v_owner_profile_id
      or v_predecessor.status <> 'published'
      or v_predecessor.effective_from >= v_publication.effective_from
      or v_predecessor.effective_to is not null
      or v_predecessor.superseded_by_publication_id is not null then
      raise exception using errcode = 'P0004', message = 'published workweek revision is stale';
    end if;

    update public.team_workweek_publications
    set effective_to = v_publication.effective_from - 1,
      superseded_by_publication_id = v_publication.id
    where id = v_predecessor.id;
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
