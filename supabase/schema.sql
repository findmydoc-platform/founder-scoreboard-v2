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
  constraint tasks_status_not_proposal_check check (status <> 'Vorschlag'),
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

alter table tasks add column if not exists github_repo text;
alter table tasks add column if not exists github_issue_number integer;
alter table tasks add column if not exists github_issue_url text;
alter table tasks add column if not exists github_issue_sync_status text not null default 'not_synced'
  check (github_issue_sync_status in ('not_synced', 'pending', 'synced', 'failed'));
alter table tasks add column if not exists github_issue_last_synced_at timestamptz;
alter table tasks add column if not exists github_issue_sync_error text;
create index if not exists tasks_github_issue_sync_status_idx on tasks(github_issue_sync_status);

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
grant insert, update, delete on profiles, profile_ui_preferences, profile_feature_tour_acknowledgements, projects, sprints, meetings, meeting_attendance, task_dependencies, task_links, task_notes, task_activity, task_focus_items, founder_sprint_scores, founder_strike_state, strike_events, score_objections, founder_events to authenticated, service_role;
revoke insert, update, delete on table public.packages, public.tasks from public, anon, authenticated;
grant insert, update, delete on table public.packages, public.tasks to service_role;
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

revoke all on function public.current_profile_role() from public, anon;
grant execute on function public.current_profile_role() to authenticated, service_role;

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
    'github_issue_sync_error',
    'github_issue_sync_status',
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

create table if not exists public.task_deletion_operations (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  status text not null default 'prepared' check (status in ('prepared', 'completed')),
  task_updated_at timestamptz not null,
  task_snapshot jsonb not null,
  task_snapshots jsonb not null default '[]'::jsonb,
  deleted_task_ids text[] not null default '{}',
  github_closed boolean not null default false,
  actor_profile_id text references public.profiles(id) on delete set null,
  request_ip text,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.task_deletion_operations
  add column if not exists task_snapshots jsonb not null default '[]'::jsonb;

create index if not exists task_deletion_operations_status_idx
  on public.task_deletion_operations(status, updated_at);

alter table public.task_deletion_operations enable row level security;
revoke all on table public.task_deletion_operations from public, anon, authenticated;
grant select, insert, update, delete on table public.task_deletion_operations to service_role;

create or replace function public.prepare_task_deletion_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.task_deletion_operations%rowtype;
  v_task public.tasks%rowtype;
  v_deleted_task_ids text[];
  v_task_snapshots jsonb;
begin
  if nullif(trim(coalesce(p_task_id, '')), '') is null or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'task id and expected update timestamp are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_task_id, 0));

  select * into v_operation
  from public.task_deletion_operations
  where task_id = p_task_id;

  if v_operation.id is not null then
    if v_operation.status = 'completed' then
      select * into v_task from public.tasks where id = p_task_id for update;
      if v_task.id is null then
        return jsonb_build_object(
          'operationId', v_operation.id,
          'status', v_operation.status,
          'task', v_operation.task_snapshot,
          'tasks', v_operation.task_snapshots,
          'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
          'githubClosed', v_operation.github_closed
        );
      end if;
      delete from public.task_deletion_operations where id = v_operation.id;
      v_operation := null;
    else
      select * into v_task from public.tasks where id = p_task_id for update;
      if v_task.id is null then
        raise exception using errcode = 'P0002', message = 'task not found';
      end if;

      if v_task.updated_at = v_operation.task_updated_at then
        return jsonb_build_object(
          'operationId', v_operation.id,
          'status', v_operation.status,
          'task', v_operation.task_snapshot,
          'tasks', v_operation.task_snapshots,
          'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
          'githubClosed', v_operation.github_closed
        );
      end if;

      delete from public.task_deletion_operations where id = v_operation.id;
      v_operation := null;
    end if;
  end if;

  select * into v_task
  from public.tasks
  where id = p_task_id
    and updated_at = p_expected_updated_at
  for update;

  if v_task.id is null then
    if exists (select 1 from public.tasks where id = p_task_id) then
      raise exception using errcode = 'P0001', message = 'task was changed concurrently';
    end if;
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  with recursive deletion_tree as (
    select id from public.tasks where id = p_task_id
    union
    select child.id
    from public.tasks as child
    join deletion_tree as parent on child.parent_task_id = parent.id
  )
  select coalesce(array_agg(id order by id), '{}'::text[])
  into v_deleted_task_ids
  from deletion_tree;

  select coalesce(jsonb_agg(to_jsonb(task) order by task.id), '[]'::jsonb)
  into v_task_snapshots
  from public.tasks as task
  where task.id = any(v_deleted_task_ids);

  insert into public.task_deletion_operations (
    task_id,
    task_updated_at,
    task_snapshot,
    task_snapshots,
    deleted_task_ids,
    actor_profile_id,
    request_ip,
    user_agent
  )
  values (
    p_task_id,
    v_task.updated_at,
    to_jsonb(v_task),
    v_task_snapshots,
    v_deleted_task_ids,
    p_actor_profile_id,
    p_request_ip,
    p_user_agent
  )
  returning * into v_operation;

  return jsonb_build_object(
    'operationId', v_operation.id,
    'status', v_operation.status,
    'task', v_operation.task_snapshot,
    'tasks', v_operation.task_snapshots,
    'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
    'githubClosed', v_operation.github_closed
  );
end;
$$;

create or replace function public.finalize_task_deletion_transaction(
  p_operation_id uuid,
  p_github_closed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.task_deletion_operations%rowtype;
  v_task public.tasks%rowtype;
begin
  select * into v_operation
  from public.task_deletion_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    raise exception using errcode = 'P0002', message = 'task deletion operation not found';
  end if;

  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'operationId', v_operation.id,
      'status', v_operation.status,
      'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
      'githubClosed', v_operation.github_closed
    );
  end if;

  select * into v_task
  from public.tasks
  where id = v_operation.task_id
  for update;

  if v_task.id is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  if v_task.updated_at <> v_operation.task_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;

  delete from public.tasks where id = v_operation.task_id;

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
    v_operation.actor_profile_id,
    'task.delete',
    'task',
    v_operation.task_id,
    v_operation.task_snapshot,
    jsonb_build_object(
      'deleted', true,
      'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
      'githubClosed', coalesce(p_github_closed, false)
    ),
    v_operation.request_ip,
    v_operation.user_agent
  );

  update public.task_deletion_operations
  set status = 'completed',
      github_closed = coalesce(p_github_closed, false),
      updated_at = clock_timestamp(),
      completed_at = clock_timestamp()
  where id = v_operation.id
  returning * into v_operation;

  return jsonb_build_object(
    'operationId', v_operation.id,
    'status', v_operation.status,
    'deletedTaskIds', to_jsonb(v_operation.deleted_task_ids),
    'githubClosed', v_operation.github_closed
  );
end;
$$;

create or replace function public.cancel_task_deletion_transaction(p_operation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_operation public.task_deletion_operations%rowtype;
begin
  select * into v_operation
  from public.task_deletion_operations
  where id = p_operation_id
  for update;

  if v_operation.id is null then
    return jsonb_build_object('cancelled', true);
  end if;

  if v_operation.status = 'completed' then
    return jsonb_build_object(
      'cancelled', false,
      'status', v_operation.status,
      'task', v_operation.task_snapshot
    );
  end if;

  delete from public.task_deletion_operations where id = v_operation.id;

  return jsonb_build_object(
    'cancelled', true,
    'status', 'cancelled',
    'task', v_operation.task_snapshot
  );
end;
$$;

revoke all on function public.prepare_task_deletion_transaction(text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.finalize_task_deletion_transaction(uuid, boolean) from public, anon, authenticated;
revoke all on function public.cancel_task_deletion_transaction(uuid) from public, anon, authenticated;
grant execute on function public.prepare_task_deletion_transaction(text, timestamptz, text, text, text) to service_role;
grant execute on function public.finalize_task_deletion_transaction(uuid, boolean) to service_role;
grant execute on function public.cancel_task_deletion_transaction(uuid) to service_role;

comment on table public.task_deletion_operations
is 'Durable saga state for idempotent task deletion across GitHub and PostgreSQL.';

comment on function public.prepare_task_deletion_transaction(text, timestamptz, text, text, text)
is 'Validates task deletion with compare-and-set and stores a durable deletion snapshot.';

comment on function public.finalize_task_deletion_transaction(uuid, boolean)
is 'Atomically deletes a prepared task tree, writes its audit record, and completes the deletion operation.';

comment on function public.cancel_task_deletion_transaction(uuid)
is 'Cancels an unfinished task deletion operation after an external side-effect failure.';

notify pgrst, 'reload schema';

create table if not exists public.team_task_intake_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id text not null references public.profiles(id) on delete cascade,
  label text not null,
  token_hash text not null unique,
  token_hint text not null,
  scopes text[] not null default array['read:task-context', 'write:task-intake'],
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint team_task_intake_tokens_label_check check (char_length(label) between 1 and 80),
  constraint team_task_intake_tokens_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
  constraint team_task_intake_tokens_hint_check check (char_length(token_hint) between 4 and 16),
  constraint team_task_intake_tokens_scopes_check check (
    array_position(scopes, null) is null
    and scopes <@ array['read:task-context', 'write:task-intake']
    and scopes @> array['read:task-context', 'write:task-intake']
  ),
  constraint team_task_intake_tokens_expiry_check check (expires_at > created_at)
);

create index if not exists team_task_intake_tokens_profile_id_idx
  on public.team_task_intake_tokens(profile_id);

create index if not exists team_task_intake_tokens_active_profile_idx
  on public.team_task_intake_tokens(profile_id, expires_at)
  where revoked_at is null;

create table if not exists public.team_task_intake_batches (
  id uuid primary key default gen_random_uuid(),
  token_id uuid not null references public.team_task_intake_tokens(id) on delete restrict,
  profile_id text not null references public.profiles(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash text not null,
  task_ids text[] not null,
  created_at timestamptz not null default now(),
  constraint team_task_intake_batches_request_hash_check check (request_hash ~ '^[a-f0-9]{64}$'),
  constraint team_task_intake_batches_task_ids_check check (cardinality(task_ids) between 1 and 30),
  constraint team_task_intake_batches_token_key_unique unique (token_id, idempotency_key)
);

create index if not exists team_task_intake_batches_token_id_idx
  on public.team_task_intake_batches(token_id);

create index if not exists team_task_intake_batches_profile_id_idx
  on public.team_task_intake_batches(profile_id);

alter table public.team_task_intake_tokens enable row level security;
alter table public.team_task_intake_batches enable row level security;

revoke all on table public.team_task_intake_tokens from public, anon, authenticated;
revoke all on table public.team_task_intake_batches from public, anon, authenticated;
grant select, insert, update on table public.team_task_intake_tokens to service_role;
grant select, insert on table public.team_task_intake_batches to service_role;

comment on table public.team_task_intake_tokens
is 'Hashed personal tokens for task-centered team context and guarded task intake.';

comment on column public.team_task_intake_tokens.token_hash
is 'SHA-256 hash of the one-time visible personal intake token.';

comment on table public.team_task_intake_batches
is 'Immutable idempotency records for atomic Team Task Intake commits.';

create or replace function public.create_team_task_intake_batch_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_items jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.team_task_intake_batches%rowtype;
  v_item jsonb;
  v_result jsonb;
  v_task jsonb;
  v_task_ids text[] := array[]::text[];
  v_tasks jsonb := '[]'::jsonb;
  v_item_count integer;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'team intake batch input is invalid';
  end if;

  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 30 then
    raise exception using errcode = '22023', message = 'team intake batch size is invalid';
  end if;

  if not exists (
    select 1
    from public.team_task_intake_tokens
    where id = p_token_id
      and profile_id = p_profile_id
      and revoked_at is null
      and expires_at > now()
  ) then
    raise exception using errcode = 'P0004', message = 'team intake token is inactive';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('team-intake-batch:' || p_token_id::text || ':' || p_idempotency_key::text, 0));

  select *
  into v_batch
  from public.team_task_intake_batches
  where token_id = p_token_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_batch.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key was reused with different team intake data';
    end if;

    select coalesce(jsonb_agg(to_jsonb(task_row) order by requested.ordinality), '[]'::jsonb)
    into v_tasks
    from unnest(v_batch.task_ids) with ordinality as requested(task_id, ordinality)
    join public.tasks as task_row on task_row.id = requested.task_id;

    return jsonb_build_object('batchId', v_batch.id, 'replayed', true, 'tasks', v_tasks);
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object'
       or jsonb_typeof(v_item->'taskInsert') <> 'object'
       or jsonb_typeof(coalesce(v_item->'notifications', '[]'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'team intake batch item is invalid';
    end if;

    v_result := public.create_task_transaction(
      v_item->'taskInsert',
      null,
      null,
      null,
      coalesce(v_item->>'activityMessage', 'Task via Team Intake created'),
      null,
      coalesce(v_item->'notifications', '[]'::jsonb),
      p_profile_id,
      p_request_ip,
      p_user_agent
    );
    v_task := v_result->'task';
    if v_task is null or nullif(v_task->>'id', '') is null then
      raise exception using errcode = 'P0001', message = 'team intake task creation returned no task';
    end if;
    v_task_ids := array_append(v_task_ids, v_task->>'id');
  end loop;

  insert into public.team_task_intake_batches (
    token_id,
    profile_id,
    idempotency_key,
    request_hash,
    task_ids
  ) values (
    p_token_id,
    p_profile_id,
    p_idempotency_key,
    p_request_hash,
    v_task_ids
  )
  returning * into v_batch;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    after_data,
    request_ip,
    user_agent
  ) values (
    p_profile_id,
    'team.task_intake.commit',
    'team_task_intake_batch',
    v_batch.id::text,
    jsonb_build_object('tokenId', p_token_id, 'taskIds', v_task_ids),
    p_request_ip,
    p_user_agent
  );

  select coalesce(jsonb_agg(to_jsonb(task_row) order by requested.ordinality), '[]'::jsonb)
  into v_tasks
  from unnest(v_task_ids) with ordinality as requested(task_id, ordinality)
  join public.tasks as task_row on task_row.id = requested.task_id;

  return jsonb_build_object('batchId', v_batch.id, 'replayed', false, 'tasks', v_tasks);
end;
$$;

revoke all on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text) to service_role;

comment on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text)
is 'Atomically and idempotently creates a Team Task Intake batch through the guarded task transaction.';

