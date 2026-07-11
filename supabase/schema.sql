create extension if not exists pgcrypto;

create table if not exists profiles (
  id text primary key,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  role text not null check (role in ('admin', 'member', 'viewer')),
  platform_role text not null default 'founder' check (platform_role in ('ceo', 'founder', 'deputy', 'viewer')),
  org_role text,
  github_login text,
  deputy_for text references profiles(id) on delete set null,
  deputy_active_from date,
  deputy_active_until date,
  focus text,
  weekly_capacity integer not null default 6,
  profile_color text not null default '#64748b' check (profile_color ~ '^#[0-9A-Fa-f]{6}$'),
  google_chat_user_id text,
  google_chat_dm_space text,
  notifications_enabled boolean not null default true
);

create table if not exists projects (
  id text primary key,
  name text not null,
  range_label text
);

create table if not exists github_app_user_tokens (
  profile_id text primary key references profiles(id) on delete cascade,
  github_login text not null,
  github_user_id bigint,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  refreshed_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists github_issue_sync_locks (
  resource_key text primary key,
  task_id text references tasks(id) on delete cascade,
  locked_by_profile_id text references profiles(id) on delete set null,
  lock_token uuid not null,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint github_issue_sync_locks_resource_key_present check (length(trim(resource_key)) > 0),
  constraint github_issue_sync_locks_expires_after_locked check (expires_at > locked_at)
);

create table if not exists profile_ui_preferences (
  profile_id text primary key references profiles(id) on delete cascade,
  default_workspace text not null default 'planning'
    check (default_workspace in ('planning', 'execution', 'mine', 'reviews', 'events', 'sprint', 'projects', 'tools', 'team', 'settings', 'ceo-intake', 'profile')),
  default_task_view text not null default 'board'
    check (default_task_view in ('board', 'structure', 'table', 'gantt')),
  planning_filters jsonb not null default '{"query":"","assignee":"Alle","status":"Alle","priority":"Alle","packageId":"Alle","quick":""}'::jsonb,
  expanded_package_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profile_feature_tour_acknowledgements (
  profile_id text not null references profiles(id) on delete cascade,
  tour_id text not null,
  seen_at timestamptz not null default now(),
  primary key (profile_id, tour_id)
);

create table if not exists audit_log (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  actor_profile_id text references profiles(id) on delete set null,
  before_data jsonb,
  after_data jsonb,
  request_ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists notification_preferences (
  id bigint generated always as identity primary key,
  profile_id text not null references profiles(id) on delete cascade,
  channel text not null default 'google_chat' check (channel in ('google_chat', 'in_app', 'github')),
  event_type text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, channel, event_type)
);

create table if not exists packages (
  id text primary key,
    project_id text not null references projects(id) on delete cascade,
    owner_id text references profiles(id) on delete set null,
    accountable_profile_id text references profiles(id) on delete set null,
    responsible_profile_ids text[] not null default '{}',
    consulted_profile_ids text[] not null default '{}',
    informed_profile_ids text[] not null default '{}',
    title text not null,
  goal text,
  priority text,
  status text not null default 'planned' check (status in ('planned', 'active', 'done', 'paused')),
  target_date date,
  success_criteria text not null default '',
    scope_constraints text not null default '',
    sort_order integer not null default 0,
    constraint packages_responsible_profile_ids_no_null check (array_position(responsible_profile_ids, null) is null),
    constraint packages_consulted_profile_ids_no_null check (array_position(consulted_profile_ids, null) is null),
    constraint packages_informed_profile_ids_no_null check (array_position(informed_profile_ids, null) is null)
  );

create table if not exists tasks (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  package_id text references packages(id) on delete set null,
  title text not null,
  description text,
  status text not null,
  priority text not null,
  owner text references profiles(id) on delete set null,
  assignee text references profiles(id) on delete set null,
  created_by text references profiles(id) on delete set null,
  workstream text,
  sort_order integer not null default 0,
  start_date date,
  end_date date,
  deadline text,
  estimate_hours integer,
  definition_of_done text,
  evidence_link text,
  issue_number text,
  issue_url text,
  watched boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table tasks add column if not exists review_owner_profile_id text references profiles(id) on delete set null;
alter table tasks add column if not exists review_requested_at timestamptz;

create table if not exists sprints (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  name text not null,
  status text not null default 'planning' check (status in ('planning', 'active', 'review', 'closed')),
  start_date date,
  end_date date,
  review_due_at timestamptz,
  score_locked boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meetings (
  id bigint generated always as identity primary key,
  sprint_id text not null references sprints(id) on delete cascade,
  title text not null,
  meeting_at timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 15 and 480),
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  agenda text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists meeting_attendance (
  id bigint generated always as identity primary key,
  meeting_id bigint not null references meetings(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'present', 'excused', 'late_excused', 'unexcused', 'no_show')),
  absence_reason text,
  reason_accepted boolean not null default false,
  written_update text,
  points integer not null default 0 check (points between 0 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, profile_id)
);

create table if not exists task_dependencies (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  note text not null
);

create table if not exists task_links (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  type text not null,
  label text not null,
  url text not null
);

create table if not exists task_notes (
  task_id text primary key references tasks(id) on delete cascade,
  note text not null,
  updated_at timestamptz not null default now()
);

create table if not exists task_activity (
  id bigint generated always as identity primary key,
  task_id text not null references tasks(id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists task_focus_items (
  id bigserial primary key,
  profile_id text references profiles(id) on delete cascade,
  task_id text not null references tasks(id) on delete cascade,
  focus_date date not null default current_date,
  position integer not null default 1,
  next_step text not null default '',
  status text not null default 'planned' check (status in ('planned', 'done', 'blocked', 'deferred', 'needs_decision')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, task_id, focus_date)
);

create table if not exists founder_sprint_scores (
  id bigint generated always as identity primary key,
  sprint_id text not null references sprints(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  delivery_points integer not null default 0 check (delivery_points between 0 and 12),
  form_points integer not null default 0 check (form_points between 0 and 4),
  weekly_points integer not null default 0 check (weekly_points between 0 and 4),
  total_points integer not null default 0 check (total_points between 0 and 20),
  fulfilled boolean not null default false,
  away_neutral boolean not null default false,
  finalized_at timestamptz not null default now(),
  finalized_by text references profiles(id) on delete set null,
  reason_summary text not null default '',
  unique (sprint_id, profile_id)
);

create table if not exists founder_strike_state (
  id bigint generated always as identity primary key,
  profile_id text not null unique references profiles(id) on delete cascade,
  strike_level integer not null default 0 check (strike_level between 0 and 3),
  fulfilled_reset_streak integer not null default 0 check (fulfilled_reset_streak >= 0),
  last_evaluated_sprint_id text references sprints(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists strike_events (
  id bigint generated always as identity primary key,
  profile_id text not null references profiles(id) on delete cascade,
  sprint_id text not null references sprints(id) on delete cascade,
  event_type text not null check (event_type in ('strike_added', 'strike_reset', 'away_neutral', 'fulfilled_no_change', 'governance_review_required')),
  previous_strike_level integer not null default 0 check (previous_strike_level between 0 and 3),
  next_strike_level integer not null default 0 check (next_strike_level between 0 and 3),
  reason text not null default '',
  created_at timestamptz not null default now(),
  created_by text references profiles(id) on delete set null
);

create table if not exists score_objections (
  id bigint generated always as identity primary key,
  sprint_id text not null references sprints(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  founder_sprint_score_id bigint references founder_sprint_scores(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'accepted')),
  comment text not null,
  resolution_comment text not null default '',
  reviewed_by text references profiles(id) on delete set null,
  reviewed_at timestamptz,
  second_reviewer_profile_id text references profiles(id) on delete set null,
  second_review_decision text,
  second_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists founder_events (
  id bigserial primary key,
  title text not null,
  category text not null default 'other' check (category in ('conference', 'legal', 'company', 'travel', 'deadline', 'other')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text not null default '',
  description text not null default '',
  audience_mode text not null default 'all' check (audience_mode in ('all', 'selected')),
  participant_profile_ids text[] not null default '{}',
  reminder_days_before integer not null default 7 check (reminder_days_before between 0 and 90),
  reminder_generated_at timestamptz,
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  created_by text references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founder_events_participant_profile_ids_no_null check (array_position(participant_profile_ids, null) is null),
  constraint founder_events_selected_has_participants check (audience_mode = 'all' or cardinality(participant_profile_ids) > 0),
  constraint founder_events_end_after_start check (ends_at is null or ends_at >= starts_at)
);


create index if not exists profiles_auth_user_id_idx on profiles(auth_user_id);
create index if not exists profiles_platform_role_idx on profiles(platform_role);
create index if not exists profiles_github_login_idx on profiles(lower(github_login));
create index if not exists github_app_user_tokens_github_login_idx on github_app_user_tokens(github_login);
create index if not exists github_app_user_tokens_refresh_idx on github_app_user_tokens(refresh_token_expires_at);
create index if not exists github_issue_sync_locks_task_idx on github_issue_sync_locks(task_id);
create index if not exists github_issue_sync_locks_expires_idx on github_issue_sync_locks(expires_at);
create index if not exists profile_feature_tour_acknowledgements_tour_idx on profile_feature_tour_acknowledgements(tour_id, seen_at);
  create index if not exists packages_project_id_idx on packages(project_id);
  create index if not exists packages_owner_id_idx on packages(owner_id);
  create index if not exists packages_accountable_profile_id_idx on packages(accountable_profile_id);
  create index if not exists packages_status_idx on packages(status);
create index if not exists packages_target_date_idx on packages(target_date);
create index if not exists tasks_project_id_idx on tasks(project_id);
create index if not exists tasks_package_id_idx on tasks(package_id);
create index if not exists tasks_status_idx on tasks(status);
create index if not exists tasks_owner_idx on tasks(owner);
create index if not exists tasks_assignee_idx on tasks(assignee);
create index if not exists tasks_review_owner_profile_id_idx on tasks(review_owner_profile_id);
create index if not exists tasks_review_requested_at_idx on tasks(review_requested_at);
create index if not exists meetings_sprint_id_idx on meetings(sprint_id);
create index if not exists meeting_attendance_meeting_idx on meeting_attendance(meeting_id);
create index if not exists meeting_attendance_profile_idx on meeting_attendance(profile_id);
create index if not exists task_dependencies_task_id_idx on task_dependencies(task_id);
create index if not exists task_links_task_id_idx on task_links(task_id);
create index if not exists task_activity_task_id_idx on task_activity(task_id);
create index if not exists task_focus_items_profile_date_idx on task_focus_items(profile_id, focus_date, position);
create index if not exists task_focus_items_task_idx on task_focus_items(task_id);
create index if not exists founder_sprint_scores_sprint_idx on founder_sprint_scores(sprint_id);
create index if not exists founder_sprint_scores_profile_idx on founder_sprint_scores(profile_id);
create index if not exists strike_events_profile_sprint_idx on strike_events(profile_id, sprint_id);
create index if not exists strike_events_type_idx on strike_events(event_type);
create index if not exists score_objections_sprint_status_idx on score_objections(sprint_id, status);
create index if not exists score_objections_profile_idx on score_objections(profile_id);
create index if not exists founder_events_starts_at_idx on founder_events(starts_at);
create index if not exists founder_events_status_idx on founder_events(status);
create index if not exists founder_events_reminder_generated_at_idx on founder_events(reminder_generated_at);
create index if not exists founder_events_participant_profile_ids_idx on founder_events using gin(participant_profile_ids);
create index if not exists audit_log_entity_idx on audit_log(entity_type, entity_id);

grant usage on schema public to anon, authenticated, service_role;
grant select on profiles, profile_ui_preferences, profile_feature_tour_acknowledgements, projects, packages, tasks, sprints, meetings, meeting_attendance, task_dependencies, task_links, task_notes, task_activity, task_focus_items, founder_sprint_scores, founder_strike_state, strike_events, score_objections, founder_events to authenticated, service_role;
grant insert, update, delete on profiles, profile_ui_preferences, profile_feature_tour_acknowledgements, projects, packages, tasks, sprints, meetings, meeting_attendance, task_dependencies, task_links, task_notes, task_activity, task_focus_items, founder_sprint_scores, founder_strike_state, strike_events, score_objections, founder_events to authenticated, service_role;
grant select, insert on audit_log to authenticated, service_role;
grant select, insert, update, delete on notification_preferences to authenticated, service_role;
grant select, insert, update, delete on github_app_user_tokens to service_role;
grant select, insert, update, delete on github_issue_sync_locks to service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

create or replace function public.current_profile_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where auth_user_id = auth.uid()
$$;

create or replace function public.current_platform_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select platform_role from public.profiles where auth_user_id = auth.uid()
$$;

create or replace function public.upsert_profile_notification_preferences(
  p_profile_id text,
  p_notification_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_events jsonb := coalesce(p_notification_events, '{}'::jsonb);
  v_preferences jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(v_events) <> 'object' then
    raise exception using errcode = '22023', message = 'notification events must be a JSON object';
  end if;

  if exists (
    select 1
    from jsonb_each(v_events) as event
    where jsonb_typeof(event.value) <> 'boolean'
  ) then
    raise exception using errcode = '22023', message = 'notification event values must be boolean';
  end if;

  insert into public.notification_preferences as preference (
    profile_id,
    channel,
    event_type,
    enabled,
    updated_at
  )
  select
    p_profile_id,
    'google_chat',
    event.key,
    (event.value #>> '{}')::boolean,
    now()
  from jsonb_each(v_events) as event
  on conflict (profile_id, channel, event_type) do update
    set enabled = excluded.enabled,
        updated_at = excluded.updated_at;

  select coalesce(jsonb_agg(to_jsonb(preference) order by preference.event_type), '[]'::jsonb)
  into v_preferences
  from public.notification_preferences as preference
  where preference.profile_id = p_profile_id
    and preference.channel = 'google_chat'
    and preference.event_type in (select key from jsonb_each(v_events));

  return v_preferences;
end;
$$;

create or replace function public.update_profile_admin_transaction(
  p_profile_id text,
  p_actor_profile_id text,
  p_profile_patch jsonb default '{}'::jsonb,
  p_notification_events jsonb default '{}'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
  v_before jsonb;
  v_profile jsonb;
  v_preferences jsonb;
  v_current_role text;
  v_next_role text;
  v_demoted_ceo_ids text[] := '{}';
begin
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'profile patch must be a JSON object';
  end if;

  lock table public.profiles in share row exclusive mode;

  select to_jsonb(profile), profile.platform_role
  into v_before, v_current_role
  from public.profiles as profile
  where profile.id = p_profile_id;

  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  if v_patch ? 'platform_role' then
    v_next_role := v_patch ->> 'platform_role';
    if v_next_role not in ('ceo', 'founder', 'deputy', 'viewer') then
      raise exception using errcode = '22023', message = 'invalid platform role';
    end if;

    if v_next_role = 'ceo' then
      select coalesce(array_agg(profile.id order by profile.id), '{}')
      into v_demoted_ceo_ids
      from public.profiles as profile
      where profile.id <> p_profile_id
        and profile.platform_role = 'ceo';

      update public.profiles
      set platform_role = 'founder',
          org_role = 'Founder',
          deputy_for = null,
          deputy_active_from = null,
          deputy_active_until = null
      where id <> p_profile_id
        and platform_role = 'ceo';
    elsif v_current_role = 'ceo' and not exists (
      select 1
      from public.profiles
      where id <> p_profile_id
        and platform_role = 'ceo'
    ) then
      raise exception using errcode = '23514', message = 'at least one CEO must remain';
    end if;
  end if;

  update public.profiles as profile
  set github_login = case when v_patch ? 'github_login' then nullif(v_patch ->> 'github_login', '') else profile.github_login end,
      platform_role = case when v_patch ? 'platform_role' then v_patch ->> 'platform_role' else profile.platform_role end,
      org_role = case when v_patch ? 'org_role' then nullif(v_patch ->> 'org_role', '') else profile.org_role end,
      deputy_for = case when v_patch ? 'deputy_for' then nullif(v_patch ->> 'deputy_for', '') else profile.deputy_for end,
      deputy_active_from = case when v_patch ? 'deputy_active_from' then nullif(v_patch ->> 'deputy_active_from', '')::date else profile.deputy_active_from end,
      deputy_active_until = case when v_patch ? 'deputy_active_until' then nullif(v_patch ->> 'deputy_active_until', '')::date else profile.deputy_active_until end,
      focus = case when v_patch ? 'focus' then nullif(v_patch ->> 'focus', '') else profile.focus end,
      weekly_capacity = case when v_patch ? 'weekly_capacity' then (v_patch ->> 'weekly_capacity')::integer else profile.weekly_capacity end,
      profile_color = case when v_patch ? 'profile_color' then v_patch ->> 'profile_color' else profile.profile_color end,
      google_chat_user_id = case when v_patch ? 'google_chat_user_id' then nullif(v_patch ->> 'google_chat_user_id', '') else profile.google_chat_user_id end,
      google_chat_dm_space = case when v_patch ? 'google_chat_dm_space' then nullif(v_patch ->> 'google_chat_dm_space', '') else profile.google_chat_dm_space end,
      notifications_enabled = case when v_patch ? 'notifications_enabled' then (v_patch ->> 'notifications_enabled')::boolean else profile.notifications_enabled end
  where profile.id = p_profile_id
  returning to_jsonb(profile) into v_profile;

  if (select count(*) from public.profiles where platform_role = 'ceo') <> 1 then
    raise exception using errcode = '23514', message = 'exactly one CEO is required';
  end if;

  v_preferences := public.upsert_profile_notification_preferences(p_profile_id, p_notification_events);

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_actor_profile_id,
    'profile.update',
    'profile',
    p_profile_id,
    v_before,
    jsonb_build_object(
      'profile', v_profile,
      'notification_events', coalesce(p_notification_events, '{}'::jsonb),
      'demoted_ceo_ids', to_jsonb(v_demoted_ceo_ids)
    ),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'profile', v_profile,
    'notification_preferences', v_preferences
  );
end;
$$;

create or replace function public.update_profile_settings_transaction(
  p_profile_id text,
  p_profile_patch jsonb default '{}'::jsonb,
  p_ui_preferences jsonb default null,
  p_notification_events jsonb default '{}'::jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_profile_patch, '{}'::jsonb);
  v_before jsonb;
  v_profile jsonb;
  v_ui_preference jsonb := null;
  v_preferences jsonb;
begin
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'profile patch must be a JSON object';
  end if;

  select to_jsonb(profile)
  into v_before
  from public.profiles as profile
  where profile.id = p_profile_id
  for update;

  if v_before is null then
    raise exception using errcode = 'P0002', message = 'profile not found';
  end if;

  update public.profiles as profile
  set focus = case when v_patch ? 'focus' then nullif(v_patch ->> 'focus', '') else profile.focus end,
      profile_color = case when v_patch ? 'profile_color' then v_patch ->> 'profile_color' else profile.profile_color end,
      notifications_enabled = case when v_patch ? 'notifications_enabled' then (v_patch ->> 'notifications_enabled')::boolean else profile.notifications_enabled end
  where profile.id = p_profile_id
  returning to_jsonb(profile) into v_profile;

  if p_ui_preferences is not null then
    if jsonb_typeof(p_ui_preferences) <> 'object' then
      raise exception using errcode = '22023', message = 'UI preferences must be a JSON object';
    end if;

    insert into public.profile_ui_preferences as preference (
      profile_id,
      default_workspace,
      default_task_view,
      planning_filters,
      expanded_package_ids,
      updated_at
    )
    values (
      p_profile_id,
      p_ui_preferences ->> 'default_workspace',
      p_ui_preferences ->> 'default_task_view',
      p_ui_preferences -> 'planning_filters',
      array(select jsonb_array_elements_text(p_ui_preferences -> 'expanded_package_ids')),
      now()
    )
    on conflict (profile_id) do update
      set default_workspace = excluded.default_workspace,
          default_task_view = excluded.default_task_view,
          planning_filters = excluded.planning_filters,
          expanded_package_ids = excluded.expanded_package_ids,
          updated_at = excluded.updated_at
    returning jsonb_build_object(
      'profile_id', preference.profile_id,
      'default_workspace', preference.default_workspace,
      'default_task_view', preference.default_task_view,
      'planning_filters', preference.planning_filters,
      'expanded_package_ids', to_jsonb(preference.expanded_package_ids),
      'created_at', preference.created_at,
      'updated_at', preference.updated_at
    ) into v_ui_preference;
  end if;

  v_preferences := public.upsert_profile_notification_preferences(p_profile_id, p_notification_events);

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_profile_id,
    'profile.self_service.update',
    'profile',
    p_profile_id,
    v_before,
    jsonb_build_object(
      'profile', v_profile,
      'ui_preference', v_ui_preference,
      'notification_events', coalesce(p_notification_events, '{}'::jsonb)
    ),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'profile', v_profile,
    'ui_preference', v_ui_preference,
    'notification_preferences', v_preferences
  );
end;
$$;

revoke all on function public.upsert_profile_notification_preferences(text, jsonb) from public, anon, authenticated;
revoke all on function public.update_profile_admin_transaction(text, text, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.update_profile_settings_transaction(text, jsonb, jsonb, jsonb, text, text) from public, anon, authenticated;

grant execute on function public.update_profile_admin_transaction(text, text, jsonb, jsonb, text, text) to service_role;
grant execute on function public.update_profile_settings_transaction(text, jsonb, jsonb, jsonb, text, text) to service_role;

comment on function public.update_profile_admin_transaction(text, text, jsonb, jsonb, text, text)
is 'Atomically updates an admin-managed profile, CEO transfer, notification preferences, and audit entry.';

comment on function public.update_profile_settings_transaction(text, jsonb, jsonb, jsonb, text, text)
is 'Atomically updates self-service profile fields, UI preferences, notification preferences, and audit entry.';

create or replace function public.update_task_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb default '{}'::jsonb,
  p_note_present boolean default false,
  p_note text default null,
  p_dependency_present boolean default false,
  p_dependency_note text default null,
  p_activity_messages text[] default '{}',
  p_notifications jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_allowed_columns constant text[] := array[
    'acceptance_criteria',
    'assignee',
    'deadline',
    'definition_of_done',
    'end_date',
    'evidence_link',
    'evidence_required',
    'github_sync_error',
    'github_sync_status',
    'intended_outcome',
    'milestone_id',
    'owner',
    'package_id',
    'priority',
    'problem_statement',
    'review_owner_profile_id',
    'review_requested_at',
    'review_status',
    'score_final',
    'score_points',
    'score_relevant',
    'self_blockers_checked',
    'self_dod_checked',
    'self_documented_checked',
    'self_evidence_checked',
    'scope_constraints',
    'sprint_id',
    'start_date',
    'status',
    'task_type'
  ];
  v_assignments text;
  v_task jsonb;
  v_activities jsonb := '[]'::jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task update timestamp is required';
  end if;

  if jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'task patch must be a JSON object';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_patch) as patch_key
    where not (patch_key = any(v_allowed_columns))
  ) then
    raise exception using errcode = '22023', message = 'task patch contains unsupported columns';
  end if;

  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'task notifications must be a JSON array';
  end if;

  if exists (select 1 from jsonb_object_keys(v_patch)) then
    select string_agg(
      format(
        '%1$I = (jsonb_populate_record(null::public.tasks, to_jsonb(task) || $1)).%1$I',
        patch_key
      ),
      ', '
      order by patch_key
    )
    into v_assignments
    from jsonb_object_keys(v_patch) as patch_key;

    execute format(
      'update public.tasks as task set %s, updated_at = clock_timestamp() where task.id = $2 and task.updated_at = $3 returning to_jsonb(task)',
      v_assignments
    )
    into v_task
    using v_patch, p_task_id, p_expected_updated_at;
  else
    update public.tasks as task
    set updated_at = clock_timestamp()
    where task.id = p_task_id
      and task.updated_at = p_expected_updated_at
    returning to_jsonb(task) into v_task;
  end if;

  if v_task is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if p_note_present then
    insert into public.task_notes (task_id, note, updated_at)
    values (p_task_id, coalesce(p_note, ''), now())
    on conflict (task_id) do update
      set note = excluded.note,
          updated_at = excluded.updated_at;
  end if;

  if p_dependency_present then
    delete from public.task_dependencies where task_id = p_task_id;
    if nullif(trim(coalesce(p_dependency_note, '')), '') is not null then
      insert into public.task_dependencies (task_id, note)
      values (p_task_id, left(trim(p_dependency_note), 2000));
    end if;
  end if;

  with inserted as (
    insert into public.task_activity (task_id, message)
    select p_task_id, message
    from unnest(coalesce(p_activity_messages, '{}')) as message
    where nullif(trim(message), '') is not null
    returning id, task_id, message, created_at
  )
  select coalesce(jsonb_agg(to_jsonb(inserted) order by inserted.id), '[]'::jsonb)
  into v_activities
  from inserted;

  insert into public.notification_events (
    type,
    actor_profile_id,
    recipient_profile_id,
    entity_type,
    entity_id,
    title,
    body
  )
  select
    notification.type,
    notification.actor_profile_id,
    notification.recipient_profile_id,
    notification.entity_type,
    notification.entity_id,
    notification.title,
    notification.body
  from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb)) as notification(
    type text,
    actor_profile_id text,
    recipient_profile_id text,
    entity_type text,
    entity_id text,
    title text,
    body text
  );

  return jsonb_build_object(
    'task', v_task,
    'activities', v_activities
  );
end;
$$;

revoke all on function public.update_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.update_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb) to service_role;

comment on function public.update_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb)
is 'Atomically applies a compare-and-set task update with notes, dependencies, activity, and notifications.';

create or replace function public.try_acquire_github_issue_sync_lock(
  p_resource_key text,
  p_task_id text default null,
  p_locked_by_profile_id text default null,
  p_ttl_seconds integer default 600
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lock_token uuid := gen_random_uuid();
begin
  if p_resource_key is null or length(trim(p_resource_key)) = 0 then
    raise exception 'github sync resource key is required';
  end if;

  insert into public.github_issue_sync_locks (
    resource_key,
    task_id,
    locked_by_profile_id,
    lock_token,
    locked_at,
    expires_at
  )
  values (
    trim(p_resource_key),
    nullif(p_task_id, ''),
    nullif(p_locked_by_profile_id, ''),
    v_lock_token,
    now(),
    now() + make_interval(secs => greatest(coalesce(p_ttl_seconds, 600), 1))
  )
  on conflict (resource_key) do update
    set task_id = excluded.task_id,
        locked_by_profile_id = excluded.locked_by_profile_id,
        lock_token = excluded.lock_token,
        locked_at = excluded.locked_at,
        expires_at = excluded.expires_at
    where public.github_issue_sync_locks.expires_at <= now()
  returning lock_token into v_lock_token;

  if not found then
    return null;
  end if;

  return v_lock_token;
end;
$$;

create or replace function public.release_github_issue_sync_lock(
  p_resource_key text,
  p_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.github_issue_sync_locks
  where resource_key = trim(p_resource_key)
    and lock_token = p_lock_token;

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.try_acquire_github_issue_sync_lock(text, text, text, integer) from public;
revoke all on function public.release_github_issue_sync_lock(text, uuid) from public;
grant execute on function public.try_acquire_github_issue_sync_lock(text, text, text, integer) to service_role;
grant execute on function public.release_github_issue_sync_lock(text, uuid) to service_role;

alter table profiles enable row level security;
alter table github_app_user_tokens enable row level security;
alter table github_issue_sync_locks enable row level security;
alter table profile_ui_preferences enable row level security;
alter table profile_feature_tour_acknowledgements enable row level security;
alter table audit_log enable row level security;
alter table notification_preferences enable row level security;
alter table projects enable row level security;
alter table packages enable row level security;
alter table tasks enable row level security;
alter table sprints enable row level security;
alter table meetings enable row level security;
alter table meeting_attendance enable row level security;
alter table task_dependencies enable row level security;
alter table task_links enable row level security;
alter table task_notes enable row level security;
alter table task_activity enable row level security;
alter table task_focus_items enable row level security;
alter table founder_sprint_scores enable row level security;
alter table founder_strike_state enable row level security;
alter table strike_events enable row level security;
alter table score_objections enable row level security;
alter table founder_events enable row level security;

drop policy if exists "profiles_select_team" on profiles;
create policy "profiles_select_team" on profiles for select to authenticated using (auth.uid() is not null);

drop policy if exists "profiles_update_self_or_admin" on profiles;
create policy "profiles_update_self_or_admin" on profiles for update to authenticated
using (auth_user_id = auth.uid() or public.current_profile_role() = 'admin')
with check (auth_user_id = auth.uid() or public.current_profile_role() = 'admin');

drop policy if exists "profile_ui_preferences_select_self_or_operational" on profile_ui_preferences;
create policy "profile_ui_preferences_select_self_or_operational" on profile_ui_preferences for select to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);

drop policy if exists "profile_ui_preferences_write_self" on profile_ui_preferences;
create policy "profile_ui_preferences_write_self" on profile_ui_preferences for all to authenticated
using (profile_id in (select id from profiles where auth_user_id = auth.uid()))
with check (profile_id in (select id from profiles where auth_user_id = auth.uid()));

drop policy if exists "profile_feature_tour_acknowledgements_select_self_or_operational" on profile_feature_tour_acknowledgements;
create policy "profile_feature_tour_acknowledgements_select_self_or_operational" on profile_feature_tour_acknowledgements for select to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);

drop policy if exists "profile_feature_tour_acknowledgements_write_self" on profile_feature_tour_acknowledgements;
create policy "profile_feature_tour_acknowledgements_write_self" on profile_feature_tour_acknowledgements for all to authenticated
using (profile_id in (select id from profiles where auth_user_id = auth.uid()))
with check (profile_id in (select id from profiles where auth_user_id = auth.uid()));

drop policy if exists "audit_log_select_team" on audit_log;
create policy "audit_log_select_team" on audit_log for select to authenticated using (auth.uid() is not null);

drop policy if exists "audit_log_insert_operational" on audit_log;
create policy "audit_log_insert_operational" on audit_log for insert to authenticated
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy'));

drop policy if exists "notification_preferences_select_team" on notification_preferences;
create policy "notification_preferences_select_team" on notification_preferences for select to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);

drop policy if exists "notification_preferences_write_self_or_operational" on notification_preferences;
create policy "notification_preferences_write_self_or_operational" on notification_preferences for all to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
)
with check (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);

drop policy if exists "projects_select_team" on projects;
create policy "projects_select_team" on projects for select to authenticated using (auth.uid() is not null);

drop policy if exists "projects_write_admin" on projects;
create policy "projects_write_admin" on projects for all to authenticated
using (public.current_profile_role() = 'admin')
with check (public.current_profile_role() = 'admin');

drop policy if exists "packages_select_team" on packages;
create policy "packages_select_team" on packages for select to authenticated using (auth.uid() is not null);

drop policy if exists "packages_write_members" on packages;
create policy "packages_write_members" on packages for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "tasks_select_team" on tasks;
create policy "tasks_select_team" on tasks for select to authenticated using (auth.uid() is not null);

drop policy if exists "tasks_write_members" on tasks;
create policy "tasks_write_members" on tasks for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "sprints_select_team" on sprints;
create policy "sprints_select_team" on sprints for select to authenticated using (auth.uid() is not null);

drop policy if exists "sprints_write_operational" on sprints;
create policy "sprints_write_operational" on sprints for all to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

drop policy if exists "meetings_select_team" on meetings;
create policy "meetings_select_team" on meetings for select to authenticated using (auth.uid() is not null);

drop policy if exists "meetings_write_operational" on meetings;
create policy "meetings_write_operational" on meetings for all to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

drop policy if exists "meeting_attendance_select_team" on meeting_attendance;
create policy "meeting_attendance_select_team" on meeting_attendance for select to authenticated using (auth.uid() is not null);

drop policy if exists "meeting_attendance_write_team" on meeting_attendance;
create policy "meeting_attendance_write_team" on meeting_attendance for all to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
)
with check (
  public.current_platform_role() in ('ceo', 'deputy')
  or profile_id in (select id from profiles where auth_user_id = auth.uid())
);

drop policy if exists "task_dependencies_select_team" on task_dependencies;
create policy "task_dependencies_select_team" on task_dependencies for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_dependencies_write_members" on task_dependencies;
create policy "task_dependencies_write_members" on task_dependencies for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_links_select_team" on task_links;
create policy "task_links_select_team" on task_links for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_links_write_members" on task_links;
create policy "task_links_write_members" on task_links for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_notes_select_team" on task_notes;
create policy "task_notes_select_team" on task_notes for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_notes_write_members" on task_notes;
create policy "task_notes_write_members" on task_notes for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_activity_select_team" on task_activity;
create policy "task_activity_select_team" on task_activity for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_activity_insert_members" on task_activity;
create policy "task_activity_insert_members" on task_activity for insert to authenticated
with check (public.current_profile_role() in ('admin', 'member'));

drop policy if exists "task_focus_items_select_team" on task_focus_items;
create policy "task_focus_items_select_team" on task_focus_items for select to authenticated using (auth.uid() is not null);

drop policy if exists "task_focus_items_write_team" on task_focus_items;
create policy "task_focus_items_write_team" on task_focus_items for all to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

drop policy if exists "founder_events_select_team" on founder_events;
create policy "founder_events_select_team" on founder_events for select to authenticated using (auth.uid() is not null);

drop policy if exists "founder_events_write_members" on founder_events;
create policy "founder_events_write_members" on founder_events for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));
