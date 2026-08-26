alter table public.team_workweek_publications
  add column deactivated_at timestamptz,
  add column deactivation_reason text;

alter table public.team_workweek_publications
  drop constraint team_workweek_publications_status,
  drop constraint team_workweek_publications_consistent,
  add constraint team_workweek_publications_status
    check (status in ('preparing', 'published', 'inactive')),
  add constraint team_workweek_publications_deactivation_reason
    check (deactivation_reason is null or deactivation_reason in ('manual_disconnect', 'external_revocation')),
  add constraint team_workweek_publications_consistent check (
    (status = 'preparing' and published_at is null and sync_state in ('pending', 'delayed') and deactivated_at is null and deactivation_reason is null)
    or (status = 'published' and published_at is not null and sync_state = 'confirmed' and deactivated_at is null and deactivation_reason is null)
    or (status = 'inactive' and deactivated_at is not null and deactivation_reason is not null)
  );

alter table public.team_workweek_google_series
  add column future_cleanup_state text not null default 'not_required',
  add column future_cleanup_confirmed_at timestamptz,
  add constraint team_workweek_google_series_future_cleanup check (
    (future_cleanup_state = 'not_required' and future_cleanup_confirmed_at is null)
    or (future_cleanup_state = 'pending' and future_cleanup_confirmed_at is null)
    or (future_cleanup_state = 'confirmed' and future_cleanup_confirmed_at is not null)
  );

alter table public.team_workweek_google_conflicts
  drop constraint team_workweek_google_conflicts_state,
  drop constraint team_workweek_google_conflicts_resolution,
  add constraint team_workweek_google_conflicts_state check (state in ('open', 'resolving', 'resolved', 'cancelled')),
  add constraint team_workweek_google_conflicts_resolution check (
    (state = 'open' and decision is null and resolution_version_id is null and resolved_at is null)
    or (state = 'resolving' and decision is not null and resolution_version_id is not null and resolved_at is null)
    or (state = 'resolved' and decision is not null and resolution_version_id is not null and resolved_at is not null)
    or (state = 'cancelled' and decision is null and resolution_version_id is null and resolved_at is not null)
  );

create table public.google_workspace_disconnect_operations (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id text not null references public.profiles(id) on delete cascade,
  requested_by text not null,
  revoke_connection boolean not null,
  cutoff_date date not null,
  state text not null default 'cleaning',
  revision integer not null default 1,
  retained_version_id uuid references public.team_workweek_versions(id) on delete restrict,
  requested_at timestamptz not null default now(),
  deactivated_at timestamptz,
  completed_at timestamptz,
  last_error_class text,
  updated_at timestamptz not null default now(),
  constraint google_workspace_disconnect_operations_request check (requested_by in ('owner', 'external_revocation')),
  constraint google_workspace_disconnect_operations_state check (state in ('cleaning', 'cleanup_pending', 'revoke_pending', 'completed')),
  constraint google_workspace_disconnect_operations_revision check (revision > 0),
  constraint google_workspace_disconnect_operations_consistent check (
    (state in ('cleaning', 'cleanup_pending') and completed_at is null)
    or (state = 'revoke_pending' and revoke_connection and deactivated_at is not null and completed_at is null)
    or (state = 'completed' and deactivated_at is not null and completed_at is not null)
  )
);

create unique index google_workspace_disconnect_operations_owner_open_unique
  on public.google_workspace_disconnect_operations (owner_profile_id)
  where state <> 'completed';

create table public.google_workspace_disconnect_series (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.google_workspace_disconnect_operations(id) on delete cascade,
  series_id uuid not null references public.team_workweek_google_series(id) on delete restrict,
  calendar_id text not null default 'primary',
  google_event_id text not null,
  expected_etag text not null,
  expected_founderops_revision integer not null,
  cleanup_action text not null,
  recurrence_count integer,
  state text not null default 'pending',
  confirmed_etag text,
  last_error_class text,
  last_observed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_workspace_disconnect_series_calendar check (calendar_id = 'primary'),
  constraint google_workspace_disconnect_series_identity check (google_event_id ~ '^[a-v0-9]+$'),
  constraint google_workspace_disconnect_series_action check (
    (cleanup_action = 'delete' and recurrence_count is null)
    or (cleanup_action = 'truncate' and recurrence_count > 0)
  ),
  constraint google_workspace_disconnect_series_state check (state in ('pending', 'confirmed')),
  unique (operation_id, series_id)
);