notify pgrst, 'reload schema';
alter table public.notification_events
  add column if not exists seen_at timestamptz,
  add column if not exists dismissed_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_reason text;

create or replace function public.current_profile_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select profile.id
  from public.profiles as profile
  where profile.auth_user_id = auth.uid()
     or (
       profile.auth_user_id is null
       and nullif(lower(profile.github_login), '') = nullif(lower(coalesce(
         auth.jwt() -> 'user_metadata' ->> 'user_name',
         auth.jwt() -> 'user_metadata' ->> 'preferred_username'
       )), '')
     )
  order by (profile.auth_user_id = auth.uid()) desc
  limit 1
$$;

create or replace function public.current_platform_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select profile.platform_role
  from public.profiles as profile
  where profile.id = public.current_profile_id()
$$;

revoke all on function public.current_profile_id() from public, anon;
grant execute on function public.current_profile_id() to authenticated, service_role;
revoke all on function public.current_platform_role() from public, anon;
grant execute on function public.current_platform_role() to authenticated, service_role;


create index if not exists notification_events_unseen_recipient_created_idx
  on public.notification_events (recipient_profile_id, created_at desc)
  where status = 'pending' and seen_at is null;

drop policy if exists "notification_events_select_team" on public.notification_events;
create policy "notification_events_select_team"
on public.notification_events for select to authenticated
using (
  auth.uid() is not null
  and (
    recipient_profile_id = public.current_profile_id()
    or (
      recipient_profile_id is null
      and public.current_platform_role() in ('ceo', 'deputy')
    )
  )
);

drop policy if exists "notification_events_update_recipient" on public.notification_events;
create policy "notification_events_update_recipient"
on public.notification_events for update to authenticated
using (
  recipient_profile_id = public.current_profile_id()
  or (
    recipient_profile_id is null
    and public.current_platform_role() in ('ceo', 'deputy')
  )
)
with check (
  recipient_profile_id = public.current_profile_id()
  or (
    recipient_profile_id is null
    and public.current_platform_role() in ('ceo', 'deputy')
  )
);

create or replace function public.guard_notification_system_resolution()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(auth.role(), 'service_role') = 'service_role' then
    return new;
  end if;

  if (to_jsonb(new) - 'status' - 'seen_at' - 'dismissed_at')
    is distinct from
    (to_jsonb(old) - 'status' - 'seen_at' - 'dismissed_at')
  then
    raise exception using errcode = '42501', message = 'notification system fields are immutable';
  end if;

  if old.status = 'pending'
    and new.status = 'pending'
    and new.seen_at is not null
    and new.dismissed_at is not distinct from old.dismissed_at
  then
    return new;
  end if;

  if old.status = 'pending'
    and new.status = 'dismissed'
    and new.seen_at is not null
    and new.dismissed_at is not null
  then
    return new;
  end if;

  raise exception using errcode = '42501', message = 'notification lifecycle transition is not allowed';
end;
$$;

revoke all on function public.guard_notification_system_resolution() from public, anon, authenticated;
grant execute on function public.guard_notification_system_resolution() to service_role;


drop trigger if exists notification_events_guard_system_resolution on public.notification_events;
create trigger notification_events_guard_system_resolution
before update on public.notification_events
for each row execute function public.guard_notification_system_resolution();

comment on column public.notification_events.seen_at
is 'Set when the recipient opens an in-app notification; the notification remains open.';
comment on column public.notification_events.dismissed_at
is 'Set when the recipient explicitly closes an in-app notification.';
comment on column public.notification_events.resolved_at
is 'Set by system reconciliation when the source condition is no longer relevant.';
comment on column public.notification_events.resolution_reason
is 'Stable system reason explaining why reconciliation resolved the notification.';

notify pgrst, 'reload schema';

drop policy if exists "tasks_select_team" on tasks;
create policy "tasks_select_team" on tasks for select to authenticated using (auth.uid() is not null);

drop policy if exists "tasks_write_members" on tasks;

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

alter table public.tasks add column if not exists creation_request_id text;
alter table public.tasks add column if not exists creation_request_payload jsonb;

create unique index if not exists tasks_creation_request_id_unique_idx
  on public.tasks(creation_request_id)
  where creation_request_id is not null;

comment on column public.tasks.creation_request_payload
is 'Stores only an MD5 fingerprint of the normalized create request for idempotency comparison.';

create or replace function public.create_task_transaction(
  p_task_insert jsonb,
  p_relation_type text default null,
  p_related_task_id text default null,
  p_relation_note text default null,
  p_activity_message text default 'Task created',
  p_relation_activity_message text default null,
  p_notifications jsonb default '[]'::jsonb,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_insert jsonb := coalesce(p_task_insert, '{}'::jsonb);
  v_allowed_columns constant text[] := array[
    'acceptance_criteria',
    'assignee',
    'carryover_count',
    'carryover_reason',
    'carried_from_sprint_id',
    'carried_from_task_id',
    'created_by',
    'creation_request_id',
    'deadline',
    'definition_of_done',
    'description',
    'dod_template_version',
    'end_date',
    'estimate_hours',
    'evidence_link',
    'evidence_required',
    'github_issue_number',
    'github_issue_url',
    'github_repo',
    'github_issue_sync_status',
    'id',
    'intended_outcome',
    'issue_number',
    'issue_url',
    'milestone_id',
    'original_sprint_id',
    'owner',
    'package_id',
    'parent_task_id',
    'priority',
    'problem_statement',
    'project_id',
    'review_owner_profile_id',
    'review_status',
    'score_final',
    'score_points',
    'score_relevant',
    'scope_constraints',
    'sort_order',
    'sprint_id',
    'start_date',
    'status',
    'task_type',
    'title',
    'workstream'
  ];
  v_task_id text := nullif(trim(v_insert->>'id'), '');
  v_creation_request_id text := nullif(trim(v_insert->>'creation_request_id'), '');
  v_request_payload jsonb;
  v_request_fingerprint jsonb;
  v_columns text;
  v_values text;
  v_task jsonb;
  v_relation jsonb := null;
  v_related_task jsonb := null;
  v_activities jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(v_insert) <> 'object' or v_task_id is null or v_creation_request_id is null then
    raise exception using errcode = '22023', message = 'task insert, task id, and creation request id are required';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(v_insert) as insert_key
    where not (insert_key = any(v_allowed_columns))
  ) then
    raise exception using errcode = '22023', message = 'task insert contains unsupported columns';
  end if;

  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'task notifications must be a JSON array';
  end if;

  v_request_payload := jsonb_build_object(
    'task', v_insert - 'sort_order',
    'relation', jsonb_build_object(
      'type', nullif(trim(coalesce(p_relation_type, '')), ''),
      'relatedTaskId', nullif(trim(coalesce(p_related_task_id, '')), ''),
      'note', nullif(trim(coalesce(p_relation_note, '')), '')
    )
  );
  v_request_fingerprint := to_jsonb(md5(v_request_payload::text));

  perform pg_advisory_xact_lock(hashtextextended('task-create:' || v_creation_request_id, 0));
  select to_jsonb(task) into v_task
  from public.tasks as task
  where task.creation_request_id = v_creation_request_id;

  if v_task is not null then
    if (v_task->'creation_request_payload') is distinct from v_request_fingerprint then
      raise exception using errcode = 'P0003', message = 'creation request id was reused with different task data';
    end if;

    select to_jsonb(relation) into v_relation
    from public.task_relationship_edges as relation
    where relation.task_id = v_task->>'id'
    order by relation.id
    limit 1;

    if v_relation is not null then
      select jsonb_build_object(
        'id', related.id,
        'githubIssueSyncStatus', related.github_issue_sync_status,
        'githubIssueSyncError', coalesce(related.github_issue_sync_error, ''),
        'updatedAt', related.updated_at
      )
      into v_related_task
      from public.tasks as related
      where related.id = v_relation->>'related_task_id';
    end if;

    return jsonb_build_object(
      'task', v_task,
      'relation', v_relation,
      'relatedTask', v_related_task,
      'activities', '[]'::jsonb,
      'replayed', true
    );
  end if;

  if nullif(trim(coalesce(p_related_task_id, '')), '') is not null then
    if p_related_task_id = v_task_id then
      raise exception using errcode = '22023', message = 'task cannot relate to itself';
    end if;
    if p_relation_type not in ('blocked_by', 'blocks', 'relates_to') then
      raise exception using errcode = '22023', message = 'task relation type is invalid';
    end if;
    if not exists (select 1 from public.tasks where id = p_related_task_id) then
      raise exception using errcode = 'P0002', message = 'related task not found';
    end if;
  elsif nullif(trim(coalesce(p_relation_type, '')), '') is not null then
    raise exception using errcode = '22023', message = 'related task id is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('tasks:sort-order', 0));
  v_insert := v_insert || jsonb_build_object(
    'sort_order', coalesce((select max(sort_order) from public.tasks), 0) + 1,
    'creation_request_payload', v_request_fingerprint
  );

  select
    string_agg(format('%I', insert_key), ', ' order by insert_key),
    string_agg(
      format('(jsonb_populate_record(null::public.tasks, $1)).%I', insert_key),
      ', '
      order by insert_key
    )
  into v_columns, v_values
  from jsonb_object_keys(v_insert) as insert_key;

  execute format(
    'insert into public.tasks (%s) select %s returning to_jsonb(tasks)',
    v_columns,
    v_values
  )
  into v_task
  using v_insert;

  if nullif(trim(coalesce(p_related_task_id, '')), '') is not null then
    insert into public.task_relationship_edges (
      task_id,
      related_task_id,
      relation_type,
      note,
      created_by
    )
    values (
      v_task_id,
      p_related_task_id,
      p_relation_type,
      nullif(trim(coalesce(p_relation_note, '')), ''),
      p_actor_profile_id
    )
    returning to_jsonb(task_relationship_edges) into v_relation;

    update public.tasks as related
    set github_issue_sync_status = 'not_synced',
        github_issue_sync_error = null,
        updated_at = clock_timestamp()
    where id = p_related_task_id
    returning jsonb_build_object(
      'id', related.id,
      'githubIssueSyncStatus', related.github_issue_sync_status,
      'githubIssueSyncError', coalesce(related.github_issue_sync_error, ''),
      'updatedAt', related.updated_at
    ) into v_related_task;
  end if;

  with inserted as (
    insert into public.task_activity (task_id, message)
    select v_task_id, message
    from unnest(array[p_activity_message, p_relation_activity_message]) as message
    where nullif(trim(coalesce(message, '')), '') is not null
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

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_actor_profile_id,
    'task.create',
    'task',
    v_task_id,
    v_insert,
    p_request_ip,
    p_user_agent
  );

  if v_relation is not null then
    insert into public.audit_log (
      actor_profile_id,
      action,
      entity_type,
      entity_id,
      after_data,
      request_ip,
      user_agent
    )
    values (
      p_actor_profile_id,
      'task.relationship_created',
      'task',
      v_task_id,
      v_relation,
      p_request_ip,
      p_user_agent
    );
  end if;

  return jsonb_build_object(
    'task', v_task,
    'relation', v_relation,
    'relatedTask', v_related_task,
    'activities', v_activities,
    'replayed', false
  );
end;
$$;

