create table if not exists profiles (
  id text primary key,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  role text not null check (role in ('admin', 'member', 'viewer')),
  focus text,
  weekly_capacity integer not null default 6,
  profile_color text not null default '#64748b' check (profile_color ~ '^#[0-9A-Fa-f]{6}$')
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

create table if not exists decision_task_links (
  id bigserial primary key,
  decision_id bigint not null references decision_log(id) on delete cascade,
  task_id text not null references tasks(id) on delete cascade,
  link_type text not null default 'follows_from' check (link_type in ('follows_from', 'supports', 'blocks_decision')),
  note text not null default '',
  created_by text references profiles(id),
  created_at timestamptz not null default now(),
  unique (decision_id, task_id)
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
create index if not exists github_app_user_tokens_github_login_idx on github_app_user_tokens(github_login);
create index if not exists github_app_user_tokens_refresh_idx on github_app_user_tokens(refresh_token_expires_at);
  create index if not exists packages_project_id_idx on packages(project_id);
  create index if not exists packages_owner_id_idx on packages(owner_id);
  create index if not exists packages_accountable_profile_id_idx on packages(accountable_profile_id);
  create index if not exists packages_status_idx on packages(status);
create index if not exists packages_target_date_idx on packages(target_date);
create index if not exists tasks_project_id_idx on tasks(project_id);
create index if not exists tasks_package_id_idx on tasks(package_id);
create index if not exists tasks_status_idx on tasks(status);
create index if not exists tasks_owner_idx on tasks(owner);
create index if not exists tasks_review_owner_profile_id_idx on tasks(review_owner_profile_id);
create index if not exists tasks_review_requested_at_idx on tasks(review_requested_at);
create index if not exists task_dependencies_task_id_idx on task_dependencies(task_id);
create index if not exists task_links_task_id_idx on task_links(task_id);
create index if not exists task_activity_task_id_idx on task_activity(task_id);
create index if not exists task_focus_items_profile_date_idx on task_focus_items(profile_id, focus_date, position);
create index if not exists task_focus_items_task_idx on task_focus_items(task_id);
create index if not exists decision_task_links_decision_idx on decision_task_links(decision_id);
create index if not exists decision_task_links_task_idx on decision_task_links(task_id);
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

grant usage on schema public to anon, authenticated, service_role;
grant select on profiles, projects, packages, tasks, task_dependencies, task_links, task_notes, task_activity, task_focus_items, decision_task_links, founder_sprint_scores, founder_strike_state, strike_events, score_objections, founder_events to authenticated, service_role;
grant insert, update, delete on profiles, projects, packages, tasks, task_dependencies, task_links, task_notes, task_activity, task_focus_items, decision_task_links, founder_sprint_scores, founder_strike_state, strike_events, score_objections, founder_events to authenticated, service_role;
grant select, insert, update, delete on github_app_user_tokens to service_role;
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

alter table profiles enable row level security;
alter table github_app_user_tokens enable row level security;
alter table projects enable row level security;
alter table packages enable row level security;
alter table tasks enable row level security;
alter table task_dependencies enable row level security;
alter table task_links enable row level security;
alter table task_notes enable row level security;
alter table task_activity enable row level security;
alter table task_focus_items enable row level security;
alter table decision_task_links enable row level security;
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

drop policy if exists "decision_task_links_select_team" on decision_task_links;
create policy "decision_task_links_select_team" on decision_task_links for select to authenticated using (auth.uid() is not null);

drop policy if exists "decision_task_links_write_team" on decision_task_links;
create policy "decision_task_links_write_team" on decision_task_links for all to authenticated
using (auth.uid() is not null)
with check (auth.uid() is not null);

drop policy if exists "founder_events_select_team" on founder_events;
create policy "founder_events_select_team" on founder_events for select to authenticated using (auth.uid() is not null);

drop policy if exists "founder_events_write_members" on founder_events;
create policy "founder_events_write_members" on founder_events for all to authenticated
using (public.current_profile_role() in ('admin', 'member'))
with check (public.current_profile_role() in ('admin', 'member'));
