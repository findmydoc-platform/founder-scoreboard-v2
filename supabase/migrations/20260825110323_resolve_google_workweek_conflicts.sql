create table public.team_workweek_google_conflicts (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id text not null references public.profiles(id) on delete cascade,
  base_publication_id uuid not null references public.team_workweek_publications(id) on delete restrict,
  base_publication_revision integer not null,
  founderops_version_id uuid not null references public.team_workweek_versions(id) on delete restrict,
  google_effective_from date not null,
  google_windows jsonb not null,
  google_observations jsonb not null,
  google_fingerprint text not null,
  founderops_fingerprint text not null,
  conflict_revision integer not null default 1,
  state text not null default 'open',
  decision text,
  resolution_version_id uuid references public.team_workweek_versions(id) on delete restrict,
  observed_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_workweek_google_conflicts_state check (state in ('open', 'resolving', 'resolved')),
  constraint team_workweek_google_conflicts_decision check (decision is null or decision in ('founderops', 'google')),
  constraint team_workweek_google_conflicts_fingerprints check (
    google_fingerprint ~ '^[0-9a-f]{64}$' and founderops_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  constraint team_workweek_google_conflicts_payloads check (
    jsonb_typeof(google_windows) = 'array' and jsonb_typeof(google_observations) = 'array'
  ),
  constraint team_workweek_google_conflicts_resolution check (
    (state = 'open' and decision is null and resolution_version_id is null and resolved_at is null)
    or (state = 'resolving' and decision is not null and resolution_version_id is not null and resolved_at is null)
    or (state = 'resolved' and decision is not null and resolution_version_id is not null and resolved_at is not null)
  ),
  unique (base_publication_id, founderops_version_id, google_fingerprint)
);

comment on table public.team_workweek_google_conflicts is
  'Owner-private immutable comparison snapshots for parallel FounderOps and known Google workweek changes.';

alter table public.team_workweek_google_conflicts enable row level security;

revoke all on table public.team_workweek_google_conflicts from public, anon, authenticated, service_role;
grant select, insert, update on table public.team_workweek_google_conflicts to service_role;

create or replace function public.create_team_workweek_google_conflict(
  p_owner_profile_id text,
  p_base_publication_id uuid,
  p_base_publication_revision integer,
  p_founderops_version_id uuid,
  p_google_effective_from date,
  p_google_windows jsonb,
  p_google_observations jsonb,
  p_google_fingerprint text,
  p_founderops_fingerprint text,
  p_observed_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_conflict public.team_workweek_google_conflicts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if nullif(btrim(p_owner_profile_id), '') is null
    or p_base_publication_revision < 1
    or p_google_effective_from is null
    or p_google_windows is null or jsonb_typeof(p_google_windows) <> 'array'
    or p_google_observations is null or jsonb_typeof(p_google_observations) <> 'array'
    or p_google_fingerprint !~ '^[0-9a-f]{64}$'
    or p_founderops_fingerprint !~ '^[0-9a-f]{64}$'
    or p_observed_at is null then
    raise exception using errcode = '22023', message = 'parallel workweek conflict is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));

  if not exists (
    select 1 from public.team_workweek_publications
    where id = p_base_publication_id
      and owner_profile_id = p_owner_profile_id
      and publication_revision = p_base_publication_revision
      and status = 'published'
      and effective_to is null
  ) then
    raise exception using errcode = 'P0004', message = 'confirmed workweek changed before conflict capture';
  end if;
  if not exists (
    select 1 from public.team_workweek_versions as version
    where version.id = p_founderops_version_id
      and version.owner_profile_id = p_owner_profile_id
      and version.origin = 'owner'
      and not exists (
        select 1 from public.team_workweek_publications as publication
        where publication.source_version_id = version.id
      )
      and version.id = (
        select candidate.id
        from public.team_workweek_versions as candidate
        where candidate.owner_profile_id = p_owner_profile_id
          and candidate.origin = 'owner'
          and not exists (
            select 1 from public.team_workweek_publications as publication
            where publication.source_version_id = candidate.id
          )
        order by candidate.created_at desc, candidate.id desc
        limit 1
      )
  ) then
    raise exception using errcode = 'P0004', message = 'FounderOps draft changed before conflict capture';
  end if;

  insert into public.team_workweek_google_conflicts (
    owner_profile_id,
    base_publication_id,
    base_publication_revision,
    founderops_version_id,
    google_effective_from,
    google_windows,
    google_observations,
    google_fingerprint,
    founderops_fingerprint,
    observed_at,
    updated_at
  ) values (
    p_owner_profile_id,
    p_base_publication_id,
    p_base_publication_revision,
    p_founderops_version_id,
    p_google_effective_from,
    p_google_windows,
    p_google_observations,
    p_google_fingerprint,
    p_founderops_fingerprint,
    p_observed_at,
    p_observed_at
  )
  on conflict (base_publication_id, founderops_version_id, google_fingerprint) do update
  set observed_at = excluded.observed_at,
    updated_at = excluded.updated_at
  returning * into v_conflict;

  insert into public.team_workweek_google_reconciliation_status (
    publication_id, owner_profile_id, state, last_observed_at, last_error_class, updated_at
  ) values (
    p_base_publication_id, p_owner_profile_id, 'conflict', p_observed_at, 'founderops_changed', p_observed_at
  )
  on conflict (publication_id) do update
  set owner_profile_id = excluded.owner_profile_id,
    state = excluded.state,
    last_observed_at = excluded.last_observed_at,
    last_error_class = excluded.last_error_class,
    updated_at = excluded.updated_at;

  return jsonb_build_object('id', v_conflict.id, 'conflictRevision', v_conflict.conflict_revision, 'state', v_conflict.state);
end;
$$;

alter function public.create_team_workweek_google_conflict(text, uuid, integer, uuid, date, jsonb, jsonb, text, text, timestamptz) owner to postgres;
revoke all on function public.create_team_workweek_google_conflict(text, uuid, integer, uuid, date, jsonb, jsonb, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_team_workweek_google_conflict(text, uuid, integer, uuid, date, jsonb, jsonb, text, text, timestamptz) to service_role;

create or replace function public.prepare_team_workweek_google_conflict_resolution(
  p_conflict_id uuid,
  p_owner_profile_id text,
  p_conflict_revision integer,
  p_decision text,
  p_google_observations jsonb,
  p_google_fingerprint text,
  p_founderops_fingerprint text,
  p_resolution_fingerprint text,
  p_observed_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_conflict public.team_workweek_google_conflicts%rowtype;
  v_founderops_version public.team_workweek_versions%rowtype;
  v_version_id uuid;
  v_effective_from date;
  v_windows jsonb;
  v_window jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_conflict_revision < 1
    or p_decision not in ('founderops', 'google')
    or p_google_observations is null or jsonb_typeof(p_google_observations) <> 'array'
    or p_google_fingerprint !~ '^[0-9a-f]{64}$'
    or p_founderops_fingerprint !~ '^[0-9a-f]{64}$'
    or p_resolution_fingerprint !~ '^[0-9a-f]{64}$'
    or p_observed_at is null then
    raise exception using errcode = '22023', message = 'workweek conflict decision is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  select * into v_conflict
  from public.team_workweek_google_conflicts
  where id = p_conflict_id and owner_profile_id = p_owner_profile_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workweek conflict not found';
  end if;
  if v_conflict.conflict_revision <> p_conflict_revision then
    raise exception using errcode = 'P0004', message = 'workweek conflict decision is stale';
  end if;
  if v_conflict.state in ('resolving', 'resolved') then
    if v_conflict.decision <> p_decision then
      raise exception using errcode = 'P0004', message = 'workweek conflict was resolved differently';
    end if;
    return jsonb_build_object(
      'versionId', v_conflict.resolution_version_id,
      'state', v_conflict.state,
      'replayed', true
    );
  end if;
  if p_google_fingerprint <> v_conflict.google_fingerprint
    or p_founderops_fingerprint <> v_conflict.founderops_fingerprint
    or p_google_observations <> v_conflict.google_observations then
    raise exception using errcode = 'P0004', message = 'Google or FounderOps workweek changed after conflict capture';
  end if;
  if not exists (
    select 1 from public.team_workweek_publications
    where id = v_conflict.base_publication_id
      and publication_revision = v_conflict.base_publication_revision
      and status = 'published'
      and effective_to is null
  ) then
    raise exception using errcode = 'P0004', message = 'confirmed workweek changed after conflict capture';
  end if;

  select * into v_founderops_version
  from public.team_workweek_versions
  where id = v_conflict.founderops_version_id
    and owner_profile_id = p_owner_profile_id
  for update;
  if not found or exists (
    select 1 from public.team_workweek_publications
    where source_version_id = v_founderops_version.id
  ) or v_founderops_version.id <> (
    select candidate.id
    from public.team_workweek_versions as candidate
    where candidate.owner_profile_id = p_owner_profile_id
      and candidate.origin = 'owner'
      and not exists (
        select 1 from public.team_workweek_publications as publication
        where publication.source_version_id = candidate.id
      )
    order by candidate.created_at desc, candidate.id desc
    limit 1
  ) then
    raise exception using errcode = 'P0004', message = 'FounderOps draft changed after conflict capture';
  end if;

  perform public.apply_google_team_workweek_observations(
    v_conflict.base_publication_id,
    v_conflict.base_publication_revision,
    p_google_observations,
    p_observed_at
  );

  if p_decision = 'google' then
    v_effective_from := v_conflict.google_effective_from;
    v_windows := v_conflict.google_windows;
  else
    v_effective_from := v_founderops_version.effective_from;
    select coalesce(jsonb_agg(jsonb_build_object(
      'weekday', work_window.weekday,
      'startMinute', work_window.start_minute,
      'endMinute', work_window.end_minute
    ) order by work_window.weekday, work_window.start_minute, work_window.end_minute, work_window.id), '[]'::jsonb)
    into v_windows
    from public.team_workweek_windows as work_window
    where work_window.version_id = v_founderops_version.id;
  end if;

  insert into public.team_workweek_versions (
    owner_profile_id,
    effective_from,
    origin,
    google_reconciliation_source_publication_id,
    google_reconciliation_fingerprint
  ) values (
    p_owner_profile_id,
    v_effective_from,
    'google_reconciliation',
    v_conflict.base_publication_id,
    p_resolution_fingerprint
  )
  returning id into v_version_id;

  for v_window in select value from jsonb_array_elements(v_windows)
  loop
    insert into public.team_workweek_windows (version_id, weekday, start_minute, end_minute)
    values (
      v_version_id,
      (v_window->>'weekday')::smallint,
      (v_window->>'startMinute')::smallint,
      (v_window->>'endMinute')::smallint
    );
  end loop;

  update public.team_workweek_google_conflicts
  set state = 'resolving',
    decision = p_decision,
    resolution_version_id = v_version_id,
    updated_at = p_observed_at
  where id = v_conflict.id;

  return jsonb_build_object('versionId', v_version_id, 'state', 'resolving', 'replayed', false);
end;
$$;

alter function public.prepare_team_workweek_google_conflict_resolution(uuid, text, integer, text, jsonb, text, text, text, timestamptz) owner to postgres;
revoke all on function public.prepare_team_workweek_google_conflict_resolution(uuid, text, integer, text, jsonb, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.prepare_team_workweek_google_conflict_resolution(uuid, text, integer, text, jsonb, text, text, text, timestamptz) to service_role;

create or replace function public.refresh_team_workweek_google_conflict_resolution(
  p_conflict_id uuid,
  p_owner_profile_id text,
  p_conflict_revision integer,
  p_decision text,
  p_google_observations jsonb,
  p_google_fingerprint text,
  p_observed_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_conflict public.team_workweek_google_conflicts%rowtype;
  v_publication public.team_workweek_publications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_conflict_revision < 1
    or p_decision not in ('founderops', 'google')
    or p_google_observations is null or jsonb_typeof(p_google_observations) <> 'array'
    or p_google_fingerprint !~ '^[0-9a-f]{64}$'
    or p_observed_at is null then
    raise exception using errcode = '22023', message = 'workweek conflict refresh is invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  select * into v_conflict
  from public.team_workweek_google_conflicts
  where id = p_conflict_id and owner_profile_id = p_owner_profile_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'workweek conflict not found';
  end if;
  if v_conflict.conflict_revision <> p_conflict_revision
    or v_conflict.state <> 'resolving'
    or v_conflict.decision <> p_decision then
    raise exception using errcode = 'P0004', message = 'workweek conflict refresh is stale';
  end if;

  select * into v_publication
  from public.team_workweek_publications
  where source_version_id = v_conflict.resolution_version_id
    and owner_profile_id = p_owner_profile_id
    and status = 'preparing'
  for update;
  if not found then
    raise exception using errcode = 'P0004', message = 'workweek conflict publication is not refreshable';
  end if;

  perform public.apply_google_team_workweek_observations(
    v_conflict.base_publication_id,
    v_conflict.base_publication_revision,
    p_google_observations,
    p_observed_at
  );

  update public.team_workweek_google_series_transitions as transition
  set expected_etag = predecessor.confirmed_etag,
    expected_founderops_revision = predecessor.confirmed_founderops_revision
  from public.team_workweek_google_series as predecessor
  where transition.activation_publication_id = v_publication.id
    and transition.predecessor_series_id = predecessor.id
    and transition.state = 'pending'
    and predecessor.confirmed_etag is not null
    and predecessor.confirmed_founderops_revision is not null;

  update public.team_workweek_google_conflicts
  set google_observations = p_google_observations,
    google_fingerprint = p_google_fingerprint,
    conflict_revision = conflict_revision + 1,
    observed_at = p_observed_at,
    updated_at = p_observed_at
  where id = v_conflict.id
  returning * into v_conflict;

  return jsonb_build_object(
    'id', v_conflict.id,
    'conflictRevision', v_conflict.conflict_revision,
    'state', v_conflict.state,
    'decision', v_conflict.decision
  );
end;
$$;

alter function public.refresh_team_workweek_google_conflict_resolution(uuid, text, integer, text, jsonb, text, timestamptz) owner to postgres;
revoke all on function public.refresh_team_workweek_google_conflict_resolution(uuid, text, integer, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.refresh_team_workweek_google_conflict_resolution(uuid, text, integer, text, jsonb, text, timestamptz) to service_role;

create or replace function public.complete_team_workweek_google_conflict_resolution(
  p_conflict_id uuid,
  p_owner_profile_id text,
  p_conflict_revision integer,
  p_resolved_at timestamptz default clock_timestamp()
) returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_conflict public.team_workweek_google_conflicts%rowtype;
  v_publication public.team_workweek_publications%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  select * into v_conflict from public.team_workweek_google_conflicts
  where id = p_conflict_id
    and owner_profile_id = p_owner_profile_id
    and conflict_revision = p_conflict_revision
  for update;
  if not found then
    raise exception using errcode = 'P0004', message = 'workweek conflict decision is stale';
  end if;
  if v_conflict.state = 'resolved' then return; end if;
  select * into v_publication from public.team_workweek_publications
  where source_version_id = v_conflict.resolution_version_id and status = 'published';
  if not found then
    raise exception using errcode = 'P0003', message = 'resolved workweek is not fully published';
  end if;
  update public.team_workweek_google_conflicts
  set state = 'resolved', resolved_at = p_resolved_at, updated_at = p_resolved_at
  where id = v_conflict.id;
  insert into public.team_workweek_google_reconciliation_status (
    publication_id, owner_profile_id, state, last_observed_at, last_error_class, updated_at
  ) values (v_publication.id, p_owner_profile_id, 'confirmed', p_resolved_at, null, p_resolved_at)
  on conflict (publication_id) do update
  set state = excluded.state,
    last_observed_at = excluded.last_observed_at,
    last_error_class = excluded.last_error_class,
    updated_at = excluded.updated_at;
end;
$$;

alter function public.complete_team_workweek_google_conflict_resolution(uuid, text, integer, timestamptz) owner to postgres;
revoke all on function public.complete_team_workweek_google_conflict_resolution(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_team_workweek_google_conflict_resolution(uuid, text, integer, timestamptz) to service_role;

-- Deleted known masters have already been confirmed by reconciliation and need no transition write.
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
  select profile.id, profile.platform_role into v_owner_profile_id, v_owner_role
  from public.profiles as profile where profile.auth_user_id = auth.uid();
  if not found or v_owner_profile_id is null or v_owner_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = '42501', message = 'planning contributor profile required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner_profile_id, 0));
  select * into v_version from public.team_workweek_versions
  where id = p_version_id and owner_profile_id = v_owner_profile_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'private team workweek version not found'; end if;
  select * into v_publication from public.team_workweek_publications
  where source_version_id = v_version.id and owner_profile_id = v_owner_profile_id for update;
  if not found then
    if exists (select 1 from public.team_workweek_publications where owner_profile_id = v_owner_profile_id and status = 'preparing') then
      raise exception using errcode = 'P0003', message = 'another team workweek publication is still preparing';
    end if;
    select * into v_predecessor from public.team_workweek_publications
    where owner_profile_id = v_owner_profile_id and status = 'published'
    order by effective_from desc, publication_revision desc, id desc limit 1 for update;
    if found and v_version.effective_from <= v_predecessor.effective_from then
      raise exception using errcode = '22023', message = 'effective boundary must follow latest published workweek';
    end if;
    select coalesce(max(publication_revision), 0) + 1 into v_revision
    from public.team_workweek_publications where owner_profile_id = v_owner_profile_id;
    select coalesce(jsonb_agg(jsonb_build_object(
      'weekday', work_window.weekday, 'startMinute', work_window.start_minute, 'endMinute', work_window.end_minute
    ) order by work_window.weekday, work_window.start_minute, work_window.end_minute, work_window.id), '[]'::jsonb)
    into v_windows from public.team_workweek_windows as work_window where work_window.version_id = v_version.id;
    insert into public.team_workweek_publications (
      source_version_id, owner_profile_id, effective_from, timezone, windows, publication_revision, predecessor_publication_id
    ) values (
      v_version.id, v_owner_profile_id, v_version.effective_from, v_version.timezone, v_windows, v_revision, v_predecessor.id
    ) returning * into v_publication;
  end if;
  if v_publication.predecessor_publication_id is not null then
    select * into v_predecessor from public.team_workweek_publications
    where id = v_publication.predecessor_publication_id and owner_profile_id = v_owner_profile_id and status = 'published' for update;
    if not found then raise exception using errcode = 'P0004', message = 'published workweek revision is stale'; end if;
    if v_publication.effective_from <= v_predecessor.effective_from then
      raise exception using errcode = '22023', message = 'effective boundary must follow latest published workweek';
    end if;
    v_recurrence_count := (v_publication.effective_from - v_predecessor.effective_from) / 7;
    insert into public.team_workweek_google_series_transitions (
      activation_publication_id, predecessor_series_id, owner_profile_id, expected_etag, expected_founderops_revision, recurrence_count
    )
    select v_publication.id, series.id, v_owner_profile_id, series.confirmed_etag,
      series.confirmed_founderops_revision, v_recurrence_count
    from public.team_workweek_google_series as series
    where series.publication_id = v_predecessor.id and series.state = 'confirmed' and series.provider_state = 'active'
    on conflict (activation_publication_id, predecessor_series_id) do nothing;
    if (
      select count(*)
      from public.team_workweek_google_series_transitions as transition
      join public.team_workweek_google_series as predecessor_series on predecessor_series.id = transition.predecessor_series_id
      where transition.activation_publication_id = v_publication.id
        and predecessor_series.provider_state = 'active'
    )
      <> (select count(*) from public.team_workweek_google_series where publication_id = v_predecessor.id and state = 'confirmed' and provider_state = 'active') then
      raise exception using errcode = 'P0003', message = 'predecessor Google series are not fully confirmed';
    end if;
  end if;
  for v_window in select id from public.team_workweek_windows where version_id = v_version.id
    order by weekday, start_minute, end_minute, id
  loop
    v_series_id := gen_random_uuid();
    insert into public.team_workweek_google_series (id, publication_id, source_window_id, owner_profile_id, google_event_id)
    values (v_series_id, v_publication.id, v_window.id, v_owner_profile_id, 'fops' || replace(v_series_id::text, '-', ''))
    on conflict (source_window_id) do nothing;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', series.id, 'calendarId', series.calendar_id, 'googleEventId', series.google_event_id,
    'state', series.state, 'confirmedEtag', series.confirmed_etag, 'weekday', work_window.weekday,
    'startMinute', work_window.start_minute, 'endMinute', work_window.end_minute
  ) order by work_window.weekday, work_window.start_minute, work_window.end_minute, series.id), '[]'::jsonb)
  into v_series from public.team_workweek_google_series as series
  join public.team_workweek_windows as work_window on work_window.id = series.source_window_id
  where series.publication_id = v_publication.id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', transition.id, 'calendarId', predecessor_series.calendar_id,
    'googleEventId', predecessor_series.google_event_id, 'predecessorSeriesId', predecessor_series.id,
    'state', transition.state, 'expectedEtag', transition.expected_etag,
    'expectedFounderopsRevision', transition.expected_founderops_revision,
    'recurrenceCount', transition.recurrence_count, 'confirmedEtag', transition.confirmed_etag
  ) order by predecessor_series.google_event_id, transition.id), '[]'::jsonb)
  into v_transitions from public.team_workweek_google_series_transitions as transition
  join public.team_workweek_google_series as predecessor_series on predecessor_series.id = transition.predecessor_series_id
  where transition.activation_publication_id = v_publication.id;
  return jsonb_build_object(
    'id', v_publication.id, 'sourceVersionId', v_publication.source_version_id,
    'ownerProfileId', v_owner_profile_id, 'effectiveFrom', v_publication.effective_from,
    'timezone', v_publication.timezone, 'status', v_publication.status, 'syncState', v_publication.sync_state,
    'publicationRevision', v_publication.publication_revision, 'publishedAt', v_publication.published_at,
    'lastSyncAt', v_publication.last_sync_at, 'series', v_series, 'transitions', v_transitions
  );
end;
$$;

alter function public.prepare_team_workweek_publication(uuid) owner to postgres;
revoke all on function public.prepare_team_workweek_publication(uuid) from public, anon, service_role;
grant execute on function public.prepare_team_workweek_publication(uuid) to authenticated;