create or replace function public.begin_github_issue_sync_transaction(p_task_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  update public.tasks
  set github_issue_sync_status = 'pending',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  return v_task;
end;
$$;

create or replace function public.finalize_github_issue_sync_transaction(
  p_task_id text,
  p_github_repo text,
  p_github_issue_number integer,
  p_github_issue_url text,
  p_synced_at timestamptz,
  p_activity_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  if p_github_issue_number is null or p_github_issue_number <= 0 then
    raise exception using errcode = '22023', message = 'github issue number is invalid';
  end if;

  update public.tasks
  set github_repo = p_github_repo,
      github_issue_number = p_github_issue_number,
      github_issue_url = p_github_issue_url,
      github_issue_sync_status = 'synced',
      github_issue_last_synced_at = p_synced_at,
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);

  return v_task;
end;
$$;

create or replace function public.fail_github_issue_sync_transaction(
  p_task_id text,
  p_error_message text,
  p_activity_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
begin
  update public.tasks
  set github_issue_sync_status = 'failed',
      github_issue_sync_error = left(coalesce(p_error_message, 'GitHub sync failed'), 4000),
      updated_at = clock_timestamp()
  where id = p_task_id
  returning to_jsonb(tasks) into v_task;

  if v_task is null then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_activity (task_id, message)
  values (p_task_id, p_activity_message);

  return v_task;
end;
$$;

revoke all on function public.create_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.begin_github_issue_sync_transaction(text) from public, anon, authenticated;
revoke all on function public.finalize_github_issue_sync_transaction(text, text, integer, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.fail_github_issue_sync_transaction(text, text, text) from public, anon, authenticated;
grant execute on function public.create_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text) to service_role;
grant execute on function public.begin_github_issue_sync_transaction(text) to service_role;
grant execute on function public.finalize_github_issue_sync_transaction(text, text, integer, text, timestamptz, text) to service_role;
grant execute on function public.fail_github_issue_sync_transaction(text, text, text) to service_role;

comment on function public.create_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text)
is 'Atomically creates a task with its optional first relationship, activity, notifications, and audit records.';

comment on function public.finalize_github_issue_sync_transaction(text, text, integer, text, timestamptz, text)
is 'Atomically persists a successful GitHub issue sync and its activity record.';

notify pgrst, 'reload schema';

create or replace function public.update_backlog_order_transaction(
  p_updates jsonb,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_count integer;
  v_locked_count integer;
  v_before jsonb;
  v_updates jsonb;
begin
  if jsonb_typeof(p_updates) <> 'array' or jsonb_array_length(p_updates) = 0 or jsonb_array_length(p_updates) > 250 then
    raise exception using errcode = '22023', message = 'backlog updates must be a non-empty array with at most 250 entries';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_updates) as item
    where jsonb_typeof(item) <> 'object'
      or nullif(trim(item->>'id'), '') is null
      or case
        when coalesce(item->>'sortOrder', '') ~ '^\d{1,10}$'
          then (item->>'sortOrder')::numeric > 2147483647
        else true
      end
      or nullif(trim(item->>'expectedUpdatedAt'), '') is null
  ) then
    raise exception using errcode = '22023', message = 'backlog update entry is invalid';
  end if;

  select count(*) into v_expected_count from jsonb_array_elements(p_updates);
  if (
    select count(distinct item->>'id')
    from jsonb_array_elements(p_updates) as item
  ) <> v_expected_count then
    raise exception using errcode = '22023', message = 'backlog updates contain duplicate tasks';
  end if;

  perform 1
  from public.tasks as task
  join jsonb_to_recordset(p_updates) as requested(id text, "expectedUpdatedAt" timestamptz)
    on requested.id = task.id
  order by task.id
  for update of task;
  get diagnostics v_locked_count = row_count;

  if v_locked_count <> v_expected_count then
    raise exception using errcode = 'P0002', message = 'at least one task was not found';
  end if;

  if exists (
    select 1
    from public.tasks as task
    join jsonb_to_recordset(p_updates) as requested(id text, "expectedUpdatedAt" timestamptz)
      on requested.id = task.id
    where task.updated_at <> requested."expectedUpdatedAt"
  ) then
    raise exception using errcode = 'P0001', message = 'at least one task was changed concurrently';
  end if;

  select jsonb_agg(jsonb_build_object(
    'id', task.id,
    'sortOrder', task.sort_order,
    'updatedAt', task.updated_at
  ) order by task.id)
  into v_before
  from public.tasks as task
  join jsonb_to_recordset(p_updates) as requested(id text) on requested.id = task.id;

  with updated as (
    update public.tasks as task
    set sort_order = requested."sortOrder",
        updated_at = clock_timestamp()
    from jsonb_to_recordset(p_updates) as requested(id text, "sortOrder" integer)
    where task.id = requested.id
    returning task.id, task.sort_order, task.updated_at
  )
  select jsonb_agg(jsonb_build_object(
    'id', updated.id,
    'sortOrder', updated.sort_order,
    'updatedAt', updated.updated_at
  ) order by updated.sort_order, updated.id)
  into v_updates
  from updated;

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
    'task.backlog_reorder',
    'task',
    'backlog',
    jsonb_build_object('tasks', coalesce(v_before, '[]'::jsonb)),
    jsonb_build_object('updates', coalesce(v_updates, '[]'::jsonb)),
    p_request_ip,
    p_user_agent
  );

  return coalesce(v_updates, '[]'::jsonb);
end;
$$;

