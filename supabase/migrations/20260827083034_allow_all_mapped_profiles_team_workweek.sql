-- Every mapped FounderOps profile can read published workweeks and manage only its own private state.
alter policy team_workweek_versions_select_owner_private
  on public.team_workweek_versions
  using (owner_profile_id = public.current_profile_id());

alter policy team_workweek_windows_select_owner_private
  on public.team_workweek_windows
  using (
    exists (
      select 1
      from public.team_workweek_versions as version
      where version.id = team_workweek_windows.version_id
        and version.owner_profile_id = public.current_profile_id()
    )
  );

alter policy team_workweek_publications_select_owner_or_published_team
  on public.team_workweek_publications
  using (
    owner_profile_id = public.current_profile_id()
    or (status = 'published' and public.current_profile_id() is not null)
  );

alter policy team_workweek_google_series_select_owner_private
  on public.team_workweek_google_series
  using (owner_profile_id = public.current_profile_id());

alter policy team_workweek_google_series_transitions_select_owner_private
  on public.team_workweek_google_series_transitions
  using (owner_profile_id = public.current_profile_id());

alter policy team_workweek_google_reconciliation_status_select_owner_private
  on public.team_workweek_google_reconciliation_status
  using (owner_profile_id = public.current_profile_id());

create or replace function public.create_private_team_workweek_version(
  p_effective_from date,
  p_windows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_owner_profile_id text;
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_next_monday date;
  v_version_id uuid;
  v_window jsonb;
  v_weekday smallint;
  v_start_minute smallint;
  v_end_minute smallint;
begin
  v_next_monday := v_today + case
    when extract(isodow from v_today)::integer = 1 then 7
    else 8 - extract(isodow from v_today)::integer
  end;

  select profile.id
  into v_owner_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid();

  if not found or v_owner_profile_id is null then
    raise exception using errcode = '42501', message = 'mapped team profile required';
  end if;
  if p_effective_from is null
    or extract(isodow from p_effective_from)::integer <> 1
    or p_effective_from < v_next_monday then
    raise exception using errcode = '22023', message = 'effective date must be a future Monday';
  end if;
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) > 84 then
    raise exception using errcode = '22023', message = 'workweek windows must be a bounded array';
  end if;

  insert into public.team_workweek_versions (owner_profile_id, effective_from)
  values (v_owner_profile_id, p_effective_from)
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
    'timezone', 'Europe/Berlin',
    'status', 'preparing',
    'createdAt', clock_timestamp()
  );
end;
$$;

alter function public.create_private_team_workweek_version(date, jsonb) owner to postgres;
revoke all on function public.create_private_team_workweek_version(date, jsonb) from public, anon, service_role;
grant execute on function public.create_private_team_workweek_version(date, jsonb) to authenticated;

create or replace function public.prepare_team_workweek_publication(p_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_owner_profile_id text;
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
  select profile.id into v_owner_profile_id
  from public.profiles as profile where profile.auth_user_id = auth.uid();
  if not found or v_owner_profile_id is null then
    raise exception using errcode = '42501', message = 'mapped team profile required';
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

create or replace function public.finalize_team_workweek_publication(p_publication_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_owner_profile_id text;
  v_publication public.team_workweek_publications%rowtype;
  v_predecessor public.team_workweek_publications%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select profile.id
  into v_owner_profile_id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid();

  if not found or v_owner_profile_id is null then
    raise exception using errcode = '42501', message = 'mapped team profile required';
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

create or replace function public.prepare_google_workspace_disconnect(p_owner_profile_id text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_operation public.google_workspace_disconnect_operations%rowtype;
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_cutoff date;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if nullif(btrim(p_owner_profile_id), '') is null or not exists (
    select 1 from public.profiles as profile where profile.id = p_owner_profile_id
  ) then
    raise exception using errcode = '42501', message = 'mapped team profile required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  select * into v_operation from public.google_workspace_disconnect_operations
  where owner_profile_id = p_owner_profile_id and state <> 'completed'
  for update;
  if found then
    return jsonb_build_object('id', v_operation.id, 'state', v_operation.state, 'replayed', true);
  end if;
  if not exists (
    select 1 from public.google_workspace_connections
    where profile_id = p_owner_profile_id
  ) and not exists (
    select 1 from public.team_workweek_publications
    where owner_profile_id = p_owner_profile_id and status = 'published'
  ) then
    select * into v_operation from public.google_workspace_disconnect_operations
    where owner_profile_id = p_owner_profile_id and state = 'completed'
    order by completed_at desc, id desc limit 1;
    return jsonb_build_object('id', v_operation.id, 'state', 'completed', 'replayed', true);
  end if;
  if exists (
    select 1 from public.team_workweek_publications
    where owner_profile_id = p_owner_profile_id and status = 'preparing'
  ) or exists (
    select 1 from public.team_workweek_google_conflicts
    where owner_profile_id = p_owner_profile_id and state in ('open', 'resolving')
  ) then
    raise exception using errcode = 'P0003', message = 'team workweek transition is still preparing';
  end if;

  v_cutoff := v_today + case
    when extract(isodow from v_today)::integer = 1 then 7
    else 8 - extract(isodow from v_today)::integer
  end;
  insert into public.google_workspace_disconnect_operations (
    owner_profile_id, requested_by, revoke_connection, cutoff_date, state
  ) values (p_owner_profile_id, 'owner', true, v_cutoff, 'cleaning')
  returning * into v_operation;

  insert into public.google_workspace_disconnect_series (
    operation_id, series_id, calendar_id, google_event_id, expected_etag,
    expected_founderops_revision, cleanup_action, recurrence_count
  )
  select v_operation.id, series.id, series.calendar_id, series.google_event_id,
    series.confirmed_etag, series.confirmed_founderops_revision,
    case when publication.effective_from >= v_cutoff then 'delete' else 'truncate' end,
    case when publication.effective_from >= v_cutoff then null else (v_cutoff - publication.effective_from) / 7 end
  from public.team_workweek_google_series as series
  join public.team_workweek_publications as publication on publication.id = series.publication_id
  where publication.owner_profile_id = p_owner_profile_id
    and publication.status = 'published'
    and (publication.effective_to is null or publication.effective_to >= v_cutoff)
    and series.state = 'confirmed'
    and series.provider_state = 'active';

  update public.team_workweek_google_series as series
  set future_cleanup_state = 'pending', future_cleanup_confirmed_at = null, updated_at = clock_timestamp()
  where exists (
    select 1 from public.google_workspace_disconnect_series as target
    where target.operation_id = v_operation.id and target.series_id = series.id
  );

  return jsonb_build_object(
    'id', v_operation.id,
    'state', v_operation.state,
    'pendingSeries', (select count(*) from public.google_workspace_disconnect_series where operation_id = v_operation.id),
    'replayed', false
  );
end;
$$;

alter function public.prepare_google_workspace_disconnect(text) owner to postgres;
revoke all on function public.prepare_google_workspace_disconnect(text) from public, anon, authenticated;
grant execute on function public.prepare_google_workspace_disconnect(text) to service_role;