comment on table public.google_workspace_disconnect_operations is
  'Service-only durable workflow for removing future FounderOps calendar projection before or after a Google disconnect.';
comment on table public.google_workspace_disconnect_series is
  'Service-only exact Google series targets for a disconnect cleanup. Provider identifiers never reach browser clients.';

alter table public.google_workspace_disconnect_operations enable row level security;
alter table public.google_workspace_disconnect_series enable row level security;
revoke all on table public.google_workspace_disconnect_operations from public, anon, authenticated, service_role;
revoke all on table public.google_workspace_disconnect_series from public, anon, authenticated, service_role;
grant select, insert, update on table public.google_workspace_disconnect_operations to service_role;
grant select, insert, update on table public.google_workspace_disconnect_series to service_role;

create or replace function public.guard_team_workweek_publication_effective_future()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_next_monday date;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_profile_id, 0));
  if exists (
    select 1 from public.google_workspace_disconnect_operations
    where owner_profile_id = new.owner_profile_id and state <> 'completed'
  ) then
    raise exception using errcode = 'P0003', message = 'Google disconnect is still preparing';
  end if;
  v_next_monday := v_today + case
    when extract(isodow from v_today)::integer = 1 then 7
    else 8 - extract(isodow from v_today)::integer
  end;
  if new.effective_from < v_next_monday and exists (
    select 1 from public.google_workspace_disconnect_operations
    where owner_profile_id = new.owner_profile_id
      and retained_version_id = new.source_version_id
      and state = 'completed'
  ) then
    new.effective_from := v_next_monday;
  end if;
  return new;
end;
$$;

alter function public.guard_team_workweek_publication_effective_future() owner to postgres;
revoke all on function public.guard_team_workweek_publication_effective_future() from public, anon, authenticated, service_role;
create trigger guard_team_workweek_publication_effective_future
before insert on public.team_workweek_publications
for each row execute function public.guard_team_workweek_publication_effective_future();