create or replace function public.create_sprint_plan_transaction(
  p_sprints jsonb,
  p_meetings jsonb default '[]'::jsonb,
  p_audit_data jsonb default '{}'::jsonb,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sprint jsonb;
  v_row jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_expected_updated_at timestamptz;
begin
  if jsonb_typeof(p_sprints) <> 'array' or jsonb_array_length(p_sprints) = 0 then
    raise exception using errcode = '22023', message = 'sprint plan must contain at least one sprint';
  end if;
  if jsonb_typeof(coalesce(p_meetings, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'sprint meetings must be a JSON array';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('sprint-plan', 0));

  for v_sprint in select value from jsonb_array_elements(p_sprints)
  loop
    if nullif(trim(v_sprint->>'id'), '') is null then
      raise exception using errcode = '22023', message = 'sprint id is required';
    end if;
    v_expected_updated_at := nullif(v_sprint->>'expected_updated_at', '')::timestamptz;
    v_row := null;

    if v_expected_updated_at is null then
      insert into public.sprints (
        id,
        project_id,
        name,
        status,
        start_date,
        end_date,
        review_due_at,
        score_locked
      )
      values (
        v_sprint->>'id',
        v_sprint->>'project_id',
        v_sprint->>'name',
        v_sprint->>'status',
        nullif(v_sprint->>'start_date', '')::date,
        nullif(v_sprint->>'end_date', '')::date,
        nullif(v_sprint->>'review_due_at', '')::timestamptz,
        coalesce((v_sprint->>'score_locked')::boolean, false)
      )
      on conflict (id) do nothing
      returning to_jsonb(sprints) into v_row;
    else
      update public.sprints as sprint
      set name = v_sprint->>'name',
          status = v_sprint->>'status',
          start_date = nullif(v_sprint->>'start_date', '')::date,
          end_date = nullif(v_sprint->>'end_date', '')::date,
          review_due_at = nullif(v_sprint->>'review_due_at', '')::timestamptz,
          updated_at = clock_timestamp()
      where sprint.id = v_sprint->>'id'
        and sprint.updated_at = v_expected_updated_at
        and not sprint.score_locked
        and not exists (select 1 from public.tasks where sprint_id = sprint.id)
      returning to_jsonb(sprint) into v_row;
    end if;

    if v_row is null then
      raise exception using errcode = 'P0001', message = 'sprint plan changed concurrently or contains a protected sprint';
    end if;
    v_rows := v_rows || jsonb_build_array(v_row);
  end loop;

  insert into public.meetings (
    sprint_id,
    title,
    meeting_at,
    duration_minutes,
    status,
    agenda
  )
  select
    meeting.sprint_id,
    meeting.title,
    meeting.meeting_at,
    meeting.duration_minutes,
    meeting.status,
    meeting.agenda
  from jsonb_to_recordset(coalesce(p_meetings, '[]'::jsonb)) as meeting(
    sprint_id text,
    title text,
    meeting_at timestamptz,
    duration_minutes integer,
    status text,
    agenda text
  )
  where not exists (
    select 1
    from public.meetings as existing
    where existing.sprint_id = meeting.sprint_id
      and lower(existing.title) = lower(meeting.title)
  );

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_actor_profile_id,
    'sprint.plan_create',
    'sprint',
    'bulk',
    coalesce(p_audit_data, '{}'::jsonb) || jsonb_build_object('upserted', jsonb_array_length(v_rows)),
    p_request_ip,
    p_user_agent
  );

  return v_rows;
end;
$$;

revoke all on function public.update_backlog_order_transaction(jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.create_sprint_plan_transaction(jsonb, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.update_backlog_order_transaction(jsonb, text, text, text) to service_role;
grant execute on function public.create_sprint_plan_transaction(jsonb, jsonb, jsonb, text, text, text) to service_role;

comment on function public.update_backlog_order_transaction(jsonb, text, text, text)
is 'Atomically applies a compare-and-set backlog reorder and its audit record.';

comment on function public.create_sprint_plan_transaction(jsonb, jsonb, jsonb, text, text, text)
is 'Atomically creates or updates an optimistic sprint plan with its weekly meetings and audit record.';

notify pgrst, 'reload schema';

alter table public.sprints add column if not exists lock_result jsonb;

create or replace function public.lock_sprint_transaction(
  p_sprint_id text,
  p_expected_updated_at timestamptz,
  p_task_updates jsonb default '[]'::jsonb,
  p_accepted_blocker_task_ids text[] default '{}',
  p_carryover_inserts jsonb default '[]'::jsonb,
  p_notifications jsonb default '[]'::jsonb,
  p_score_rows jsonb default '[]'::jsonb,
  p_strike_state_rows jsonb default '[]'::jsonb,
  p_strike_events jsonb default '[]'::jsonb,
  p_result_data jsonb default '{}'::jsonb,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sprint public.sprints%rowtype;
  v_result jsonb;
  v_insert jsonb;
  v_columns text;
  v_values text;
  v_allowed_columns constant text[] := array[
    'acceptance_criteria', 'assignee', 'carryover_count', 'carryover_reason',
    'carried_from_sprint_id', 'carried_from_task_id', 'created_by', 'creation_request_id',
    'deadline', 'definition_of_done', 'description', 'dod_template_version', 'end_date',
    'estimate_hours', 'evidence_link', 'evidence_required', 'github_issue_number',
    'github_issue_url', 'github_repo', 'github_issue_sync_status', 'id', 'intended_outcome',
    'issue_number', 'issue_url', 'milestone_id', 'original_sprint_id', 'owner',
    'package_id', 'parent_task_id', 'priority', 'problem_statement', 'project_id',
    'review_owner_profile_id', 'review_status', 'score_final', 'score_points',
    'score_relevant', 'scope_constraints', 'sort_order', 'sprint_id', 'start_date',
    'status', 'task_type', 'title', 'workstream'
  ];
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected sprint update timestamp is required';
  end if;
  if jsonb_typeof(coalesce(p_task_updates, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_carryover_inserts, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_score_rows, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_strike_state_rows, '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_strike_events, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'sprint finalization batches must be JSON arrays';
  end if;

  select * into v_sprint
  from public.sprints
  where id = p_sprint_id
  for update;

  if v_sprint.id is null then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint.score_locked then
    return coalesce(v_sprint.lock_result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;
  if v_sprint.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'sprint was changed concurrently';
  end if;

  update public.tasks as task
  set score_points = requested.score_points,
      score_final = requested.score_final,
      sprint_outcome = requested.sprint_outcome,
      carryover_reason = requested.carryover_reason,
      github_issue_sync_status = requested.github_issue_sync_status,
      github_issue_sync_error = requested.github_issue_sync_error,
      updated_at = clock_timestamp()
  from jsonb_to_recordset(coalesce(p_task_updates, '[]'::jsonb)) as requested(
    id text,
    score_points integer,
    score_final boolean,
    sprint_outcome text,
    carryover_reason text,
    github_issue_sync_status text,
    github_issue_sync_error text
  )
  where task.id = requested.id
    and task.sprint_id = p_sprint_id;

  update public.task_blockers
  set status = 'accepted_carryover',
      resolved_at = coalesce(resolved_at, clock_timestamp())
  where task_id = any(coalesce(p_accepted_blocker_task_ids, '{}'))
    and status = 'open';

  for v_insert in select value from jsonb_array_elements(coalesce(p_carryover_inserts, '[]'::jsonb))
  loop
    if jsonb_typeof(v_insert) <> 'object' or exists (
      select 1
      from jsonb_object_keys(v_insert) as insert_key
      where not (insert_key = any(v_allowed_columns))
    ) then
      raise exception using errcode = '22023', message = 'carryover task insert is invalid';
    end if;

    select
      string_agg(format('%I', insert_key), ', ' order by insert_key),
      string_agg(
        format('(jsonb_populate_record(null::public.tasks, $1)).%I', insert_key),
        ', '
        order by insert_key
      )
    into v_columns, v_values
    from jsonb_object_keys(v_insert) as insert_key;

    execute format(
      'insert into public.tasks (%s) select %s',
      v_columns,
      v_values
    ) using v_insert;
  end loop;

  insert into public.notification_events (
    type, actor_profile_id, recipient_profile_id, entity_type, entity_id, title, body
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

  update public.tasks
  set score_points = 0,
      score_final = true,
      sprint_outcome = 'missed_uncommunicated',
      updated_at = clock_timestamp()
  where sprint_id = p_sprint_id
    and score_final = false;

  insert into public.founder_sprint_scores (
    sprint_id, profile_id, delivery_points, form_points, weekly_points, total_points,
    fulfilled, away_neutral, finalized_at, finalized_by, reason_summary
  )
  select
    score.sprint_id, score.profile_id, score.delivery_points, score.form_points,
    score.weekly_points, score.total_points, score.fulfilled, score.away_neutral,
    score.finalized_at, score.finalized_by, score.reason_summary
  from jsonb_to_recordset(coalesce(p_score_rows, '[]'::jsonb)) as score(
    sprint_id text, profile_id text, delivery_points integer, form_points integer,
    weekly_points integer, total_points integer, fulfilled boolean, away_neutral boolean,
    finalized_at timestamptz, finalized_by text, reason_summary text
  )
  on conflict (sprint_id, profile_id) do update
  set delivery_points = excluded.delivery_points,
      form_points = excluded.form_points,
      weekly_points = excluded.weekly_points,
      total_points = excluded.total_points,
      fulfilled = excluded.fulfilled,
      away_neutral = excluded.away_neutral,
      finalized_at = excluded.finalized_at,
      finalized_by = excluded.finalized_by,
      reason_summary = excluded.reason_summary;

  insert into public.founder_strike_state (
    profile_id, strike_level, fulfilled_reset_streak, last_evaluated_sprint_id, updated_at
  )
  select
    state.profile_id, state.strike_level, state.fulfilled_reset_streak,
    state.last_evaluated_sprint_id, state.updated_at
  from jsonb_to_recordset(coalesce(p_strike_state_rows, '[]'::jsonb)) as state(
    profile_id text, strike_level integer, fulfilled_reset_streak integer,
    last_evaluated_sprint_id text, updated_at timestamptz
  )
  on conflict (profile_id) do update
  set strike_level = excluded.strike_level,
      fulfilled_reset_streak = excluded.fulfilled_reset_streak,
      last_evaluated_sprint_id = excluded.last_evaluated_sprint_id,
      updated_at = excluded.updated_at;

  insert into public.strike_events (
    profile_id, sprint_id, event_type, previous_strike_level,
    next_strike_level, reason, created_by
  )
  select
    event.profile_id, event.sprint_id, event.event_type, event.previous_strike_level,
    event.next_strike_level, event.reason, event.created_by
  from jsonb_to_recordset(coalesce(p_strike_events, '[]'::jsonb)) as event(
    profile_id text, sprint_id text, event_type text, previous_strike_level integer,
    next_strike_level integer, reason text, created_by text
  );

  v_result := coalesce(p_result_data, '{}'::jsonb) || jsonb_build_object(
    'sprint', jsonb_build_object('id', p_sprint_id, 'status', 'closed', 'scoreLocked', true),
    'replayed', false
  );

  update public.sprints
  set score_locked = true,
      status = 'closed',
      lock_result = v_result,
      updated_at = clock_timestamp()
  where id = p_sprint_id;

  insert into public.audit_log (
    actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent
  )
  values (
    p_actor_profile_id, 'sprint.lock_score', 'sprint', p_sprint_id,
    v_result, p_request_ip, p_user_agent
  );

  return v_result;
end;
$$;

revoke all on function public.lock_sprint_transaction(text, timestamptz, jsonb, text[], jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.lock_sprint_transaction(text, timestamptz, jsonb, text[], jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text) to service_role;

comment on function public.lock_sprint_transaction(text, timestamptz, jsonb, text[], jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, text, text, text)
is 'Atomically finalizes sprint tasks, carryover, scoring, strikes, notifications, audit, and the sprint lock with idempotent replay.';

notify pgrst, 'reload schema';

alter table public.task_reviews add column if not exists checklist jsonb not null default '{}'::jsonb;

create or replace function public.review_task_transaction(
  p_task_id text,
  p_sprint_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb,
  p_reviewer_profile_id text,
  p_decision text,
  p_points integer,
  p_comment text,
  p_checklist jsonb,
  p_activity_message text,
  p_notifications jsonb,
  p_audit_after_data jsonb,
  p_request_ip text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sprint_locked boolean;
  v_update_result jsonb;
  v_review jsonb;
begin
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'expected task update timestamp is required';
  end if;
  if p_decision not in ('accepted', 'partial', 'changes_requested') then
    raise exception using errcode = '22023', message = 'invalid review decision';
  end if;
  if p_points < 0 or p_points > 10 then
    raise exception using errcode = '22023', message = 'review points must be between 0 and 10';
  end if;
  if jsonb_typeof(coalesce(p_checklist, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'review checklist must be a JSON object';
  end if;
  if jsonb_typeof(coalesce(p_notifications, '[]'::jsonb)) <> 'array' then
    raise exception using errcode = '22023', message = 'review notifications must be a JSON array';
  end if;

  if p_sprint_id is not null then
    select score_locked into v_sprint_locked
    from public.sprints
    where id = p_sprint_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'sprint not found';
    end if;
    if v_sprint_locked then
      raise exception using errcode = 'P0003', message = 'sprint score is locked';
    end if;
  end if;

  v_update_result := public.update_task_transaction(
    p_task_id,
    p_expected_updated_at,
    coalesce(p_task_patch, '{}'::jsonb),
    false,
    null,
    false,
    null,
    array[p_activity_message],
    coalesce(p_notifications, '[]'::jsonb)
  );

  if (v_update_result -> 'task' ->> 'sprint_id') is distinct from p_sprint_id then
    raise exception using errcode = '22023', message = 'task sprint changed during review';
  end if;

  insert into public.task_reviews (
    task_id,
    sprint_id,
    reviewer_profile_id,
    decision,
    points,
    comment,
    checklist
  )
  values (
    p_task_id,
    p_sprint_id,
    p_reviewer_profile_id,
    p_decision,
    p_points,
    p_comment,
    coalesce(p_checklist, '{}'::jsonb)
  )
  returning to_jsonb(task_reviews) into v_review;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    after_data,
    request_ip,
    user_agent
  )
  values (
    p_reviewer_profile_id,
    'task.review',
    'task',
    p_task_id,
    coalesce(p_audit_after_data, '{}'::jsonb),
    p_request_ip,
    p_user_agent
  );

  return v_update_result || jsonb_build_object('review', v_review);
end;
$$;

revoke all on function public.review_task_transaction(text, text, timestamptz, jsonb, text, text, integer, text, jsonb, text, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.review_task_transaction(text, text, timestamptz, jsonb, text, text, integer, text, jsonb, text, jsonb, jsonb, text, text) to service_role;

comment on function public.review_task_transaction(text, text, timestamptz, jsonb, text, text, integer, text, jsonb, text, jsonb, jsonb, text, text)
is 'Atomically applies a task review with compare-and-set task state, immutable review history, activity, notification, and audit.';

notify pgrst, 'reload schema';

alter table public.score_objections
  add column if not exists resolved_delivery_points integer check (resolved_delivery_points between 0 and 12),
  add column if not exists resolved_form_points integer check (resolved_form_points between 0 and 4),
  add column if not exists resolved_weekly_points integer check (resolved_weekly_points between 0 and 4);

create or replace function public.resolve_score_objection_transaction(
  p_sprint_id text,
  p_objection_id bigint,
  p_actor_profile_id text,
  p_action text,
  p_status text default null,
  p_resolution_comment text default null,
  p_delivery_points integer default null,
  p_form_points integer default null,
  p_weekly_points integer default null,
  p_second_review_decision text default null,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sprint_locked boolean;
  v_objection public.score_objections%rowtype;
  v_before jsonb;
  v_score jsonb := null;
  v_score_id bigint;
  v_total integer;
begin
  select score_locked into v_sprint_locked
  from public.sprints
  where id = p_sprint_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'sprint not found';
  end if;
  if v_sprint_locked then
    raise exception using errcode = 'P0003', message = 'sprint score is locked';
  end if;

  select * into v_objection
  from public.score_objections
  where id = p_objection_id
    and sprint_id = p_sprint_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'score objection not found';
  end if;

  v_before := to_jsonb(v_objection);

  if p_action = 'resolve' then
    if v_objection.status <> 'open' then
      raise exception using errcode = 'P0004', message = 'score objection is already resolved';
    end if;
    if p_status not in ('reviewed', 'dismissed', 'accepted') then
      raise exception using errcode = '22023', message = 'invalid score objection status';
    end if;
    if nullif(trim(coalesce(p_resolution_comment, '')), '') is null then
      raise exception using errcode = '22023', message = 'resolution comment is required';
    end if;

    if p_status = 'accepted' then
      if p_delivery_points is null or p_delivery_points not between 0 and 12
        or p_form_points is null or p_form_points not between 0 and 4
        or p_weekly_points is null or p_weekly_points not between 0 and 4 then
        raise exception using errcode = '22023', message = 'accepted objection requires valid score components';
      end if;

      v_total := p_delivery_points + p_form_points + p_weekly_points;

      insert into public.founder_sprint_scores (
        sprint_id,
        profile_id,
        delivery_points,
        form_points,
        weekly_points,
        total_points,
        fulfilled,
        away_neutral,
        finalized_at,
        finalized_by,
        reason_summary
      )
      values (
        p_sprint_id,
        v_objection.profile_id,
        p_delivery_points,
        p_form_points,
        p_weekly_points,
        v_total,
        v_total >= 12,
        false,
        clock_timestamp(),
        p_actor_profile_id,
        format('Korrigiert nach angenommenem Score-Einwand #%s.', p_objection_id)
      )
      on conflict (sprint_id, profile_id) do update
      set delivery_points = excluded.delivery_points,
          form_points = excluded.form_points,
          weekly_points = excluded.weekly_points,
          total_points = excluded.total_points,
          fulfilled = excluded.fulfilled,
          away_neutral = excluded.away_neutral,
          finalized_at = excluded.finalized_at,
          finalized_by = excluded.finalized_by,
          reason_summary = excluded.reason_summary
      returning id, to_jsonb(founder_sprint_scores) into v_score_id, v_score;
    end if;

    update public.score_objections
    set status = p_status,
        resolution_comment = trim(p_resolution_comment),
        reviewed_by = p_actor_profile_id,
        reviewed_at = clock_timestamp(),
        founder_sprint_score_id = coalesce(v_score_id, founder_sprint_score_id),
        resolved_delivery_points = case when p_status = 'accepted' then p_delivery_points else null end,
        resolved_form_points = case when p_status = 'accepted' then p_form_points else null end,
        resolved_weekly_points = case when p_status = 'accepted' then p_weekly_points else null end
    where id = p_objection_id
    returning * into v_objection;
  elsif p_action = 'second_review' then
    if v_objection.status = 'open' or v_objection.reviewed_by is null then
      raise exception using errcode = 'P0004', message = 'score objection must be resolved before second review';
    end if;
    if v_objection.second_reviewed_at is not null then
      raise exception using errcode = 'P0006', message = 'second review is already complete';
    end if;
    if v_objection.reviewed_by = p_actor_profile_id then
      raise exception using errcode = 'P0005', message = 'second reviewer must differ from first reviewer';
    end if;
    if nullif(trim(coalesce(p_second_review_decision, '')), '') is null then
      raise exception using errcode = '22023', message = 'second review decision is required';
    end if;

    update public.score_objections
    set second_reviewer_profile_id = p_actor_profile_id,
        second_review_decision = trim(p_second_review_decision),
        second_reviewed_at = clock_timestamp()
    where id = p_objection_id
    returning * into v_objection;

    if v_objection.founder_sprint_score_id is not null then
      select to_jsonb(score) into v_score
      from public.founder_sprint_scores as score
      where id = v_objection.founder_sprint_score_id;
    end if;
  else
    raise exception using errcode = '22023', message = 'invalid score objection action';
  end if;

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
    case when p_action = 'second_review' then 'score_objection.second_review' else 'score_objection.review' end,
    'score_objection',
    p_objection_id::text,
    v_before,
    to_jsonb(v_objection),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'objection', to_jsonb(v_objection),
    'score', v_score
  );
end;
$$;

revoke all on function public.resolve_score_objection_transaction(text, bigint, text, text, text, text, integer, integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_score_objection_transaction(text, bigint, text, text, text, text, integer, integer, integer, text, text, text) to service_role;

comment on function public.resolve_score_objection_transaction(text, bigint, text, text, text, text, integer, integer, integer, text, text, text)
is 'Atomically resolves score objections, persists accepted score corrections, and enforces one independent second review.';

notify pgrst, 'reload schema';

drop policy if exists "task_relationship_edges_write_founders" on public.task_relationship_edges;
drop policy if exists "task_relationship_edges_insert_authorized" on public.task_relationship_edges;
drop policy if exists "task_relationship_edges_update_operational" on public.task_relationship_edges;
drop policy if exists "task_relationship_edges_delete_authorized" on public.task_relationship_edges;

create policy "task_relationship_edges_insert_authorized"
on public.task_relationship_edges for insert to authenticated
with check (
  public.current_platform_role() in ('ceo', 'deputy')
  or (
    public.current_platform_role() = 'founder'
    and relation_type = 'blocked_by'
    and created_by = public.current_profile_id()
    and exists (
      select 1
      from public.tasks as task
      left join public.packages as initiative on initiative.id = task.package_id
      where task.id = task_relationship_edges.task_id
        and task.task_type in ('deliverable', 'sub_issue')
        and (
          task.assignee = public.current_profile_id()
          or task.owner = public.current_profile_id()
          or coalesce(initiative.accountable_profile_id, initiative.owner_id) = public.current_profile_id()
        )
    )
  )
);

create policy "task_relationship_edges_update_operational"
on public.task_relationship_edges for update to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

create policy "task_relationship_edges_delete_authorized"
on public.task_relationship_edges for delete to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or (
    public.current_platform_role() = 'founder'
    and relation_type = 'blocked_by'
    and exists (
      select 1
      from public.tasks as task
      left join public.packages as initiative on initiative.id = task.package_id
      where task.id = task_relationship_edges.task_id
        and task.task_type in ('deliverable', 'sub_issue')
        and (
          task.assignee = public.current_profile_id()
          or task.owner = public.current_profile_id()
          or coalesce(initiative.accountable_profile_id, initiative.owner_id) = public.current_profile_id()
        )
    )
  )
);

notify pgrst, 'reload schema';

alter table public.team_task_intake_batches
  add column if not exists response_tasks jsonb not null default '[]'::jsonb;

update public.team_task_intake_batches as batch
set response_tasks = coalesce((
  select jsonb_agg(to_jsonb(task_row) order by requested.ordinality)
  from unnest(batch.task_ids) with ordinality as requested(task_id, ordinality)
  join public.tasks as task_row on task_row.id = requested.task_id
), '[]'::jsonb)
where batch.response_tasks = '[]'::jsonb
  and cardinality(batch.task_ids) > 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'team_task_intake_batches_response_tasks_check'
      and conrelid = 'public.team_task_intake_batches'::regclass
  ) then
    alter table public.team_task_intake_batches
      add constraint team_task_intake_batches_response_tasks_check
      check (jsonb_typeof(response_tasks) = 'array');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'team_task_intake_tokens_max_expiry_check'
      and conrelid = 'public.team_task_intake_tokens'::regclass
  ) then
    alter table public.team_task_intake_tokens
      add constraint team_task_intake_tokens_max_expiry_check
      check (expires_at <= created_at + interval '90 days');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'team_task_intake_tokens_id_profile_unique'
      and conrelid = 'public.team_task_intake_tokens'::regclass
  ) then
    alter table public.team_task_intake_tokens
      add constraint team_task_intake_tokens_id_profile_unique unique (id, profile_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'team_task_intake_batches_token_profile_fk'
      and conrelid = 'public.team_task_intake_batches'::regclass
  ) then
    alter table public.team_task_intake_batches
      add constraint team_task_intake_batches_token_profile_fk
      foreign key (token_id, profile_id)
      references public.team_task_intake_tokens(id, profile_id)
      on delete restrict;
  end if;
end
$$;

drop index if exists public.team_task_intake_batches_token_id_idx;

create or replace function public.create_team_task_intake_token(
  p_profile_id text,
  p_label text,
  p_token_hash text,
  p_token_hint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_count integer;
  v_token public.team_task_intake_tokens%rowtype;
begin
  if nullif(trim(coalesce(p_profile_id, '')), '') is null
     or char_length(trim(coalesce(p_label, ''))) not between 1 and 80
     or coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or char_length(coalesce(p_token_hint, '')) not between 4 and 16 then
    raise exception using errcode = '22023', message = 'team intake token input is invalid';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_profile_id
      and platform_role in ('ceo', 'deputy', 'founder')
  ) then
    raise exception using errcode = 'P0002', message = 'operational profile not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('team-intake-token:' || p_profile_id, 0));

  select count(*)
  into v_active_count
  from public.team_task_intake_tokens
  where profile_id = p_profile_id
    and revoked_at is null
    and expires_at > now();

  if v_active_count >= 3 then
    raise exception using errcode = 'P0003', message = 'active team intake token limit reached';
  end if;

  insert into public.team_task_intake_tokens (
    profile_id,
    label,
    token_hash,
    token_hint,
    expires_at
  ) values (
    p_profile_id,
    trim(p_label),
    p_token_hash,
    p_token_hint,
    now() + interval '90 days'
  )
  returning * into v_token;

  return to_jsonb(v_token) - 'token_hash';
end;
$$;

create or replace function public.authenticate_team_task_intake_token(
  p_token_hash text,
  p_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_profile public.profiles%rowtype;
begin
  if coalesce(p_token_hash, '') !~ '^[a-f0-9]{64}$'
     or p_scope not in ('read:task-context', 'write:task-intake') then
    raise exception using errcode = '22023', message = 'team intake authentication input is invalid';
  end if;

  select *
  into v_token
  from public.team_task_intake_tokens
  where token_hash = p_token_hash
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'team intake token is inactive';
  end if;
  if not (p_scope = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'team intake scope is missing';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = v_token.profile_id
  for share;

  if not found or v_profile.platform_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'team intake profile role is not allowed';
  end if;

  update public.team_task_intake_tokens
  set last_used_at = now()
  where id = v_token.id;

  return jsonb_build_object(
    'tokenId', v_token.id,
    'scopes', v_token.scopes,
    'profile', jsonb_build_object(
      'id', v_profile.id,
      'name', v_profile.name,
      'platformRole', v_profile.platform_role,
      'githubLogin', coalesce(v_profile.github_login, '')
    )
  );
end;
$$;

create or replace function public.revoke_team_task_intake_token(
  p_token_id uuid,
  p_profile_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_id uuid;
begin
  update public.team_task_intake_tokens
  set revoked_at = now()
  where id = p_token_id
    and profile_id = p_profile_id
    and revoked_at is null
  returning id into v_token_id;

  return v_token_id;
end;
$$;

create or replace function public.create_team_task_intake_batch_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_items jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_item_keys constant text[] := array[
    'acceptanceCriteria',
    'deadline',
    'definitionOfDone',
    'description',
    'endDate',
    'evidenceRequired',
    'hours',
    'intendedOutcome',
    'milestoneId',
    'ownerId',
    'packageId',
    'parentTaskId',
    'priority',
    'problemStatement',
    'scopeConstraints',
    'startDate',
    'status',
    'taskType',
    'title',
    'workstream'
  ];
  v_batch public.team_task_intake_batches%rowtype;
  v_token public.team_task_intake_tokens%rowtype;
  v_profile_role text;
  v_parent public.tasks%rowtype;
  v_item jsonb;
  v_item_index integer;
  v_item_count integer;
  v_task_type text;
  v_task_id text;
  v_creation_request_id text;
  v_owner_id text;
  v_package_id text;
  v_milestone_id text;
  v_package_milestone_id text;
  v_status text;
  v_priority text;
  v_task_insert jsonb;
  v_notifications jsonb;
  v_result jsonb;
  v_task jsonb;
  v_task_ids text[] := array[]::text[];
  v_tasks jsonb := '[]'::jsonb;
begin
  if p_token_id is null
     or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_idempotency_key is null
     or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception using errcode = '22023', message = 'team intake batch input is invalid';
  end if;

  select *
  into v_token
  from public.team_task_intake_tokens
  where id = p_token_id
    and profile_id = p_profile_id
    and revoked_at is null
    and expires_at > now()
  for update;

  if not found then
    raise exception using errcode = 'P0004', message = 'team intake token is inactive';
  end if;
  if not ('write:task-intake' = any(v_token.scopes)) then
    raise exception using errcode = 'P0005', message = 'team intake write scope is missing';
  end if;

  select platform_role
  into v_profile_role
  from public.profiles
  where id = p_profile_id
  for share;

  if not found or v_profile_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'team intake profile role is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('team-intake-batch:' || p_token_id::text || ':' || p_idempotency_key::text, 0));

  select *
  into v_batch
  from public.team_task_intake_batches
  where token_id = p_token_id
    and idempotency_key = p_idempotency_key;

  if found then
    if v_batch.request_hash <> p_request_hash then
      raise exception using errcode = 'P0003', message = 'idempotency key was reused with different team intake data';
    end if;
    return jsonb_build_object(
      'batchId', v_batch.id,
      'replayed', true,
      'tasks', v_batch.response_tasks
    );
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'team intake items must be an array';
  end if;
  v_item_count := jsonb_array_length(p_items);
  if v_item_count < 1 or v_item_count > 30 then
    raise exception using errcode = '22023', message = 'team intake batch size is invalid';
  end if;

  for v_item, v_item_index in
    select value, ordinality::integer
    from jsonb_array_elements(p_items) with ordinality
  loop
    if jsonb_typeof(v_item) <> 'object'
       or exists (
         select 1
         from jsonb_object_keys(v_item) as item_key
         where not (item_key = any(v_allowed_item_keys))
       ) then
      raise exception using errcode = '22023', message = 'team intake item is invalid';
    end if;

    v_task_type := nullif(trim(v_item->>'taskType'), '');
    if v_task_type not in ('proposal', 'sub_issue')
       or char_length(trim(coalesce(v_item->>'title', ''))) not between 3 and 240 then
      raise exception using errcode = '22023', message = 'team intake task type or title is invalid';
    end if;

    v_owner_id := nullif(trim(v_item->>'ownerId'), '');
    if v_owner_id is not null and not exists (select 1 from public.profiles where id = v_owner_id) then
      raise exception using errcode = 'P0002', message = 'team intake owner profile not found';
    end if;

    v_task_id := p_profile_id || '-team-intake-' || replace(p_token_id::text, '-', '') || '-' || replace(p_idempotency_key::text, '-', '') || '-' || v_item_index::text;
    v_creation_request_id := 'team:' || p_token_id::text || ':' || p_idempotency_key::text || ':' || v_item_index::text;
    v_package_id := nullif(trim(v_item->>'packageId'), '');
    v_milestone_id := nullif(trim(v_item->>'milestoneId'), '');

    if v_task_type = 'proposal' then
      if v_package_id is not null then
        select milestone_id into v_package_milestone_id
        from public.packages
        where id = v_package_id;
        if not found then
          raise exception using errcode = 'P0002', message = 'team intake initiative not found';
        end if;
        v_milestone_id := coalesce(v_milestone_id, v_package_milestone_id);
      end if;
      if v_milestone_id is not null and not exists (select 1 from public.milestones where id = v_milestone_id) then
        raise exception using errcode = 'P0002', message = 'team intake milestone not found';
      end if;
      v_status := 'Vorschlag';
    else
      select *
      into v_parent
      from public.tasks
      where id = nullif(trim(v_item->>'parentTaskId'), '')
        and task_type = 'deliverable'
      for share;

      if not found then
        raise exception using errcode = 'P0002', message = 'team intake parent deliverable not found';
      end if;
      if v_profile_role = 'founder' and coalesce(v_parent.assignee, v_parent.owner, '') <> p_profile_id then
        raise exception using errcode = 'P0006', message = 'founder may refine only own deliverables';
      end if;
      v_package_id := v_parent.package_id;
      v_milestone_id := v_parent.milestone_id;
      v_owner_id := coalesce(v_owner_id, p_profile_id);
      v_status := nullif(trim(v_item->>'status'), '');
      if v_status not in ('Offen', 'In Arbeit', 'Review', 'Nacharbeit', 'Blockiert', 'Erledigt') then
        v_status := 'Offen';
      end if;
    end if;

    v_priority := nullif(trim(v_item->>'priority'), '');
    if v_priority not in ('P0', 'P1', 'P2', 'P3', 'P4') then
      v_priority := 'P2';
    end if;

    v_task_insert := jsonb_build_object(
      'id', v_task_id,
      'creation_request_id', v_creation_request_id,
      'project_id', 'findmydoc-founder-execution',
      'title', trim(v_item->>'title'),
      'description', coalesce(v_item->>'description', ''),
      'problem_statement', coalesce(v_item->>'problemStatement', ''),
      'intended_outcome', coalesce(v_item->>'intendedOutcome', ''),
      'scope_constraints', coalesce(v_item->>'scopeConstraints', ''),
      'acceptance_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
      'evidence_required', coalesce(v_item->>'evidenceRequired', ''),
      'definition_of_done', coalesce(v_item->>'definitionOfDone', ''),
      'status', v_status,
      'priority', v_priority,
      'owner', v_owner_id,
      'assignee', v_owner_id,
      'created_by', p_profile_id,
      'workstream', coalesce(v_item->>'workstream', ''),
      'sort_order', 0,
      'start_date', nullif(v_item->>'startDate', ''),
      'end_date', nullif(v_item->>'endDate', ''),
      'deadline', nullif(v_item->>'deadline', ''),
      'estimate_hours', greatest(0, least(200, coalesce((v_item->>'hours')::integer, 0))),
      'package_id', v_package_id,
      'milestone_id', v_milestone_id,
      'sprint_id', null,
      'review_owner_profile_id', null,
      'score_points', 0,
      'score_final', false,
      'task_type', v_task_type,
      'parent_task_id', case when v_task_type = 'sub_issue' then v_parent.id else null end,
      'score_relevant', false
    );

    if v_task_type = 'proposal' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'type', 'task.proposed',
        'actor_profile_id', p_profile_id,
        'recipient_profile_id', lead.id,
        'entity_type', 'task',
        'entity_id', v_task_id,
        'title', 'Aufgabenvorschlag: ' || trim(v_item->>'title'),
        'body', coalesce(nullif(v_item->>'description', ''), 'Ein neuer Aufgabenvorschlag wurde über Team Intake eingereicht.')
      )), '[]'::jsonb)
      into v_notifications
      from public.profiles as lead
      where lead.platform_role in ('ceo', 'deputy')
        and lead.id <> p_profile_id;
    else
      v_notifications := '[]'::jsonb;
    end if;

    v_result := public.create_task_transaction(
      v_task_insert,
      null,
      null,
      null,
      case when v_task_type = 'proposal'
        then 'Aufgabenvorschlag über Team Intake erstellt'
        else 'Sub-Issue über Team Intake erstellt'
      end,
      null,
      v_notifications,
      p_profile_id,
      p_request_ip,
      p_user_agent
    );
    v_task := v_result->'task';
    if v_task is null or nullif(v_task->>'id', '') is null then
      raise exception using errcode = 'P0001', message = 'team intake task creation returned no task';
    end if;
    v_task_ids := array_append(v_task_ids, v_task->>'id');
    v_tasks := v_tasks || jsonb_build_array(v_task);
  end loop;

  insert into public.team_task_intake_batches (
    token_id,
    profile_id,
    idempotency_key,
    request_hash,
    task_ids,
    response_tasks
  ) values (
    p_token_id,
    p_profile_id,
    p_idempotency_key,
    p_request_hash,
    v_task_ids,
    v_tasks
  )
  returning * into v_batch;

  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    after_data,
    request_ip,
    user_agent
  ) values (
    p_profile_id,
    'team.task_intake.commit',
    'team_task_intake_batch',
    v_batch.id::text,
    jsonb_build_object('tokenId', p_token_id, 'taskIds', v_task_ids),
    p_request_ip,
    p_user_agent
  );

  return jsonb_build_object(
    'batchId', v_batch.id,
    'replayed', false,
    'tasks', v_tasks
  );
end;
$$;

revoke all on table public.team_task_intake_tokens from public, anon, authenticated;
revoke all on table public.team_task_intake_batches from public, anon, authenticated;
revoke insert, update, delete on table public.team_task_intake_tokens from service_role;
revoke insert, update, delete on table public.team_task_intake_batches from service_role;
grant select on table public.team_task_intake_tokens to service_role;
grant select on table public.team_task_intake_batches to service_role;

revoke all on function public.create_team_task_intake_token(text, text, text, text) from public, anon, authenticated;
revoke all on function public.authenticate_team_task_intake_token(text, text) from public, anon, authenticated;
revoke all on function public.revoke_team_task_intake_token(uuid, text) from public, anon, authenticated;
revoke all on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.create_team_task_intake_token(text, text, text, text) to service_role;
grant execute on function public.authenticate_team_task_intake_token(text, text) to service_role;
grant execute on function public.revoke_team_task_intake_token(uuid, text) to service_role;
grant execute on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text) to service_role;

comment on column public.team_task_intake_batches.response_tasks
is 'Immutable task-row snapshots returned for deterministic idempotent replays.';

comment on function public.authenticate_team_task_intake_token(text, text)
is 'Atomically validates a personal token, current profile role and scope while recording last use.';

comment on function public.revoke_team_task_intake_token(uuid, text)
is 'Revokes one active personal Team Task Intake token owned by the current profile.';

comment on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text)
is 'Atomically revalidates Team Task Intake authority and creates a token-scoped deterministic replayable batch from a narrow intent.';

create table if not exists public.task_comment_github_deliveries (
  task_comment_id bigint primary key references public.task_comments(id) on delete cascade,
  task_id text not null references public.tasks(id) on delete cascade,
  author_profile_id text,
  github_issue_number integer,
  status text not null default 'pending'
    check (status in ('pending', 'waiting_for_issue', 'waiting_for_author_connection', 'processing', 'retry_scheduled', 'delivered', 'failed')),
  status_reason text,
  attempts integer not null default 0 check (attempts >= 0),
  last_attempted_at timestamptz,
  next_attempt_at timestamptz,
  github_comment_id bigint,
  github_comment_url text,
  locked_at timestamptz,
  lock_token text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_comment_github_deliveries_task_status_idx
  on public.task_comment_github_deliveries(task_id, status, next_attempt_at);
create index if not exists task_comment_github_deliveries_author_status_idx
  on public.task_comment_github_deliveries(author_profile_id, status, next_attempt_at);

alter table public.task_comment_github_deliveries enable row level security;
revoke all on public.task_comment_github_deliveries from public, anon, authenticated;
grant select, insert, update, delete on public.task_comment_github_deliveries to service_role;

comment on table public.task_comment_github_deliveries is
  'Transactional outbox for author-attributed GitHub comments. Tokens never leave the server-side GitHub App vault.';

create or replace function public.create_task_comment_with_github_delivery(
  p_task_id text,
  p_profile_id text,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_comment public.task_comments%rowtype;
  v_status text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_comments (task_id, profile_id, comment)
  values (p_task_id, nullif(p_profile_id, ''), p_comment)
  returning * into v_comment;

  v_status := case
    when v_task.github_issue_number is null and coalesce(trim(v_task.issue_number), '') !~ '^[1-9][0-9]*$' then 'waiting_for_issue'
    when nullif(p_profile_id, '') is null then 'waiting_for_author_connection'
    else 'pending'
  end;

  insert into public.task_comment_github_deliveries (
    task_comment_id,
    task_id,
    author_profile_id,
    github_issue_number,
    status,
    status_reason
  ) values (
    v_comment.id,
    p_task_id,
    nullif(p_profile_id, ''),
    coalesce(
      v_task.github_issue_number,
      case when coalesce(trim(v_task.issue_number), '') ~ '^[1-9][0-9]*$' then trim(v_task.issue_number)::integer end
    ),
    v_status,
    case
      when v_status = 'waiting_for_issue' then 'github_issue_missing'
      when v_status = 'waiting_for_author_connection' then 'author_profile_missing'
      else null
    end
  );

  insert into public.task_activity (task_id, message)
  values (p_task_id, 'Kommentar hinzugefügt: ' || left(p_comment, 160));

  return jsonb_build_object(
    'comment', to_jsonb(v_comment),
    'deliveryStatus', v_status
  );
end;
$$;

create or replace function public.claim_task_comment_github_deliveries(
  p_lock_token text,
  p_task_id text default null,
  p_author_profile_id text default null,
  p_limit integer default 20,
  p_lease_seconds integer default 120
)
returns table (
  task_comment_id bigint,
  task_id text,
  author_profile_id text,
  github_issue_number integer,
  status text,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select delivery.task_comment_id
    from public.task_comment_github_deliveries delivery
    where (p_task_id is null or delivery.task_id = p_task_id)
      and (p_author_profile_id is null or delivery.author_profile_id = p_author_profile_id)
      and (
        delivery.status in ('pending', 'waiting_for_issue', 'waiting_for_author_connection', 'retry_scheduled', 'failed')
        or (delivery.status = 'processing' and delivery.locked_at <= now() - make_interval(secs => greatest(30, p_lease_seconds)))
      )
      and (delivery.next_attempt_at is null or delivery.next_attempt_at <= now())
    order by delivery.created_at, delivery.task_comment_id
    for update skip locked
    limit greatest(1, least(p_limit, 100))
  )
  update public.task_comment_github_deliveries delivery
  set status = 'processing',
      lock_token = p_lock_token,
      locked_at = now(),
      last_attempted_at = now(),
      updated_at = now()
  from candidates
  where delivery.task_comment_id = candidates.task_comment_id
  returning delivery.task_comment_id, delivery.task_id, delivery.author_profile_id,
    delivery.github_issue_number, delivery.status, delivery.attempts;
end;
$$;

create or replace function public.finalize_task_comment_github_delivery(
  p_task_comment_id bigint,
  p_lock_token text,
  p_status text,
  p_status_reason text default null,
  p_github_issue_number integer default null,
  p_github_comment_id bigint default null,
  p_github_comment_url text default null,
  p_last_error text default null,
  p_next_attempt_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated bigint;
begin
  if p_status not in ('pending', 'waiting_for_issue', 'waiting_for_author_connection', 'retry_scheduled', 'delivered', 'failed') then
    raise exception using errcode = '22023', message = 'invalid github comment delivery status';
  end if;

  update public.task_comment_github_deliveries
  set status = p_status,
      status_reason = p_status_reason,
      github_issue_number = coalesce(p_github_issue_number, github_issue_number),
      github_comment_id = coalesce(p_github_comment_id, github_comment_id),
      github_comment_url = coalesce(p_github_comment_url, github_comment_url),
      attempts = attempts + case when p_status in ('retry_scheduled', 'delivered', 'failed') then 1 else 0 end,
      last_error = case when p_status in ('retry_scheduled', 'failed') then left(p_last_error, 4000) else null end,
      next_attempt_at = p_next_attempt_at,
      delivered_at = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      lock_token = null,
      locked_at = null,
      updated_at = now()
  where task_comment_id = p_task_comment_id
    and lock_token = p_lock_token;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.create_task_comment_with_github_delivery(text, text, text) from public, anon, authenticated;
revoke all on function public.claim_task_comment_github_deliveries(text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.finalize_task_comment_github_delivery(bigint, text, text, text, integer, bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.create_task_comment_with_github_delivery(text, text, text) to service_role;
grant execute on function public.claim_task_comment_github_deliveries(text, text, text, integer, integer) to service_role;
grant execute on function public.finalize_task_comment_github_delivery(bigint, text, text, text, integer, bigint, text, text, timestamptz) to service_role;

insert into public.task_comment_github_deliveries (
  task_comment_id,
  task_id,
  author_profile_id,
  github_issue_number,
  status,
  status_reason
)
select
  comment.id,
  comment.task_id,
  comment.profile_id,
  coalesce(
    task.github_issue_number,
    case when coalesce(trim(task.issue_number), '') ~ '^[1-9][0-9]*$' then trim(task.issue_number)::integer end
  ),
  case
    when task.github_issue_number is null and coalesce(trim(task.issue_number), '') !~ '^[1-9][0-9]*$' then 'waiting_for_issue'
    when comment.profile_id is null then 'waiting_for_author_connection'
    else 'pending'
  end,
  case
    when task.github_issue_number is null and coalesce(trim(task.issue_number), '') !~ '^[1-9][0-9]*$' then 'github_issue_missing'
    when comment.profile_id is null then 'author_profile_missing'
    else 'legacy_reconciliation'
  end
from public.task_comments comment
join public.tasks task on task.id = comment.task_id
on conflict (task_comment_id) do nothing;

notify pgrst, 'reload schema';

-- Planning item approval lifecycle. Keep synchronized with 0059_planning_item_approval.sql.
alter table public.packages add column if not exists approval_status text;
alter table public.packages add column if not exists approval_revision integer not null default 1;
alter table public.packages add column if not exists proposed_by text references public.profiles(id) on delete set null;
alter table public.packages add column if not exists proposed_at timestamptz;
alter table public.packages add column if not exists decided_by text references public.profiles(id) on delete set null;
alter table public.packages add column if not exists decided_at timestamptz;
alter table public.packages add column if not exists decision_note text;

alter table public.tasks add column if not exists approval_status text;
alter table public.tasks add column if not exists approval_revision integer not null default 1;
alter table public.tasks add column if not exists proposed_by text references public.profiles(id) on delete set null;
alter table public.tasks add column if not exists proposed_at timestamptz;
alter table public.tasks add column if not exists decided_by text references public.profiles(id) on delete set null;
alter table public.tasks add column if not exists decided_at timestamptz;
alter table public.tasks add column if not exists decision_note text;

update public.packages
set approval_status = coalesce(approval_status, 'approved'),
    approval_revision = greatest(approval_revision, 1),
    decided_at = coalesce(decided_at, now())
where approval_status is null or approval_revision < 1;

update public.tasks as child
set task_type = 'sub_issue',
    status = case when child.status = 'Vorschlag' then 'Offen' else child.status end,
    package_id = parent.package_id,
    milestone_id = parent.milestone_id,
    sprint_id = null,
    score_relevant = false,
    approval_status = null
from public.tasks as parent
where child.task_type = 'proposal'
  and child.parent_task_id = parent.id
  and parent.task_type = 'deliverable';

update public.tasks
set task_type = 'deliverable',
    status = case when status = 'Vorschlag' then 'Offen' else status end,
    approval_status = 'proposed',
    approval_revision = greatest(approval_revision, 1),
    proposed_at = coalesce(proposed_at, now()),
    sprint_id = null,
    score_relevant = false
where task_type = 'proposal'
  and package_id is not null
  and exists (select 1 from public.packages where packages.id = tasks.package_id);

update public.tasks
set approval_status = case
      when task_type = 'sub_issue' then null
      when task_type = 'proposal' then 'proposed'
      else coalesce(approval_status, 'approved')
    end,
    approval_revision = greatest(approval_revision, 1),
    proposed_at = case when task_type = 'proposal' then coalesce(proposed_at, now()) else proposed_at end,
    sprint_id = case when task_type in ('proposal', 'sub_issue') then null else sprint_id end,
    score_relevant = task_type = 'deliverable'
      and coalesce(approval_status, 'approved') = 'approved'
      and sprint_id is not null;

update public.tasks
set github_repo = 'findmydoc-platform/management'
where task_type <> 'sub_issue'
  or github_repo is null
  or trim(github_repo) = '';

alter table public.packages alter column approval_status set default 'proposed';
alter table public.packages alter column approval_status set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'packages_approval_status_check') then
    alter table public.packages add constraint packages_approval_status_check
      check (approval_status in ('draft', 'proposed', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'packages_approval_revision_check') then
    alter table public.packages add constraint packages_approval_revision_check check (approval_revision >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_approval_status_by_type_check') then
    alter table public.tasks add constraint tasks_approval_status_by_type_check check (
      (task_type = 'sub_issue' and approval_status is null)
      or (task_type in ('deliverable', 'proposal') and approval_status in ('draft', 'proposed', 'approved', 'rejected'))
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_approval_revision_check') then
    alter table public.tasks add constraint tasks_approval_revision_check check (approval_revision >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_approval_sprint_check') then
    alter table public.tasks add constraint tasks_approval_sprint_check check (
      task_type = 'deliverable' and approval_status = 'approved'
      or sprint_id is null
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_score_relevance_approval_check') then
    alter table public.tasks add constraint tasks_score_relevance_approval_check check (
      score_relevant = (
        task_type = 'deliverable'
        and approval_status = 'approved'
        and sprint_id is not null
      )
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tasks_github_repo_allowed_check') then
    alter table public.tasks add constraint tasks_github_repo_allowed_check check (
      (task_type = 'sub_issue' and github_repo in ('findmydoc-platform/management', 'findmydoc-platform/website', 'findmydoc-platform/clinic-dashboard'))
      or (task_type in ('deliverable', 'proposal') and github_repo = 'findmydoc-platform/management')
    );
  end if;
end
$$;

create index if not exists packages_approval_status_idx on public.packages(approval_status);
create index if not exists tasks_approval_status_idx on public.tasks(approval_status);
create or replace function public.normalize_task_approval_state()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_actor_profile_id text := nullif(current_setting('app.actor_profile_id', true), '');
  v_material_change boolean := false;
  v_parent public.tasks%rowtype;
begin
  if new.task_type = 'sub_issue' then
    if new.parent_task_id is null then
      raise exception using errcode = '23514', message = 'sub-issue requires a parent deliverable';
    end if;
    select * into v_parent from public.tasks where id = new.parent_task_id;
    if not found or v_parent.task_type <> 'deliverable' then
      raise exception using errcode = '23514', message = 'sub-issue parent must be a deliverable';
    end if;
    new.package_id := v_parent.package_id;
    new.milestone_id := v_parent.milestone_id;
    new.approval_status := null;
    new.sprint_id := null;
    new.score_relevant := false;
    return new;
  end if;

  if new.approval_status is null then
    new.approval_status := 'proposed';
  end if;

  new.github_repo := 'findmydoc-platform/management';

  if tg_op = 'UPDATE' and old.task_type = 'deliverable' then
    v_material_change :=
      new.package_id is distinct from old.package_id
      or new.title is distinct from old.title
      or new.problem_statement is distinct from old.problem_statement
      or new.intended_outcome is distinct from old.intended_outcome
      or new.scope_constraints is distinct from old.scope_constraints
      or new.acceptance_criteria is distinct from old.acceptance_criteria
      or new.definition_of_done is distinct from old.definition_of_done;
    if v_material_change then
      new.approval_status := 'proposed';
      new.approval_revision := old.approval_revision + 1;
      new.proposed_by := v_actor_profile_id;
      new.proposed_at := now();
      new.decided_by := null;
      new.decided_at := null;
      new.decision_note := null;
      new.sprint_id := null;
      new.review_status := 'not_requested';
      new.review_requested_at := null;
      new.score_points := 0;
      new.score_final := false;
      insert into public.task_activity (task_id, message)
      values (new.id, case old.approval_status
        when 'approved' then 'Materielle Änderung: neue Freigabe erforderlich'
        when 'proposed' then 'Freigabeantrag mit neuer Revision aktualisiert'
        else 'Deliverable erneut zur Freigabe eingereicht' end);
      insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
      values (v_actor_profile_id,
        case old.approval_status
          when 'approved' then 'task.approval_reset'
          when 'proposed' then 'task.approval_revised'
          else 'task.approval_resubmitted' end,
        'task', new.id,
        jsonb_build_object('approvalStatus', old.approval_status, 'revision', old.approval_revision),
        jsonb_build_object('approvalStatus', 'proposed', 'revision', new.approval_revision));
    end if;
  end if;

  if new.approval_status <> 'approved' then
    new.sprint_id := null;
    new.score_relevant := false;
  else
    new.score_relevant := new.sprint_id is not null;
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_normalize_approval_state on public.tasks;
create trigger tasks_normalize_approval_state
before insert or update on public.tasks
for each row execute function public.normalize_task_approval_state();

create or replace function public.decide_initiative_approval_transaction(
  p_initiative_id text,
  p_expected_revision integer,
  p_action text,
  p_actor_profile_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_initiative public.packages%rowtype;
  v_actor_role text;
  v_next_status text;
  v_before_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_notification_recipient_id text;
begin
  if p_action not in ('approve', 'reject', 'return_to_draft') or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'initiative approval input is invalid';
  end if;
  if char_length(v_note) > 2000 then
    raise exception using errcode = '22023', message = 'approval decision note exceeds 2000 characters';
  end if;
  if p_action in ('reject', 'return_to_draft') and v_note is null then
    raise exception using errcode = '22023', message = 'approval decision note is required';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then raise exception using errcode = 'P0006', message = 'approval actor not found'; end if;

  select * into v_initiative from public.packages where id = p_initiative_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'initiative not found'; end if;
  if v_initiative.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'initiative approval revision changed';
  end if;
  if v_initiative.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'initiative is not proposed';
  end if;

  if p_action in ('approve', 'reject') and v_actor_role <> 'ceo' then
    raise exception using errcode = 'P0006', message = 'only ceo may decide initiative approval';
  end if;
  if p_action = 'return_to_draft' and v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'initiative may only be returned by operational lead';
  end if;
  v_before_status := v_initiative.approval_status;
  v_notification_recipient_id := v_initiative.proposed_by;
  v_next_status := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'draft' end;
  update public.packages
  set approval_status = v_next_status,
      approval_revision = approval_revision + 1,
      decided_by = case when p_action in ('approve', 'reject') then p_actor_profile_id else null end,
      decided_at = case when p_action in ('approve', 'reject') then now() else null end,
      decision_note = v_note
  where id = p_initiative_id
  returning * into v_initiative;

  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'initiative.approval_' || p_action, 'initiative', p_initiative_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_initiative.approval_revision, 'note', v_note));

  if p_action = 'return_to_draft' and v_notification_recipient_id is not null then
    insert into public.notification_events (
      type,
      actor_profile_id,
      recipient_profile_id,
      entity_type,
      entity_id,
      title,
      body,
      dedupe_key
    ) values (
      'planning_item.returned',
      p_actor_profile_id,
      v_notification_recipient_id,
      'initiative',
      p_initiative_id,
      'Initiative zur Überarbeitung: ' || v_initiative.title,
      'Begründung: ' || v_note,
      'planning-item-returned:initiative:' || p_initiative_id || ':' || v_initiative.approval_revision
    );
  end if;

  return to_jsonb(v_initiative);
end;
$$;

create or replace function public.decide_deliverable_approval_transaction(
  p_task_id text,
  p_expected_revision integer,
  p_action text,
  p_actor_profile_id text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.tasks%rowtype;
  v_initiative public.packages%rowtype;
  v_actor_role text;
  v_next_status text;
  v_before_status text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_notification_recipient_id text;
begin
  if p_action not in ('approve', 'reject', 'return_to_draft') or p_expected_revision < 1 then
    raise exception using errcode = '22023', message = 'deliverable approval input is invalid';
  end if;
  if char_length(v_note) > 2000 then
    raise exception using errcode = '22023', message = 'approval decision note exceeds 2000 characters';
  end if;
  if p_action in ('reject', 'return_to_draft') and v_note is null then
    raise exception using errcode = '22023', message = 'approval decision note is required';
  end if;

  select platform_role into v_actor_role from public.profiles where id = p_actor_profile_id;
  if not found then raise exception using errcode = 'P0006', message = 'approval actor not found'; end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'deliverable not found'; end if;
  if v_task.task_type <> 'deliverable' then raise exception using errcode = '22023', message = 'task is not a deliverable'; end if;
  if v_task.approval_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'deliverable approval revision changed';
  end if;
  if v_task.approval_status <> 'proposed' then
    raise exception using errcode = 'P0003', message = 'deliverable is not proposed';
  end if;

  select * into v_initiative from public.packages where id = v_task.package_id for share;
  if not found then raise exception using errcode = 'P0002', message = 'initiative not found'; end if;

  if p_action in ('approve', 'reject')
     and v_actor_role <> 'ceo'
     and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'deliverable approval requires ceo or initiative accountable';
  end if;
  if p_action = 'return_to_draft'
     and v_actor_role not in ('ceo', 'deputy')
     and coalesce(v_initiative.accountable_profile_id, '') <> p_actor_profile_id then
    raise exception using errcode = 'P0006', message = 'deliverable may only be returned by operational lead or accountable';
  end if;
  if p_action = 'approve' and v_initiative.approval_status <> 'approved' then
    raise exception using errcode = 'P0003', message = 'initiative must be approved first';
  end if;

  v_before_status := v_task.approval_status;
  v_notification_recipient_id := v_task.proposed_by;
  v_next_status := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'draft' end;
  update public.tasks
  set approval_status = v_next_status,
      approval_revision = approval_revision + 1,
      decided_by = case when p_action in ('approve', 'reject') then p_actor_profile_id else null end,
      decided_at = case when p_action in ('approve', 'reject') then now() else null end,
      decision_note = v_note,
      sprint_id = case when p_action = 'approve' then sprint_id else null end,
      review_status = case when p_action = 'approve' then review_status else 'not_requested' end,
      review_requested_at = case when p_action = 'approve' then review_requested_at else null end,
      score_points = case when p_action = 'approve' then score_points else 0 end,
      score_final = case when p_action = 'approve' then score_final else false end,
      github_issue_sync_status = 'not_synced',
      github_issue_sync_error = null,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_task;

  insert into public.task_activity (task_id, message)
  values (p_task_id, case p_action
    when 'approve' then 'Deliverable freigegeben · Revision ' || v_task.approval_revision
    when 'reject' then 'Deliverable abgelehnt · Revision ' || v_task.approval_revision || ' · Begründung: ' || v_note
    else 'Deliverable zur Überarbeitung zurückgegeben · Revision ' || v_task.approval_revision || ' · Begründung: ' || v_note
  end);
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, before_data, after_data)
  values (p_actor_profile_id, 'task.approval_' || p_action, 'task', p_task_id,
    jsonb_build_object('approvalStatus', v_before_status, 'revision', p_expected_revision),
    jsonb_build_object('approvalStatus', v_next_status, 'revision', v_task.approval_revision, 'note', v_note));

  if p_action = 'return_to_draft' and v_notification_recipient_id is not null then
    insert into public.notification_events (
      type,
      actor_profile_id,
      recipient_profile_id,
      entity_type,
      entity_id,
      title,
      body,
      dedupe_key
    ) values (
      'planning_item.returned',
      p_actor_profile_id,
      v_notification_recipient_id,
      'task',
      p_task_id,
      'Deliverable zur Überarbeitung: ' || v_task.title,
      'Begründung: ' || v_note,
      'planning-item-returned:task:' || p_task_id || ':' || v_task.approval_revision
    );
  end if;

  return to_jsonb(v_task);
end;
$$;

create or replace function public.create_planning_task_transaction(
  p_task_insert jsonb,
  p_relation_type text default null,
  p_related_task_id text default null,
  p_relation_note text default null,
  p_activity_message text default 'Task created',
  p_relation_activity_message text default null,
  p_notifications jsonb default '[]'::jsonb,
  p_actor_profile_id text default null,
  p_request_ip text default null,
  p_user_agent text default null,
  p_approve_now boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_task jsonb;
  v_clean_insert jsonb := coalesce(p_task_insert, '{}'::jsonb)
    - 'approval_status' - 'approval_revision' - 'proposed_by' - 'proposed_at'
    - 'decided_by' - 'decided_at' - 'decision_note';
  v_requested_approval_status text := nullif(p_task_insert->>'approval_status', '');
  v_requested_sprint_id text := nullif(p_task_insert->>'sprint_id', '');
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);
  v_result := public.create_task_transaction(
    v_clean_insert, p_relation_type, p_related_task_id, p_relation_note,
    p_activity_message, p_relation_activity_message, p_notifications,
    p_actor_profile_id, p_request_ip, p_user_agent
  );
  v_task := v_result->'task';

  if coalesce((v_result->>'replayed')::boolean, false) = false and v_task->>'task_type' = 'deliverable' then
    if v_requested_approval_status = 'approved' and not p_approve_now then
      update public.tasks as updated_task
      set approval_status = 'approved',
          approval_revision = greatest(coalesce((p_task_insert->>'approval_revision')::integer, 1), 1),
          sprint_id = v_requested_sprint_id,
          score_relevant = v_requested_sprint_id is not null
      where id = v_task->>'id'
      returning to_jsonb(updated_task.*) into v_task;
    else
      update public.tasks
      set proposed_by = coalesce(nullif(p_task_insert->>'proposed_by', ''), p_actor_profile_id),
          proposed_at = coalesce((p_task_insert->>'proposed_at')::timestamptz, proposed_at, now())
      where id = v_task->>'id';
    end if;
    if p_approve_now then
      v_task := public.decide_deliverable_approval_transaction(
        v_task->>'id', coalesce((v_task->>'approval_revision')::integer, 1),
        'approve', p_actor_profile_id, 'Bei Erstellung durch CEO freigegeben.'
      );
    elsif v_requested_approval_status <> 'approved' or v_requested_approval_status is null then
      select to_jsonb(task) into v_task from public.tasks as task where task.id = v_task->>'id';
    end if;
    v_result := jsonb_set(v_result, '{task}', v_task);
  end if;
  return v_result;
end;
$$;

create or replace function public.update_planning_task_transaction(
  p_task_id text,
  p_expected_updated_at timestamptz,
  p_task_patch jsonb default '{}'::jsonb,
  p_note_present boolean default false,
  p_note text default null,
  p_dependency_present boolean default false,
  p_dependency_note text default null,
  p_activity_messages text[] default '{}',
  p_notifications jsonb default '[]'::jsonb,
  p_actor_profile_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_task_patch, '{}'::jsonb);
  v_parent_id text;
  v_before_task public.tasks%rowtype;
  v_parent public.tasks%rowtype;
  v_updated_task public.tasks%rowtype;
  v_result jsonb;
begin
  perform set_config('app.actor_profile_id', coalesce(p_actor_profile_id, ''), true);

  if not (v_patch ? 'parent_task_id') then
    return public.update_task_transaction(
      p_task_id, p_expected_updated_at, v_patch, p_note_present, p_note,
      p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
    );
  end if;

  v_parent_id := nullif(trim(v_patch->>'parent_task_id'), '');
  if v_parent_id is null then
    raise exception using errcode = '22023', message = 'sub-issue parent is required';
  end if;

  select * into v_before_task
  from public.tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;
  if v_before_task.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'P0001', message = 'task was changed concurrently';
  end if;
  if v_before_task.task_type <> 'sub_issue' then
    raise exception using errcode = '22023', message = 'only sub-issues may change parent';
  end if;

  select * into v_parent
  from public.tasks
  where id = v_parent_id
    and task_type = 'deliverable'
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'sub-issue parent must be a deliverable';
  end if;

  v_result := public.update_task_transaction(
    p_task_id, p_expected_updated_at, v_patch - 'parent_task_id', p_note_present, p_note,
    p_dependency_present, p_dependency_note, p_activity_messages, p_notifications
  );

  update public.tasks
  set parent_task_id = v_parent_id,
      updated_at = clock_timestamp()
  where id = p_task_id
  returning * into v_updated_task;

  if v_before_task.parent_task_id is distinct from v_updated_task.parent_task_id then
    insert into public.audit_log (
      actor_profile_id,
      action,
      entity_type,
      entity_id,
      before_data,
      after_data
    ) values (
      p_actor_profile_id,
      'task.parent_changed',
      'task',
      p_task_id,
      jsonb_build_object(
        'parentTaskId', v_before_task.parent_task_id,
        'packageId', v_before_task.package_id,
        'milestoneId', v_before_task.milestone_id
      ),
      jsonb_build_object(
        'parentTaskId', v_updated_task.parent_task_id,
        'packageId', v_updated_task.package_id,
        'milestoneId', v_updated_task.milestone_id
      )
    );
  end if;

  return jsonb_set(
    jsonb_set(v_result, '{task}', to_jsonb(v_updated_task), true),
    '{parentApprovalStatus}',
    to_jsonb(v_parent.approval_status),
    true
  );
end;
$$;

revoke all on function public.decide_initiative_approval_transaction(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.decide_deliverable_approval_transaction(text, integer, text, text, text) from public, anon, authenticated;
revoke all on function public.create_planning_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.update_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text) from public, anon, authenticated;
grant execute on function public.decide_initiative_approval_transaction(text, integer, text, text, text) to service_role;
grant execute on function public.decide_deliverable_approval_transaction(text, integer, text, text, text) to service_role;
grant execute on function public.create_planning_task_transaction(jsonb, text, text, text, text, text, jsonb, text, text, text, boolean) to service_role;
grant execute on function public.update_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text) to service_role;

comment on function public.update_planning_task_transaction(text, timestamptz, jsonb, boolean, text, boolean, text, text[], jsonb, text)
is 'Atomically applies approval-aware task updates and controlled Sub-Issue parent changes with compare-and-set protection and audit history.';

create or replace function public.create_team_task_intake_v2_transaction(
  p_token_id uuid,
  p_profile_id text,
  p_idempotency_key uuid,
  p_request_hash text,
  p_items jsonb,
  p_request_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token public.team_task_intake_tokens%rowtype;
  v_batch public.team_task_intake_batches%rowtype;
  v_role text;
  v_item jsonb;
  v_index integer;
  v_item_type text;
  v_id text;
  v_parent public.tasks%rowtype;
  v_initiative public.packages%rowtype;
  v_created_initiative public.packages%rowtype;
  v_task_insert jsonb;
  v_result jsonb;
  v_entity jsonb;
  v_ids text[] := array[]::text[];
  v_entities jsonb := '[]'::jsonb;
begin
  if p_token_id is null or nullif(trim(coalesce(p_profile_id, '')), '') is null
     or p_idempotency_key is null or coalesce(p_request_hash, '') !~ '^[a-f0-9]{64}$'
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 30 then
    raise exception using errcode = '22023', message = 'team intake v2 input is invalid';
  end if;

  select * into v_token from public.team_task_intake_tokens
  where id = p_token_id and profile_id = p_profile_id and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'P0004', message = 'team intake token is inactive'; end if;
  if not ('write:task-intake' = any(v_token.scopes)) then raise exception using errcode = 'P0005', message = 'team intake write scope is missing'; end if;

  select platform_role into v_role from public.profiles where id = p_profile_id for share;
  if not found or v_role not in ('ceo', 'deputy', 'founder') then
    raise exception using errcode = 'P0006', message = 'team intake profile role is not allowed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('team-intake-batch:' || p_token_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_batch from public.team_task_intake_batches
  where token_id = p_token_id and idempotency_key = p_idempotency_key;
  if found then
    if v_batch.request_hash <> p_request_hash then raise exception using errcode = 'P0003', message = 'idempotency key conflict'; end if;
    return jsonb_build_object('batchId', v_batch.id, 'replayed', true, 'items', v_batch.response_tasks);
  end if;

  for v_item, v_index in select value, ordinality::integer from jsonb_array_elements(p_items) with ordinality loop
    v_item_type := nullif(trim(v_item->>'itemType'), '');
    v_id := p_profile_id || '-team-intake-v2-' || replace(p_idempotency_key::text, '-', '') || '-' || v_index::text;
    if v_item_type = 'initiative' then
      if v_role not in ('ceo', 'deputy') then raise exception using errcode = 'P0006', message = 'initiative proposal requires ceo or deputy'; end if;
      insert into public.packages (
        id, project_id, milestone_id, owner_id, accountable_profile_id, responsible_profile_ids,
        consulted_profile_ids, informed_profile_ids, title, goal, priority, status, success_criteria,
        scope_constraints, sort_order, approval_status, approval_revision, proposed_by, proposed_at
      ) values (
        v_id, 'findmydoc-founder-execution', nullif(v_item->>'milestoneId', ''), nullif(v_item->>'ownerId', ''),
        nullif(v_item->>'accountableProfileId', ''), coalesce(array(select jsonb_array_elements_text(v_item->'responsibleProfileIds')), array[]::text[]),
        coalesce(array(select jsonb_array_elements_text(v_item->'consultedProfileIds')), array[]::text[]),
        coalesce(array(select jsonb_array_elements_text(v_item->'informedProfileIds')), array[]::text[]),
        trim(v_item->>'title'), coalesce(v_item->>'intendedOutcome', v_item->>'description', ''), coalesce(nullif(v_item->>'priority', ''), 'P2'),
        'planned', coalesce(v_item->>'acceptanceCriteria', ''), coalesce(v_item->>'scopeConstraints', ''),
        coalesce((select max(sort_order) + 1 from public.packages where project_id = 'findmydoc-founder-execution'), 1),
        'proposed', 1, p_profile_id, now()
      ) returning * into v_created_initiative;
      v_entity := to_jsonb(v_created_initiative);
      insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
      values (p_profile_id, 'team.task_intake_v2.initiative_create', 'initiative', v_id, v_entity, p_request_ip, p_user_agent);
    elsif v_item_type in ('deliverable', 'sub_issue') then
      if v_item_type = 'deliverable' then
        select * into v_initiative from public.packages where id = nullif(v_item->>'packageId', '') for share;
        if not found then raise exception using errcode = 'P0002', message = 'team intake v2 initiative not found'; end if;
        if v_initiative.approval_status = 'rejected' then raise exception using errcode = 'P0003', message = 'team intake v2 initiative is rejected'; end if;
      else
        select * into v_parent from public.tasks where id = nullif(v_item->>'parentTaskId', '') and task_type = 'deliverable' for share;
        if not found then raise exception using errcode = 'P0002', message = 'team intake v2 parent deliverable not found'; end if;
      end if;
      if coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management') not in (
        'findmydoc-platform/management', 'findmydoc-platform/website', 'findmydoc-platform/clinic-dashboard'
      ) then raise exception using errcode = '22023', message = 'team intake v2 github repository is not allowed'; end if;
      if v_item_type = 'deliverable'
         and coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management') <> 'findmydoc-platform/management' then
        raise exception using errcode = '22023', message = 'team intake v2 deliverables must use the management repository';
      end if;

      v_task_insert := jsonb_build_object(
        'id', v_id, 'creation_request_id', 'team-v2:' || p_token_id::text || ':' || p_idempotency_key::text || ':' || v_index::text,
        'project_id', 'findmydoc-founder-execution', 'package_id', case when v_item_type = 'sub_issue' then v_parent.package_id else v_initiative.id end,
        'milestone_id', case when v_item_type = 'sub_issue' then v_parent.milestone_id else v_initiative.milestone_id end,
        'title', trim(v_item->>'title'), 'description', coalesce(v_item->>'description', ''),
        'problem_statement', coalesce(v_item->>'problemStatement', ''), 'intended_outcome', coalesce(v_item->>'intendedOutcome', ''),
        'scope_constraints', coalesce(v_item->>'scopeConstraints', ''), 'acceptance_criteria', coalesce(v_item->>'acceptanceCriteria', ''),
        'evidence_required', coalesce(v_item->>'evidenceRequired', ''), 'definition_of_done', coalesce(v_item->>'definitionOfDone', ''),
        'status', 'Offen', 'priority', coalesce(nullif(v_item->>'priority', ''), 'P2'),
        'owner', nullif(v_item->>'ownerId', ''), 'assignee', nullif(v_item->>'ownerId', ''), 'created_by', p_profile_id,
        'workstream', coalesce(v_item->>'workstream', ''), 'sort_order', 0, 'start_date', nullif(v_item->>'startDate', ''),
        'end_date', nullif(v_item->>'endDate', ''), 'deadline', nullif(v_item->>'deadline', ''), 'estimate_hours', coalesce((v_item->>'hours')::integer, 0),
        'sprint_id', null, 'review_status', 'not_requested', 'score_points', 0, 'score_final', false,
        'github_repo', case when v_item_type = 'sub_issue'
          then coalesce(nullif(v_item->>'githubRepo', ''), 'findmydoc-platform/management')
          else 'findmydoc-platform/management' end,
        'task_type', v_item_type, 'parent_task_id', case when v_item_type = 'sub_issue' then v_parent.id else null end,
        'approval_status', case when v_item_type = 'sub_issue' then null else 'proposed' end, 'approval_revision', 1,
        'proposed_by', case when v_item_type = 'deliverable' then p_profile_id else null end,
        'proposed_at', case when v_item_type = 'deliverable' then now() else null end, 'score_relevant', false
      );
      v_result := public.create_planning_task_transaction(v_task_insert, null, null, null,
        case when v_item_type = 'sub_issue' then 'Sub-Issue über Team Intake v2 erstellt' else 'Deliverable über Team Intake v2 vorgeschlagen' end,
        null, '[]'::jsonb, p_profile_id, p_request_ip, p_user_agent, false);
      v_entity := v_result->'task';
    else
      raise exception using errcode = '22023', message = 'team intake v2 item type is invalid';
    end if;
    v_ids := array_append(v_ids, v_id);
    v_entities := v_entities || jsonb_build_array(jsonb_build_object('itemType', v_item_type, 'item', v_entity));
  end loop;

  insert into public.team_task_intake_batches (token_id, profile_id, idempotency_key, request_hash, task_ids, response_tasks)
  values (p_token_id, p_profile_id, p_idempotency_key, p_request_hash, v_ids, v_entities) returning * into v_batch;
  insert into public.audit_log (actor_profile_id, action, entity_type, entity_id, after_data, request_ip, user_agent)
  values (p_profile_id, 'team.task_intake_v2.commit', 'team_task_intake_batch', v_batch.id::text,
    jsonb_build_object('tokenId', p_token_id, 'entityIds', v_ids), p_request_ip, p_user_agent);
  return jsonb_build_object('batchId', v_batch.id, 'replayed', false, 'items', v_entities);
end;
$$;

revoke all on function public.create_team_task_intake_v2_transaction(uuid, text, uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.create_team_task_intake_v2_transaction(uuid, text, uuid, text, jsonb, text, text) to service_role;

do $$
begin
  if exists (select 1 from public.tasks where task_type = 'proposal') then
    raise exception 'Cannot remove legacy Team Task Intake v1.2 while proposal tasks remain.';
  end if;
end
$$;

alter table public.tasks drop constraint if exists tasks_task_type_check;
alter table public.tasks add constraint tasks_task_type_check
  check (task_type in ('deliverable', 'sub_issue'));

alter table public.tasks drop constraint if exists tasks_approval_status_by_type_check;
alter table public.tasks add constraint tasks_approval_status_by_type_check check (
  (task_type = 'sub_issue' and approval_status is null)
  or (task_type = 'deliverable' and approval_status in ('draft', 'proposed', 'approved', 'rejected'))
);

alter table public.tasks drop constraint if exists tasks_github_repo_allowed_check;
alter table public.tasks add constraint tasks_github_repo_allowed_check check (
  (task_type = 'sub_issue' and github_repo in ('findmydoc-platform/management', 'findmydoc-platform/website', 'findmydoc-platform/clinic-dashboard'))
  or (task_type = 'deliverable' and github_repo = 'findmydoc-platform/management')
);

drop index if exists public.tasks_legacy_proposal_unresolved_idx;

drop function if exists public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text);

-- Proposal state belongs to approval_status, never to the operational task status.
update public.tasks
set status = 'Offen'
where status = 'Vorschlag';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_status_not_proposal_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_status_not_proposal_check
      check (status <> 'Vorschlag') not valid;
  end if;
end
$$;

alter table public.tasks validate constraint tasks_status_not_proposal_check;

notify pgrst, 'reload schema';