create or replace function public.prepare_google_workspace_disconnect(p_owner_profile_id text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_owner_role text;
  v_operation public.google_workspace_disconnect_operations%rowtype;
  v_today date := (clock_timestamp() at time zone 'Europe/Berlin')::date;
  v_cutoff date;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  select profile.platform_role into v_owner_role
  from public.profiles as profile where profile.id = p_owner_profile_id;
  if not found or nullif(btrim(p_owner_profile_id), '') is null or v_owner_role not in ('ceo', 'founder', 'deputy') then
    raise exception using errcode = '42501', message = 'planning contributor profile required';
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

create or replace function public.confirm_google_workspace_disconnect_series(
  p_target_id uuid,
  p_expected_etag text,
  p_confirmed_etag text,
  p_observed_at timestamptz default clock_timestamp()
) returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_target public.google_workspace_disconnect_series%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  select * into v_target from public.google_workspace_disconnect_series
  where id = p_target_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'disconnect target not found'; end if;
  if v_target.state = 'confirmed' then return; end if;
  if v_target.expected_etag <> p_expected_etag then
    raise exception using errcode = 'P0004', message = 'disconnect target changed';
  end if;
  update public.google_workspace_disconnect_series
  set state = 'confirmed', confirmed_etag = nullif(p_confirmed_etag, ''),
    last_error_class = null, last_observed_at = p_observed_at, updated_at = p_observed_at
  where id = v_target.id;
end;
$$;

alter function public.confirm_google_workspace_disconnect_series(uuid, text, text, timestamptz) owner to postgres;
revoke all on function public.confirm_google_workspace_disconnect_series(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.confirm_google_workspace_disconnect_series(uuid, text, text, timestamptz) to service_role;

create or replace function public.retain_private_team_workweek_after_deactivation(
  p_owner_profile_id text,
  p_cutoff date
) returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_version_id uuid;
  v_publication public.team_workweek_publications%rowtype;
  v_window jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  select * into v_publication from public.team_workweek_publications
  where owner_profile_id = p_owner_profile_id and status = 'inactive'
  order by publication_revision desc, id desc limit 1;
  if not found then return null; end if;

  insert into public.team_workweek_versions (owner_profile_id, effective_from, origin)
  values (p_owner_profile_id, p_cutoff, 'owner') returning id into v_version_id;
  for v_window in select value from jsonb_array_elements(v_publication.windows)
  loop
    insert into public.team_workweek_windows (version_id, weekday, start_minute, end_minute)
    values (
      v_version_id,
      (v_window->>'weekday')::smallint,
      (v_window->>'startMinute')::smallint,
      (v_window->>'endMinute')::smallint
    );
  end loop;
  return v_version_id;
end;
$$;

alter function public.retain_private_team_workweek_after_deactivation(text, date) owner to postgres;
revoke all on function public.retain_private_team_workweek_after_deactivation(text, date) from public, anon, authenticated, service_role;

create or replace function public.finalize_google_workspace_disconnect(
  p_operation_id uuid,
  p_owner_profile_id text,
  p_observed_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_operation public.google_workspace_disconnect_operations%rowtype;
  v_retained_version_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  select * into v_operation from public.google_workspace_disconnect_operations
  where id = p_operation_id and owner_profile_id = p_owner_profile_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'disconnect operation not found'; end if;
  if v_operation.state in ('revoke_pending', 'completed') then
    return jsonb_build_object('id', v_operation.id, 'state', v_operation.state, 'retainedVersionId', v_operation.retained_version_id, 'replayed', true);
  end if;
  if exists (
    select 1 from public.google_workspace_disconnect_series
    where operation_id = v_operation.id and state <> 'confirmed'
  ) then
    raise exception using errcode = 'P0003', message = 'future Google series cleanup is incomplete';
  end if;
  if exists (
    select 1 from public.team_workweek_publications
    where owner_profile_id = p_owner_profile_id and status = 'preparing'
  ) then
    raise exception using errcode = 'P0003', message = 'team workweek publication started during disconnect';
  end if;
  if exists (
    select 1
    from public.team_workweek_google_series as series
    join public.team_workweek_publications as publication on publication.id = series.publication_id
    where publication.owner_profile_id = p_owner_profile_id
      and publication.status = 'published'
      and (publication.effective_to is null or publication.effective_to >= v_operation.cutoff_date)
      and series.state = 'confirmed'
      and series.provider_state = 'active'
      and not exists (
        select 1 from public.google_workspace_disconnect_series as target
        where target.operation_id = v_operation.id and target.series_id = series.id
      )
  ) then
    raise exception using errcode = 'P0003', message = 'disconnect cleanup snapshot is stale';
  end if;

  update public.team_workweek_publications
  set status = 'inactive', deactivated_at = p_observed_at,
    deactivation_reason = case when v_operation.requested_by = 'owner' then 'manual_disconnect' else 'external_revocation' end
  where owner_profile_id = p_owner_profile_id and status = 'published';

  v_retained_version_id := public.retain_private_team_workweek_after_deactivation(p_owner_profile_id, v_operation.cutoff_date);

  update public.team_workweek_google_series as series
  set future_cleanup_state = 'confirmed', future_cleanup_confirmed_at = p_observed_at, updated_at = p_observed_at
  where exists (
    select 1 from public.google_workspace_disconnect_series as target
    where target.operation_id = v_operation.id and target.series_id = series.id
  );

  update public.google_workspace_disconnect_operations
  set state = case when revoke_connection then 'revoke_pending' else 'completed' end,
    retained_version_id = v_retained_version_id,
    deactivated_at = p_observed_at,
    completed_at = case when revoke_connection then null else p_observed_at end,
    last_error_class = null,
    updated_at = p_observed_at
  where id = v_operation.id
  returning * into v_operation;

  return jsonb_build_object('id', v_operation.id, 'state', v_operation.state, 'retainedVersionId', v_retained_version_id, 'replayed', false);
end;
$$;

alter function public.finalize_google_workspace_disconnect(uuid, text, timestamptz) owner to postgres;
revoke all on function public.finalize_google_workspace_disconnect(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_google_workspace_disconnect(uuid, text, timestamptz) to service_role;

create or replace function public.complete_google_workspace_disconnect(
  p_operation_id uuid,
  p_owner_profile_id text,
  p_completed_at timestamptz default clock_timestamp()
) returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  update public.google_workspace_disconnect_operations
  set state = 'completed', completed_at = p_completed_at, last_error_class = null, updated_at = p_completed_at
  where id = p_operation_id and owner_profile_id = p_owner_profile_id and state = 'revoke_pending';
  if not found and not exists (
    select 1 from public.google_workspace_disconnect_operations
    where id = p_operation_id and owner_profile_id = p_owner_profile_id and state = 'completed'
  ) then
    raise exception using errcode = 'P0004', message = 'disconnect operation is not completable';
  end if;
end;
$$;

alter function public.complete_google_workspace_disconnect(uuid, text, timestamptz) owner to postgres;
revoke all on function public.complete_google_workspace_disconnect(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_google_workspace_disconnect(uuid, text, timestamptz) to service_role;

create or replace function public.rebase_google_workspace_disconnect_series(
  p_target_id uuid,
  p_expected_etag text,
  p_observed_etag text,
  p_observed_at timestamptz default clock_timestamp()
) returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_operation_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if nullif(btrim(p_observed_etag), '') is null or p_observed_at is null then
    raise exception using errcode = '22023', message = 'observed disconnect ETag is invalid';
  end if;
  update public.google_workspace_disconnect_series
  set expected_etag = btrim(p_observed_etag), last_error_class = null,
    last_observed_at = p_observed_at, updated_at = p_observed_at
  where id = p_target_id and state = 'pending' and expected_etag = p_expected_etag
  returning operation_id into v_operation_id;
  if not found then
    raise exception using errcode = 'P0004', message = 'disconnect target changed before ETag rebase';
  end if;
  update public.google_workspace_disconnect_operations
  set revision = revision + 1, last_error_class = null, updated_at = p_observed_at
  where id = v_operation_id and state in ('cleaning', 'cleanup_pending');
  if not found then
    raise exception using errcode = 'P0004', message = 'disconnect operation is not rebasable';
  end if;
end;
$$;

alter function public.rebase_google_workspace_disconnect_series(uuid, text, text, timestamptz) owner to postgres;
revoke all on function public.rebase_google_workspace_disconnect_series(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.rebase_google_workspace_disconnect_series(uuid, text, text, timestamptz) to service_role;

create or replace function public.deactivate_team_workweek_for_external_revocation(
  p_owner_profile_id text,
  p_excluded_publication_id uuid default null,
  p_observed_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_operation public.google_workspace_disconnect_operations%rowtype;
  v_today date := (p_observed_at at time zone 'Europe/Berlin')::date;
  v_cutoff date;
  v_retained_version_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner_profile_id, 0));
  v_cutoff := v_today + case
    when extract(isodow from v_today)::integer = 1 then 7
    else 8 - extract(isodow from v_today)::integer
  end;
  select * into v_operation from public.google_workspace_disconnect_operations
  where owner_profile_id = p_owner_profile_id and state <> 'completed' for update;
  if not found then
    insert into public.google_workspace_disconnect_operations (
      owner_profile_id, requested_by, revoke_connection, cutoff_date, state, last_error_class
    ) values (p_owner_profile_id, 'external_revocation', false, v_cutoff, 'cleanup_pending', 'oauth_reconnect_required')
    returning * into v_operation;
  else
    update public.google_workspace_disconnect_operations
    set requested_by = 'external_revocation', revoke_connection = false,
      state = 'cleanup_pending', last_error_class = 'oauth_reconnect_required', updated_at = p_observed_at
    where id = v_operation.id returning * into v_operation;
  end if;

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
    and series.provider_state = 'active'
  on conflict (operation_id, series_id) do nothing;

  update public.team_workweek_publications
  set status = 'inactive', deactivated_at = p_observed_at, deactivation_reason = 'external_revocation'
  where owner_profile_id = p_owner_profile_id
    and status in ('published', 'preparing')
    and (p_excluded_publication_id is null or id <> p_excluded_publication_id);

  update public.team_workweek_google_conflicts
  set state = 'cancelled', decision = null, resolution_version_id = null,
    resolved_at = p_observed_at, updated_at = p_observed_at
  where owner_profile_id = p_owner_profile_id and state in ('open', 'resolving');

  update public.team_workweek_google_series as series
  set future_cleanup_state = 'pending', future_cleanup_confirmed_at = null, updated_at = p_observed_at
  where exists (
    select 1 from public.google_workspace_disconnect_series as target
    where target.operation_id = v_operation.id and target.series_id = series.id and target.state = 'pending'
  );

  v_retained_version_id := public.retain_private_team_workweek_after_deactivation(p_owner_profile_id, v_operation.cutoff_date);
  update public.google_workspace_disconnect_operations
  set retained_version_id = v_retained_version_id, deactivated_at = p_observed_at, updated_at = p_observed_at
  where id = v_operation.id returning * into v_operation;

  return jsonb_build_object(
    'id', v_operation.id,
    'state', v_operation.state,
    'retainedVersionId', v_retained_version_id,
    'pendingSeries', (select count(*) from public.google_workspace_disconnect_series where operation_id = v_operation.id and state = 'pending')
  );
end;
$$;

alter function public.deactivate_team_workweek_for_external_revocation(text, uuid, timestamptz) owner to postgres;
revoke all on function public.deactivate_team_workweek_for_external_revocation(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.deactivate_team_workweek_for_external_revocation(text, uuid, timestamptz) to service_role;

create or replace function public.guard_owner_team_workweek_version_against_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_profile_id, 0));
  if exists (
    select 1 from public.google_workspace_disconnect_operations
    where owner_profile_id = new.owner_profile_id and state <> 'completed'
  ) and not (auth.role() = 'service_role' and new.origin = 'owner') then
    raise exception using errcode = 'P0003', message = 'Google disconnect is still preparing';
  end if;
  if new.origin = 'owner' and exists (
    select 1 from public.team_workweek_publications
    where owner_profile_id = new.owner_profile_id and status = 'preparing'
  ) then
    raise exception using errcode = 'P0003', message = 'Google reconciliation is still preparing';
  end if;
  return new;
end;
$$;

alter function public.guard_owner_team_workweek_version_against_reconciliation() owner to postgres;
revoke all on function public.guard_owner_team_workweek_version_against_reconciliation() from public, anon, authenticated, service_role;

create or replace function public.guard_team_workweek_conflict_against_disconnect()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.owner_profile_id, 0));
  if new.state <> 'cancelled' and exists (
    select 1 from public.google_workspace_disconnect_operations
    where owner_profile_id = new.owner_profile_id and state <> 'completed'
  ) then
    raise exception using errcode = 'P0003', message = 'Google disconnect is still preparing';
  end if;
  return new;
end;
$$;

alter function public.guard_team_workweek_conflict_against_disconnect() owner to postgres;
revoke all on function public.guard_team_workweek_conflict_against_disconnect() from public, anon, authenticated, service_role;
create trigger guard_team_workweek_conflict_against_disconnect
before insert or update on public.team_workweek_google_conflicts
for each row execute function public.guard_team_workweek_conflict_against_disconnect();
